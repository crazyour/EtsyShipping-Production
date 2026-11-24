import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import handler from "../api/bridge.js";
import { SETUP_KEYS, SETUP_TARGET } from "../lib/server-setup.mjs";

let fixtureId = 0;
const values = {
  ETSY_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-private-redis-token",
  SITE_PUBLIC_ORIGIN: "https://site.example",
};
function fixture() {
  const names = ["VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_ID", "SITE_ADMIN_USERNAME", "SITE_ADMIN_PASSWORD", ...SETUP_KEYS];
  const old = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  const password = `test-admin-password-${++fixtureId}`;
  for (const key of SETUP_KEYS) delete process.env[key];
  Object.assign(process.env, { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_ID: SETUP_TARGET.projectId,
    SITE_ADMIN_USERNAME: "admin", SITE_ADMIN_PASSWORD: password });
  const originalFetch = globalThis.fetch, calls = [], envs = [], shared = [];
  let behavior = null, project = { id: SETUP_TARGET.projectId, accountId: SETUP_TARGET.teamId, name: "etsyshipping" };
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url); calls.push({ url: parsed, options });
    assert.equal(parsed.origin, "https://api.vercel.com");
    assert.equal(parsed.searchParams.get("teamId"), SETUP_TARGET.teamId);
    assert.equal(parsed.searchParams.get("upsert"), null);
    assert.equal(options.headers.Authorization, "Bearer test-private-vercel-token");
    assert.equal(options.redirect, "error");
    if (behavior) { const custom = await behavior(parsed, options); if (custom) return custom; }
    if (parsed.pathname === `/v9/projects/${SETUP_TARGET.projectId}`) return Response.json(project);
    if (parsed.pathname === "/v1/env") {
      assert.equal(options.method, "GET");
      assert.equal(parsed.searchParams.get("projectId"), SETUP_TARGET.projectId);
      return Response.json({ data: shared, pagination: { count: shared.length, next: null } });
    }
    assert.equal(parsed.pathname, `/v10/projects/${SETUP_TARGET.projectId}/env`);
    if (options.method === "GET") {
      assert.equal(parsed.searchParams.get("decrypt"), "false");
      return Response.json({ envs });
    }
    const batch = JSON.parse(options.body);
    const created = [], failed = [];
    for (const row of batch) {
      if (envs.some((e) => e.key === row.key && e.target.includes("production"))) failed.push({ error: { message: "Private duplicate details" } });
      else { envs.push(row); created.push(row); }
    }
    return Response.json({ created, failed }, { status: 201 });
  };
  async function call(body, { method = "POST", headers = {}, route = "admin-server-config" } = {}) {
    const req = Object.assign(Readable.from([]), { method, url: `/api/bridge?route=${route}`, body,
      headers: { host: "site.example", origin: "https://site.example", "x-admin-action": "1", ...headers } });
    const result = {};
    await handler(req, { writeHead(status, responseHeaders) { result.status = status; result.headers = responseHeaders; }, end(value) { result.data = JSON.parse(value); } });
    return result;
  }
  const auth = { userName: "admin", password, vercelToken: "test-private-vercel-token" };
  return { calls, envs, shared, auth, call,
    save: (extra = {}) => call({ ...auth, action: "save", values, confirmed: true, ...extra }),
    inspect: () => call({ ...auth, action: "inspect" }),
    setProject(next) { project = { ...project, ...next }; }, setBehavior(fn) { behavior = fn; },
    restore() { globalThis.fetch = originalFetch; for (const key of names) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    } },
  };
}

