import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import handler from "../api/bridge.js";
import { openConfig, sealConfig, CONFIG_KEY } from "../lib/admin-config.mjs";
import { safeImageUrl } from "../lib/etsy-cloud.mjs";
import { cloudCsvRows } from "../dist/etsy-cloud-ui.js";
import { ORDER_CSV_COLUMNS } from "../dist/order-template.js";
import { csvEncode, csvParse } from "../dist/workspace-store.js";

const password = "Cloud-Test!StrongPass248";
const JOB = "etsyshipping:cloud:job:v1", ORDERS = "etsyshipping:cloud:orders:v1";
const money = { amount: 1250, divisor: 100, currency_code: "USD" };
function receipt(id = 1001) {
  return { receipt_id: id, create_timestamp: 1805000000, update_timestamp: 1805000100,
    status: "paid", is_paid: true, is_shipped: false, name: "Private Buyer", first_line: "123 Test Street",
    city: "Seattle", state: "WA", zip: "00123", country_iso: "US", grandtotal: money,
    transactions: [{ transaction_id: id + 5000, listing_id: 30, listing_image_id: 40,
      title: "Brass bookmark", sku: "GOLD-15", quantity: 2, price: money, is_digital: false,
      variations: [{ formatted_name: "Color", formatted_value: "Gold" }, { formatted_name: "Size", formatted_value: "15 cm" }] }] };
}
function fixture() {
  const env = { VERCEL: "1", SITE_ADMIN_USERNAME: "admin", SITE_ADMIN_PASSWORD: password,
    ETSY_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    UPSTASH_REDIS_REST_URL: "https://test.upstash.io", UPSTASH_REDIS_REST_TOKEN: "test-redis-secret",
    SITE_PUBLIC_ORIGIN: "https://test.example" };
  const oldEnv = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])); Object.assign(process.env, env);
  const oldFetch = globalThis.fetch, kv = new Map(), hashes = new Map(), indexes = new Map();
  const calls = []; let redisFault = () => false; let etsy = async (url) => {
    if (url.pathname.endsWith("/oauth/token")) return Response.json({ access_token: "77.private-access", refresh_token: "77.private-refresh", expires_in: 3600, scope: "transactions_r" });
    if (/\/shops\/\d+$/.test(url.pathname)) return Response.json({ shop_id: 12345, user_id: 77 });
    if (url.pathname.endsWith("/receipts")) return Response.json({ count: 1, results: [receipt()] });
    if (url.pathname.endsWith("/images/40")) return Response.json({ listing_id: 30, listing_image_id: 40, url_fullxfull: "https://i.etsystatic.com/test.jpg" });
    throw new Error(`Unexpected Etsy endpoint ${url}`);
  };
  const h = (key) => { if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url); calls.push({ url: parsed, options });
    assert.equal(options.redirect, "error");
    if (parsed.hostname === "api.etsy.com") return etsy(parsed, options);
    assert.equal(parsed.origin, "https://test.upstash.io");
    const [cmd, ...args] = JSON.parse(options.body); let result = null;
    if (redisFault(cmd, args)) return Response.json({ error: "Private storage failure" }, { status: 503 });
    if (cmd === "GET") result = kv.get(args[0]) ?? null;
    else if (cmd === "SET") {
      if (args.includes("NX") && kv.has(args[0])) result = null;
      else { kv.set(args[0], args[1]); result = "OK"; }
    } else if (cmd === "DEL") result = Number(kv.delete(args[0]));
    else if (cmd === "HGET") result = h(args[0]).get(args[1]) ?? null;
    else if (cmd === "HSET") { h(args[0]).set(args[1], args[2]); result = 1; }
    else if (cmd === "HGETALL") result = [...h(args[0])].flat();
    else if (cmd === "HMGET") result = args.slice(1).map((id) => h(args[0]).get(id) ?? null);
    else if (cmd === "ZCARD") result = indexes.get(args[0])?.size || 0;
    else if (cmd === "ZREVRANGE") result = [...(indexes.get(args[0]) || [])].sort((a, b) => b[1] - a[1]).slice(args[1], args[2] + 1).map(([key]) => key);
    else if (cmd === "EVAL") {
      const [script, count, ...rest] = args, keys = rest.slice(0, count), values = rest.slice(count);
      if (script.includes("INCR")) result = 1;
      else if (script.includes("ZADD")) {
        if (kv.get(keys[0]) !== values[0]) result = 0;
        else {
          h(keys[1]).set(values[1], values[2]);
          if (!indexes.has(keys[2])) indexes.set(keys[2], new Map());
          indexes.get(keys[2]).set(values[1], Number(values[3])); kv.set(keys[3], values[4]); result = 1;
        }
      } else if (script.includes("HLEN")) {
        result = (h(keys[0]).get(values[0]) || "") === values[1] ? 1 : 0;
        if (result) h(keys[0]).set(values[0], values[2]);
      } else if (script.includes("redis.call('DEL'")) result = kv.get(keys[0]) === values[0] ? Number(kv.delete(keys[0])) : 0;
      else throw new Error(`Unexpected script ${script}`);
    } else throw new Error(`Unexpected Redis command ${cmd}`);
    return Response.json({ result });
  };
  async function call(route, { method = "GET", body, session = "", headers = {} } = {}) {
    const request = Object.assign(Readable.from([]), { url: `/api/bridge?route=${route}`, method, body,
      headers: { host: "test.example", origin: "https://test.example", "x-admin-action": "1", cookie: session, ...headers } });
    const result = {};
    await handler(request, { writeHead(status, headers) { Object.assign(result, { status, headers }); }, end(value) { result.data = JSON.parse(value); } });
    return result;
  }
  const login = async () => (await call("login", { method: "POST", body: { userName: "admin", password } })).headers["Set-Cookie"].split(";")[0];
  const post = (route, session, body = {}) => call(route, { method: "POST", body, session });
  const add = (session, shopId = "12345", enabled = true) => post("admin-etsy-config", session,
    { shopId, name: `Shop ${shopId}`, enabled, revision: 0, keystring: "private-keystring", sharedSecret: "private-shared-secret" });
  const authorize = async (session, shopId = "12345") => {
    const begin = await post("etsy-authorize", session, { shopId }); assert.equal(begin.status, 200);
    return post("etsy-callback", session, { state: new URL(begin.data.url).searchParams.get("state"), code: "mock-code" });
  };
  const finish = async (session, job) => {
    for (let i = 0; i < 100 && job.status === "running"; i++) {
      const next = await post("etsy-sync-step", session, { jobId: job.id }); assert.equal(next.status, 200, JSON.stringify(next.data)); job = next.data.job;
    }
    assert.equal(job.status, "completed"); return job;
  };
  return { kv, hashes, calls, call, login, post, add, authorize, finish, h,
    useEtsy(fn) { etsy = fn; }, fault(fn) { redisFault = fn; }, restore() { globalThis.fetch = oldFetch; for (const k of Object.keys(env)) {
      if (oldEnv[k] === undefined) delete process.env[k]; else process.env[k] = oldEnv[k];
    } } };
}

