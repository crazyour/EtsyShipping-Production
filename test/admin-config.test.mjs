import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import handler from "../api/bridge.js";
import { adminSetup } from "../lib/admin-config.mjs";

const password = "Test-Only!9Secure-Key47";
const config = { shopId: "12345", name: "Test Shop", enabled: false, revision: 0,
  keystring: "test-etsy-keystring", sharedSecret: "test-etsy-secret" };
function fixture() {
  const names = ["VERCEL", "SITE_ADMIN_USERNAME", "SITE_ADMIN_PASSWORD", "ETSY_CONFIG_ENCRYPTION_KEY",
    "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SITE_PUBLIC_ORIGIN"];
  const previous = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { VERCEL: "1", SITE_ADMIN_USERNAME: "admin", SITE_ADMIN_PASSWORD: password,
    ETSY_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    UPSTASH_REDIS_REST_URL: "https://test.upstash.io", UPSTASH_REDIS_REST_TOKEN: "test-redis-secret",
    SITE_PUBLIC_ORIGIN: "https://test.example" });
  const originalFetch = globalThis.fetch, kv = new Map(), configs = new Map();
  const requests = [];
  let attempts = 0, unavailable = false;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (String(url).startsWith("https://shipping.sunfacework.com"))
      return Response.json({ accessToken: "upstream-ordinary-user" });
    assert.equal(url, "https://test.upstash.io");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer test-redis-secret");
    if (unavailable) throw new Error("private storage error contains secret");
    const [cmd, ...args] = JSON.parse(options.body);
    let result;
    if (cmd === "SET") { kv.set(args[0], args[1]); result = "OK"; }
    else if (cmd === "GET") result = kv.get(args[0]) || null;
    else if (cmd === "DEL") result = Number(kv.delete(args[0]));
    else if (cmd === "HGETALL") result = [...configs.entries()].flat();
    else if (cmd === "HGET") result = configs.get(args[1]) || null;
    else if (cmd === "EVAL" && args[0].includes("INCR")) result = ++attempts;
    else if (cmd === "EVAL" && args[0].includes("redis.call('DEL'")) {
      result = kv.get(args[2]) === args[3] ? Number(kv.delete(args[2])) : 0;
    }
    else if (cmd === "EVAL") {
      const [, , , id, old, next] = args;
      result = (configs.get(id) || "") === old ? 1 : 0;
      if (result) configs.set(id, next);
    } else throw new Error(`Unexpected command ${cmd}`);
    return Response.json({ result });
  };
  async function call(route, { method = "GET", body, session = "", headers = {} } = {}) {
    const request = Object.assign(Readable.from([]), { url: `/api/bridge?route=${route}`, method, body,
      headers: { host: "test.example", origin: "https://test.example", "x-admin-action": "1", cookie: session, ...headers } });
    const result = {};
    await handler(request, { writeHead(status, headers) { Object.assign(result, { status, headers }); },
      end(value) { result.data = JSON.parse(value); } });
    return result;
  }
  const login = () => call("login", { method: "POST", body: { userName: "admin", password } });
  return { call, login, configs, kv, requests,
    outage() { unavailable = true; },
    restore() { globalThis.fetch = originalFetch; for (const k of names) {
      if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k];
    } },
  };
}
const sessionOf = (result) => result.headers["Set-Cookie"].split(";")[0];