test("bootstrap administrator can configure missing secrets without Redis; nothing secret is returned or activated in memory", async () => {
  const f = fixture();
  try {
    const login = await f.call({ userName: "admin", password: f.auth.password }, { route: "login" });
    assert.equal(login.status, 200); assert.equal(login.data.apiAdmin, false);
    assert.equal(login.data.serverConfigAdmin, true); assert.equal(login.data.serverConfig.available, true);
    assert.equal(f.calls.length, 0); // No initial database dependency.
    const inspected = await f.inspect(); assert.equal(inspected.status, 200);
    for (const key of SETUP_KEYS) assert.deepEqual(inspected.data.fields[key], { saved: false, active: false });
    const saved = await f.save(); assert.equal(saved.status, 200); assert.equal(saved.data.ok, true); assert.equal(saved.data.needsRedeploy, true);
    assert.deepEqual(saved.data.saved, SETUP_KEYS);
    for (const key of SETUP_KEYS) assert.equal(process.env[key], undefined);
    assert.equal(f.calls.filter((c) => c.options.method === "POST").length, 1);
    const written = JSON.parse(f.calls.at(-1).options.body);
    for (const row of written) { assert.equal(row.type, "sensitive"); assert.deepEqual(row.target, ["production"]); }
    assert.ok(!written.some((r) => /PASSWORD|VERCEL_TOKEN/.test(r.key)));
    const after = await f.inspect();
    assert.deepEqual(after.data.fields.ETSY_CONFIG_ENCRYPTION_KEY, { saved: true, active: false });
    for (const response of [login, inspected, saved, after]) {
      const text = JSON.stringify(response);
      for (const secret of [f.auth.password, f.auth.vercelToken, values.ETSY_CONFIG_ENCRYPTION_KEY, values.UPSTASH_REDIS_REST_TOKEN]) assert.ok(!text.includes(secret));
      assert.equal(response.headers["Cache-Control"], "no-store, max-age=0");
    }
  } finally { f.restore(); }
});
test("setup rejects ordinary accounts, forged roles, CSRF, missing credentials and non-production or mismatched deployments", async () => {
  const f = fixture();
  try {
    assert.equal((await f.call({}, { method: "GET" })).status, 405);
    for (const credentials of [{}, { userName: "worker", password: f.auth.password }, { ...f.auth, password: "wrong" }])
      assert.equal((await f.call({ action: "inspect", ...credentials }, { headers: { authorization: "Bearer ordinary", "x-role": "admin" } })).status, 403);
    for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { "x-admin-action": "" }])
      assert.equal((await f.call({ ...f.auth, action: "inspect" }, { headers })).status, 403);
    assert.equal((await f.save({ vercelToken: "" })).status, 400);
    process.env.VERCEL_ENV = "preview"; assert.equal((await f.inspect()).status, 403);
    process.env.VERCEL_ENV = "production"; process.env.VERCEL_PROJECT_ID = "prj_other"; assert.equal((await f.inspect()).status, 403);
    delete process.env.VERCEL; assert.equal((await f.inspect()).status, 403);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});