test("cloud endpoints enforce admin sessions, CSRF and method restrictions", async () => {
  const f = fixture();
  try {
    for (const route of ["etsy-authorize", "etsy-callback", "etsy-sync-start", "etsy-sync-step", "etsy-sync-retry", "etsy-sync-status", "etsy-cloud-orders"]) {
      assert.equal((await f.post(route, "", { role: "admin" })).status, 403);
      assert.equal((await f.call(route, { headers: { authorization: "Bearer ordinary" } })).status, 403);
    }
    assert.equal(f.calls.length, 0);
    const session = await f.login();
    assert.equal((await f.call("etsy-sync-start", { session })).status, 405);
    assert.equal((await f.call("etsy-sync-start", { session, method: "POST", body: {}, headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal((await f.call("etsy-cloud-orders&offset=-1", { session })).status, 400);
    assert.equal((await f.post("etsy-sync-start", session, {})).status, 400);
  } finally { f.restore(); }
});
test("PKCE authorization is bound to session, configured shop owner, one-time state and revision", async () => {
  const f = fixture();
  try {
    const session = await f.login(); await f.add(session);
    const begin = await f.post("etsy-authorize", session, { shopId: "12345" });
    const url = new URL(begin.data.url), state = url.searchParams.get("state");
    assert.equal(url.origin, "https://www.etsy.com"); assert.equal(url.searchParams.get("scope"), "transactions_r");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("redirect_uri"), "https://test.example/etsy-callback.html");
    const other = await f.login();
    assert.equal((await f.post("etsy-callback", other, { state, code: "mock-code" })).status, 403);
    assert.equal((await f.post("etsy-callback", session, { state, code: "mock-code" })).status, 200);
    assert.equal((await f.post("etsy-callback", session, { state, code: "mock-code" })).status, 400);
    const listed = await f.call("admin-etsy-config", { session });
    assert.equal(listed.data.items[0].authorized, true);
    assert.doesNotMatch(JSON.stringify(listed), /private-access|private-refresh|private-shared-secret/);
    await f.add(session, "99999");
    assert.equal((await f.authorize(session, "99999")).status, 403);
    assert.equal(openConfig(f.h(CONFIG_KEY).get("99999"), "99999").oauth, undefined);
    const pending = await f.post("etsy-authorize", session, { shopId: "12345" });
    const saved = await f.post("admin-etsy-config", session, { shopId: "12345", name: "Changed", enabled: true, revision: 2,
      keystring: "new-keystring", sharedSecret: "new-shared-secret" }); assert.equal(saved.status, 200); assert.equal(saved.data.item.authorized, false);
    assert.equal((await f.post("etsy-callback", session, { state: new URL(pending.data.url).searchParams.get("state"), code: "mock-code" })).status, 409);
  } finally { f.restore(); }
});
test("one-click pipeline persists encrypted orders with images, deduplicates, incrementally updates, and matches English CSV schema", async () => {
  const f = fixture();
  try {
    const session = await f.login(); await f.add(session); assert.equal((await f.authorize(session)).status, 200);
    await f.add(session, "23456", false); await f.add(session, "34567", true);
    let job = (await f.post("etsy-sync-start", session)).data.job;
    assert.equal(job.shops.length, 2); assert.equal(job.shops[1].status, "skipped");
    assert.equal((await f.post("etsy-sync-start", session)).data.job.id, job.id);
    job = await f.finish(session, job); assert.equal(job.shops[0].inserted, 1);
    const stored = await f.call("etsy-cloud-orders", { session }); assert.equal(stored.data.total, 1);
    const order = stored.data.items[0]; assert.equal(order.items[0].imageUrl, "https://i.etsystatic.com/test.jpg");
    assert.equal(order.items[0].variations[1].value, "15 cm"); assert.equal(order.postal, "00123");
    const rows = cloudCsvRows([order]); assert.deepEqual(Object.keys(rows[0]), [...ORDER_CSV_COLUMNS]);
    assert.equal(rows[0].amount, 12.5); assert.equal(rows[0].quantity, 2); assert.match(rows[0].variation, /Color: Gold; Size: 15 cm/);
    assert.equal(csvParse(csvEncode(rows, ORDER_CSV_COLUMNS))[0].postal, "00123");
    for (const encrypted of [...f.kv.values(), ...f.h(ORDERS).values(), ...f.h(CONFIG_KEY).values()])
      assert.doesNotMatch(encrypted, /Private Buyer|123 Test Street|private-access|private-refresh|private-shared-secret/);
    job = await f.finish(session, (await f.post("etsy-sync-start", session)).data.job);
    assert.equal(job.shops[0].inserted, 0); assert.equal(job.shops[0].unchanged, 1);
    const requests = f.calls.filter((c) => c.url.pathname.endsWith("/receipts"));
    assert.equal(Number(requests[1].url.searchParams.get("min_last_modified")), job.shops[0].from);
    assert.ok(job.shops[0].from > Math.floor(Date.now() / 1000) - 1000);
    f.useEtsy(async (url) => url.pathname.endsWith("/receipts") ? Response.json({ count: 1, results: [{ ...receipt(), name: "Updated Buyer", update_timestamp: 1805000200 }] })
      : Response.json({ listing_id: 30, listing_image_id: 40, url_fullxfull: "https://i.etsystatic.com/test.jpg" }));
    job = await f.finish(session, (await f.post("etsy-sync-start", session)).data.job);
    assert.equal(job.shops[0].updated, 1); assert.equal((await f.call("etsy-cloud-orders", { session })).data.total, 1);
  } finally { f.restore(); }
});
test("pagination resumes, refreshes expiring tokens, preserves missing-data warnings and isolates store failures", async () => {
  const f = fixture();
  try {
    const session = await f.login(); await f.add(session); await f.authorize(session);
    let row = openConfig(f.h(CONFIG_KEY).get("12345"), "12345"); row.oauth.expiresAt = 0; f.h(CONFIG_KEY).set("12345", sealConfig(row, "12345"));
    await f.add(session, "23456");
    row = openConfig(f.h(CONFIG_KEY).get("23456"), "23456"); row.oauth = { access: "88.private-access", refresh: "88.private-refresh", expiresAt: Date.now() + 3600000 };
    f.h(CONFIG_KEY).set("23456", sealConfig(row, "23456"));
    let refreshes = 0;
    f.useEtsy(async (url, options) => {
      if (url.pathname.endsWith("/oauth/token")) { refreshes++; assert.equal(new URLSearchParams(options.body).get("grant_type"), "refresh_token");
        return Response.json({ access_token: "77.rotated-access", refresh_token: "77.rotated-refresh", expires_in: 3600 }); }
      if (url.pathname.includes("23456")) return Response.json({}, { status: 403 });
      if (url.pathname.endsWith("/receipts")) {
        const offset = Number(url.searchParams.get("offset"));
        return Response.json({ count: 11, results: Array.from({ length: offset ? 1 : 10 }, (_, i) => ({ ...receipt(1001 + offset + i), first_line: null, country_iso: null })) });
      }
      return Response.json({}, { status: 404 });
    });
    let job = (await f.post("etsy-sync-start", session)).data.job;
    job = (await f.post("etsy-sync-step", session, { jobId: job.id })).data.job;
    assert.equal(job.shops[0].fetched, 10); assert.equal(job.shops[0].inserted, 0);
    assert.equal((await f.call("etsy-sync-status", { session })).data.job.id, job.id);
    job = await f.finish(session, job);
    assert.equal(refreshes, 1); assert.equal(job.shops[0].inserted, 11); assert.equal(job.shops[0].warnings, 11);
    assert.equal(job.shops[1].status, "failed"); assert.match(job.shops[1].error, /403/);
    assert.equal(openConfig(f.h(CONFIG_KEY).get("23456"), "23456").lastSyncedAt, undefined);
    assert.equal(openConfig(f.h(CONFIG_KEY).get("12345"), "12345").oauth.refresh, "77.rotated-refresh");
    f.useEtsy(async () => Response.json({ count: 0, results: [] }));
    job = await f.finish(session, (await f.post("etsy-sync-retry", session, { jobId: job.id })).data.job);
    assert.equal(job.shops[0].inserted, 11); assert.equal(job.shops[1].status, "done");
  } finally { f.restore(); }
});
test("rate-limit waits survive reload, unsafe images are rejected, and changed configurations stop old jobs", async () => {
  const f = fixture();
  try {
    const session = await f.login(); await f.add(session); await f.authorize(session);
    f.useEtsy(async () => Response.json({}, { status: 429, headers: { "Retry-After": "120" } }));
    let job = (await f.post("etsy-sync-start", session)).data.job;
    job = (await f.post("etsy-sync-step", session, { jobId: job.id })).data.job;
    assert.ok(job.retryAt >= Date.now() + 119000); assert.equal(job.shops[0].status, "running");
    const before = f.calls.filter((c) => c.url.hostname === "api.etsy.com").length;
    await f.post("etsy-sync-step", session, { jobId: job.id });
    assert.equal(f.calls.filter((c) => c.url.hostname === "api.etsy.com").length, before);
    assert.equal(safeImageUrl("https://evil.example/photo.jpg"), ""); assert.equal(safeImageUrl("javascript:alert(1)"), "");
    assert.equal(safeImageUrl("https://i.etsystatic.com@evil.example/photo.jpg"), "");
    const raw = openConfig(f.kv.get(JOB), JOB); raw.retryAt = 0; f.kv.set(JOB, sealConfig(raw, JOB));
    await f.post("admin-etsy-config", session, { shopId: "12345", name: "Disabled", enabled: false, revision: 2 });
    job = await f.finish(session, job); assert.equal(job.shops[0].status, "failed");
    assert.equal((await f.call("etsy-cloud-orders", { session })).data.total, 0);
  } finally { f.restore(); }
});
test("storage failures cannot advance an order checkpoint, concurrent steps are locked, and revoked sessions cannot resume", async () => {
  const f = fixture();
  try {
    const session = await f.login(); await f.add(session); await f.authorize(session);
    let job = (await f.post("etsy-sync-start", session)).data.job;
    await f.post("etsy-sync-step", session, { jobId: job.id }); // Fetch pending page.
    const original = f.kv.get(JOB);
    f.fault((cmd, args) => cmd === "EVAL" && args[0].includes("ZADD"));
    const failed = await f.post("etsy-sync-step", session, { jobId: job.id }); assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(failed), /Private storage/);
    assert.equal(f.kv.get(JOB), original); assert.equal(f.h(ORDERS).size, 0);
    f.fault(() => false);
    f.kv.set("etsyshipping:cloud:lock:v1", "other-operation");
    assert.equal((await f.post("etsy-sync-step", session, { jobId: job.id })).status, 409);
    assert.equal(f.kv.get(JOB), original);
    f.kv.delete("etsyshipping:cloud:lock:v1");
    job = await f.finish(session, job); assert.equal(job.shops[0].inserted, 1);
    await f.post("admin-logout", session);
    assert.equal((await f.post("etsy-sync-step", session, { jobId: job.id })).status, 403);
    assert.equal((await f.call("etsy-cloud-orders", { session })).status, 403);
  } finally { f.restore(); }
});
test("malformed or drifting pagination never advances sync watermark and does not block other shops", async () => {
  const f = fixture();
  try {
    const session = await f.login(); await f.add(session); await f.authorize(session);
    await f.add(session, "23456");
    const second = openConfig(f.h(CONFIG_KEY).get("23456"), "23456");
    second.oauth = { access: "88.private-access", refresh: "88.private-refresh", expiresAt: Date.now() + 3600000 };
    f.h(CONFIG_KEY).set("23456", sealConfig(second, "23456"));
    f.useEtsy(async (url) => {
      if (url.pathname.includes("23456")) return Response.json({ count: 0, results: [] });
      if (url.pathname.endsWith("/receipts")) return Response.json({ count: 1, results: [{ ...receipt(), grandtotal: null }] });
      throw new Error("Unexpected call");
    });
    let job = await f.finish(session, (await f.post("etsy-sync-start", session)).data.job);
    assert.equal(job.shops[0].status, "failed"); assert.equal(job.shops[1].status, "done");
    assert.equal(openConfig(f.h(CONFIG_KEY).get("12345"), "12345").lastSyncedAt, undefined);
    f.useEtsy(async (url) => {
      if (url.pathname.endsWith("/receipts")) return Number(url.searchParams.get("offset")) === 0
        ? Response.json({ count: 11, results: Array.from({ length: 10 }, (_, i) => receipt(1001 + i)) })
        : Response.json({ count: 10, results: [] });
      return Response.json({}, { status: 404 });
    });
    job = await f.finish(session, (await f.post("etsy-sync-retry", session, { jobId: job.id })).data.job);
    assert.equal(job.shops[0].status, "failed"); assert.equal(job.shops[0].inserted, 10);
    assert.match(job.shops[0].error, /分页/);
    assert.equal(openConfig(f.h(CONFIG_KEY).get("12345"), "12345").lastSyncedAt, undefined);
  } finally { f.restore(); }
});