test("only server-issued admin sessions can read/write configurations; client roles and upstream tokens do not count", async () => {
  const f = fixture();
  try {
    for (const method of ["GET", "POST", "DELETE"]) {
      const r = await f.call("admin-etsy-config", { method, body: config,
        headers: { authorization: "Bearer ordinary-user", "x-role": "管理员" } });
      assert.equal(r.status, 403);
    }
    assert.equal(f.requests.length, 0);
    const login = await f.login();
    assert.equal(login.status, 200);
    assert.equal(login.data.apiAdmin, true);
    assert.match(login.headers["Set-Cookie"], /HttpOnly; SameSite=Strict; Max-Age=900; Secure/);
    const session = sessionOf(login);
    assert.equal((await f.call("admin-etsy-config", { session: `${session}x` })).status, 403);
    const saved = await f.call("admin-etsy-config", { method: "POST", body: config, session });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.item.revision, 1);
    const listed = await f.call("admin-etsy-config", { session });
    assert.equal(listed.data.items.length, 1);
    for (const value of [JSON.stringify(saved), JSON.stringify(listed), ...f.configs.values()]) {
      assert.doesNotMatch(value, /test-etsy-keystring|test-etsy-secret/);
    }
    assert.equal((await f.call("admin-etsy-config", { method: "POST", body: config, session })).status, 409);
    const edit = await f.call("admin-etsy-config", { method: "POST", session,
      body: { shopId: config.shopId, name: "Updated", enabled: true, revision: 1 } });
    assert.equal(edit.status, 200);
    assert.equal(edit.data.item.hasCredentials, true);
    assert.equal((await f.call("admin-etsy-config", { method: "POST", session,
      body: { ...config, revision: 2, accessToken: "do-not-store" } })).status, 400);
    assert.equal((await f.call("admin-logout", { method: "POST", session })).status, 200);
    assert.equal((await f.call("admin-etsy-config", { session })).status, 403);
  } finally { f.restore(); }
});
test("CSRF, expired sessions, password changes and broken storage fail closed", async () => {
  const f = fixture();
  try {
    const session = sessionOf(await f.login());
    for (const headers of [{ origin: "https://evil.example" }, { "x-admin-action": "" }, { "sec-fetch-site": "cross-site" }])
      assert.equal((await f.call("admin-etsy-config", { method: "POST", body: config, session, headers })).status, 403);
    assert.equal(f.configs.size, 0);
    process.env.SITE_ADMIN_PASSWORD = "Different!StrongPassword123";
    assert.equal((await f.call("admin-etsy-config", { session })).status, 403);
    process.env.SITE_ADMIN_PASSWORD = password;
    for (const [key, value] of f.kv) f.kv.set(key, JSON.stringify({ ...JSON.parse(value), expires: 1 }));
    assert.equal((await f.call("admin-etsy-config", { session })).status, 403);
    const nextSession = sessionOf(await f.login());
    f.outage();
    const result = await f.call("admin-etsy-config", { session: nextSession });
    assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(result), /private storage|test-redis-secret/);
  } finally { f.restore(); }
});
test("configured admin password has no strength gate, while authentication and encrypted storage remain required", async () => {
  const f = fixture();
  try {
    process.env.SITE_ADMIN_PASSWORD = "admin";
    const login = await f.call("login", { method: "POST", body: { userName: "admin", password: "admin" } });
    assert.equal(login.status, 200);
    assert.equal(login.data.apiAdmin, true);
    assert.equal(login.data.apiAdminNotice, "");
    const session = sessionOf(login);
    assert.equal((await f.call("admin-etsy-config", { session, method: "POST", body: config })).status, 200);
    assert.equal((await f.call("admin-etsy-config", { session })).status, 200);
    assert.equal((await f.call("admin-etsy-config")).status, 403);
    assert.equal((await f.call("login", { method: "POST", body: { userName: "admin", password: "wrong" } })).status, 401);
    process.env.SITE_ADMIN_PASSWORD = "";
    assert.equal(adminSetup().ready, false);
    process.env.SITE_ADMIN_PASSWORD = "a";
    assert.equal(adminSetup().ready, true);
    process.env.SITE_ADMIN_PASSWORD = "admin";
    delete process.env.ETSY_CONFIG_ENCRYPTION_KEY;
    assert.equal(adminSetup().ready, false);
    const locked = await f.call("login", { method: "POST", body: { userName: "admin", password: "admin" } });
    assert.equal(locked.data.apiAdmin, false);
    assert.match(locked.data.apiAdminNotice, /加密密钥/);
    assert.equal((await f.call("admin-etsy-config", { session })).status, 403);
    process.env.ETSY_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.UPSTASH_REDIS_REST_URL = "https://evil.example";
    assert.equal(adminSetup().ready, false);
  } finally { f.restore(); }
});
test("administrator login is rate limited and normal-user login revokes previous admin session", async () => {
  const f = fixture();
  try {
    const session = sessionOf(await f.login());
    const normal = await f.call("login", { method: "POST", session, body: { userName: "worker", password: "worker-password" } });
    assert.equal(normal.status, 200);
    assert.equal((await f.call("admin-etsy-config", { session })).status, 403);
    for (let i = 0; i < 29; i++) assert.equal((await f.call("login", {
      method: "POST", body: { userName: "admin", password: "bad-password" },
    })).status, 401);
    assert.equal((await f.login()).status, 429);
  } finally { f.restore(); }
});