test("only allowlisted values can be initialized; active, pending and shared configurations are protected", async () => {
  const f = fixture();
  try {
    for (const override of [
      { values: { SITE_ADMIN_PASSWORD: "changed" } }, { projectId: "prj_other" }, { confirmed: false },
      { values: { ETSY_CONFIG_ENCRYPTION_KEY: "not-a-key" } },
      { values: { UPSTASH_REDIS_REST_URL: "http://127.0.0.1:80" } },
      { values: { UPSTASH_REDIS_REST_URL: "https://example.upstash.io@evil.example" } },
      { values: { UPSTASH_REDIS_REST_TOKEN: "bad\ntoken" } },
      { values: { SITE_PUBLIC_ORIGIN: "https://site.example/path" } },
    ]) assert.equal((await f.save(override)).status, 400);
    assert.equal(f.calls.length, 0);
    process.env.ETSY_CONFIG_ENCRYPTION_KEY = values.ETSY_CONFIG_ENCRYPTION_KEY;
    assert.equal((await f.save()).status, 409);
    delete process.env.ETSY_CONFIG_ENCRYPTION_KEY;
    f.envs.push({ key: "ETSY_CONFIG_ENCRYPTION_KEY", value: "existing-secret", target: ["production"], type: "sensitive" });
    assert.equal((await f.save()).status, 409);
    assert.equal(f.calls.filter((c) => c.options.method === "POST").length, 0);
    const onlyUrl = await f.save({ values: { UPSTASH_REDIS_REST_URL: values.UPSTASH_REDIS_REST_URL } });
    assert.equal(onlyUrl.data.ok, true); assert.equal(f.envs[0].value, "existing-secret");
    f.shared.push({ key: "SITE_PUBLIC_ORIGIN", target: ["production"], value: "private-shared-value" });
    const sharedStatus = await f.inspect();
    assert.equal(sharedStatus.data.shared, true);
    assert.equal(sharedStatus.data.fields.SITE_PUBLIC_ORIGIN.saved, true);
    assert.doesNotMatch(JSON.stringify(sharedStatus), /private-shared-value/);
    assert.equal((await f.save({ values: { SITE_PUBLIC_ORIGIN: values.SITE_PUBLIC_ORIGIN } })).status, 409);
  } finally { f.restore(); }
});
test("unknown, forbidden or paginated shared environment state cannot trigger a write", async () => {
  const f = fixture();
  try {
    for (const [body, status, expected] of [
      [{ unexpected: true }, 200, 502],
      [{ data: [], pagination: { next: 123 } }, 200, 409],
      [{ error: { message: "private-team-details" } }, 403, 403],
    ]) {
      f.setBehavior((url) => url.pathname === "/v1/env" ? Response.json(body, { status }) : null);
      const result = await f.save();
      assert.equal(result.status, expected);
      assert.doesNotMatch(JSON.stringify(result), /private-team-details/);
    }
    assert.equal(f.calls.filter((c) => c.options.method === "POST").length, 0);
  } finally { f.restore(); }
});
test("Vercel permission and project binding failures are redacted and cannot write", async () => {
  const f = fixture();
  try {
    f.setProject({ id: "prj_other" }); assert.equal((await f.inspect()).status, 403);
    f.setProject({ id: SETUP_TARGET.projectId, accountId: "team_other" }); assert.equal((await f.inspect()).status, 403);
    f.setProject({ accountId: SETUP_TARGET.teamId });
    f.setBehavior(() => Response.json({ error: { message: `${f.auth.vercelToken} internal-secret` } }, { status: 403 }));
    const bad = await f.save(); assert.equal(bad.status, 403); assert.doesNotMatch(JSON.stringify(bad), /internal-secret|test-private-vercel-token/);
    assert.equal(f.calls.filter((c) => c.options.method === "POST").length, 0);
  } finally { f.restore(); }
});
test("partial or ambiguous writes are not reported as success and are never automatically retried", async () => {
  const f = fixture();
  try {
    f.setBehavior((_url, options) => options.method === "POST" ? Response.json({ created: [{ key: SETUP_KEYS[0], value: values.ETSY_CONFIG_ENCRYPTION_KEY }], failed: [{ error: { message: "private-details" } }] }) : null);
    const partial = await f.save(); assert.equal(partial.data.ok, false); assert.deepEqual(partial.data.saved, [SETUP_KEYS[0]]);
    assert.doesNotMatch(JSON.stringify(partial), /private-details/);
    f.setBehavior((_url, options) => { if (options.method === "POST") throw new Error("Private network detail"); return null; });
    const uncertain = await f.save(); assert.equal(uncertain.status, 502); assert.match(uncertain.data.error, /可能已部分保存/);
    assert.doesNotMatch(JSON.stringify(uncertain), /Private network detail/);
    assert.equal(f.calls.filter((c) => c.options.method === "POST").length, 2);
  } finally { f.restore(); }
});
test("bootstrap validation is rate limited without relying on unavailable storage", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 30; i++) assert.equal((await f.call({ ...f.auth, password: "wrong", action: "inspect" })).status, 403);
    assert.equal((await f.inspect()).status, 429); assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});
