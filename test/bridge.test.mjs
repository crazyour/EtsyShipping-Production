import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import handler from "../api/bridge.js";

async function invoke(method, url, { authorization, body } = {}) {
  const request = Object.assign(Readable.from([]), {
    method, url, headers: authorization ? { authorization } : {}
  });
  if (body !== undefined) request.body = body;
  const result = { status: 0, headers: {}, data: null };
  const response = {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(value) { result.data = JSON.parse(value); }
  };
  await handler(request, response);
  return result;
}

test("Vercel 关闭演示入口并限制转发路由", async () => {
  const original = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    const meta = await invoke("GET", "/api/bridge?route=meta");
    assert.equal(meta.status, 200);
    assert.equal(meta.data.demoEnabled, false);
  } finally {
    if (original === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original;
  }
  assert.equal((await invoke("GET", "/api/bridge?route=unknown")).status, 404);
  assert.equal((await invoke("POST", "/api/bridge?route=orders")).status, 404);
  assert.equal((await invoke("GET", "/api/bridge?route=orders")).status, 401);
  assert.equal((await invoke("POST", "/api/bridge?route=login", { body: {} })).status, 400);
});

test("只转发许可的路径、参数和授权头", async () => {
  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return Response.json({ items: [] });
  };
  try {
    const result = await invoke("GET", "/api/bridge?route=orders&page=2&pageSize=20&url=https://evil.example", {
      authorization: "Bearer test-token"
    });
    assert.equal(result.status, 200);
    assert.equal(seen.url, "https://shipping.sunfacework.com/api/orders?page=2&pageSize=20");
    assert.equal(seen.options.headers.Authorization, "Bearer test-token");
    assert.equal(result.headers["Cache-Control"], "no-store, max-age=0");
  } finally { globalThis.fetch = original; }
});

test("登录仅向原服务发送用户名和密码", async () => {
  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return Response.json({ accessToken: "token" });
  };
  try {
    const result = await invoke("POST", "/api/bridge?route=login", {
      body: { userName: " user ", password: "secret", extra: "ignored" }
    });
    assert.equal(result.status, 200);
    assert.equal(seen.url, "https://shipping.sunfacework.com/api/auth/login");
    assert.deepEqual(JSON.parse(seen.options.body), { userName: "user", password: "secret" });
    assert.equal(seen.options.headers.Authorization, undefined);
  } finally { globalThis.fetch = original; }
});

test("Vercel 站点管理员凭据仅在服务端验证", async () => {
  const originalVercel = process.env.VERCEL;
  const originalUserName = process.env.SITE_ADMIN_USERNAME;
  const originalPassword = process.env.SITE_ADMIN_PASSWORD;
  const originalFetch = globalThis.fetch;
  // This test covers bootstrap login without storage. Production builds may already
  // have real credentials; never inherit them into this fixture or contact real Redis.
  const storageKeys = ["ETSY_CONFIG_ENCRYPTION_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SITE_PUBLIC_ORIGIN"];
  const originalStorage = Object.fromEntries(storageKeys.map((key) => [key, process.env[key]]));
  for (const key of storageKeys) delete process.env[key];
  let forwarded = false;
  process.env.VERCEL = "1";
  process.env.SITE_ADMIN_USERNAME = "admin";
  process.env.SITE_ADMIN_PASSWORD = "admin";
  globalThis.fetch = async () => { forwarded = true; return Response.json({}); };
  try {
    const result = await invoke("POST", "/api/bridge?route=login", {
      body: { userName: "admin", password: "admin" }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.demoAccess, true);
    assert.equal(result.data.apiAdmin, false);
    assert.deepEqual(result.data.roles, ["管理员"]);
    assert.equal(forwarded, false);
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    if (originalUserName === undefined) delete process.env.SITE_ADMIN_USERNAME;
    else process.env.SITE_ADMIN_USERNAME = originalUserName;
    if (originalPassword === undefined) delete process.env.SITE_ADMIN_PASSWORD;
    else process.env.SITE_ADMIN_PASSWORD = originalPassword;
    globalThis.fetch = originalFetch;
    for (const key of storageKeys) {
      if (originalStorage[key] === undefined) delete process.env[key];
      else process.env[key] = originalStorage[key];
    }
  }
});

test("上游故障返回可读的 502 错误", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("private network detail"); };
  try {
    const result = await invoke("GET", "/api/bridge?route=runtime");
    assert.equal(result.status, 502);
    assert.match(result.data.error, /无法连接生产服务器/);
    assert.doesNotMatch(JSON.stringify(result.data), /private network detail/);
  } finally { globalThis.fetch = original; }
});
