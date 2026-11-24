import { createHash, randomBytes } from "node:crypto";
import { redis, sealConfig, openConfig, CONFIG_KEY, listConfigs, cookieToken } from "./admin-config.mjs";
import { createAuthorization } from "../scripts/etsy-client.mjs";
import { bundleFromReceipts, etsyId, etsyWarnings } from "../dist/etsy-orders.js";

const JOB = "etsyshipping:cloud:job:v1", LOCK = "etsyshipping:cloud:lock:v1";
const ORDERS = "etsyshipping:cloud:orders:v1", INDEX = "etsyshipping:cloud:index:v1";
const API = "https://api.etsy.com/v3/application";
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const hash = (v) => createHash("sha256").update(v).digest("hex");
const iso = () => new Date().toISOString();

// Serialize configuration edits, token refresh, OAuth completion and sync steps across instances.
export async function withCloudLock(fn) {
  const token = randomBytes(24).toString("hex");
  if (await redis(["SET", LOCK, token, "NX", "EX", 90]) !== "OK")
    throw fail(409, "另一个同步或配置操作正在进行，请稍后重试。");
  try { return await fn(token); }
  finally {
    await redis(["EVAL", "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0", 1, LOCK, token]);
  }
}
async function config(shopId) {
  const id = etsyId(shopId), raw = await redis(["HGET", CONFIG_KEY, id]);
  if (!raw) throw fail(404, "店铺配置不存在。");
  return openConfig(raw, id);
}
async function putConfig(row) {
  await redis(["HSET", CONFIG_KEY, row.shopId, sealConfig(row, row.shopId)]);
}
function redirectUri() {
  let url;
  try { url = new URL(process.env.SITE_PUBLIC_ORIGIN); } catch { throw fail(503, "请配置正式 HTTPS 网站的 SITE_PUBLIC_ORIGIN。"); }
  if (url.protocol !== "https:" || url.origin !== process.env.SITE_PUBLIC_ORIGIN)
    throw fail(503, "SITE_PUBLIC_ORIGIN 必须是 HTTPS 源地址，不带路径或尾部斜杠。");
  return `${url.origin}/etsy-callback.html`;
}
export async function startAuthorization(request, input) {
  const row = await config(input?.shopId);
  const auth = createAuthorization({ keystring: row.keystring, redirectUri: redirectUri() });
  const stateKey = `etsyshipping:oauth:${hash(auth.state)}`;
  const record = { shopId: row.shopId, revision: row.revision, verifier: auth.verifier,
    redirectUri: redirectUri(), session: hash(cookieToken(request)), expires: Date.now() + 600000 };
  await redis(["SET", stateKey, sealConfig(record, stateKey), "EX", 600]);
  return { url: auth.url, redirectUri: record.redirectUri };
}
async function jsonFetch(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(8000) }); }
  catch { throw fail(502, "Etsy 连接超时或不可用，请稍后重试。", { retryAfter: 3 }); }
  if (!response.ok) {
    const raw = response.headers.get("retry-after");
    const seconds = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw)
      : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 3;
    throw fail(502, `Etsy 请求失败（HTTP ${response.status}）${response.status === 401 || response.status === 403 ? "，请检查应用权限或重新授权店铺" : ""}。`, {
      upstreamStatus: response.status,
      ...((response.status === 429 || response.status >= 500) ? { retryAfter: Math.max(1, Number.isFinite(seconds) ? seconds : 3) } : {}),
    });
  }
  // Never return Etsy's unfiltered error response, which may contain credentials or personal data.
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw fail(502, "Etsy 响应过大，请缩小同步范围。");
  try { return JSON.parse(raw); } catch { throw fail(502, "Etsy 返回了无效 JSON。"); }
}
async function exchange(row, parameters) {
  const data = await jsonFetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: row.keystring, ...parameters }),
  });
  if (typeof data.access_token !== "string" || !/^[1-9]\d*\.[\x21-\x7e]+$/.test(data.access_token) ||
      data.access_token.length > 4000 || typeof data.refresh_token !== "string" || !data.refresh_token ||
      data.refresh_token.length > 4000 || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      (data.scope && !String(data.scope).split(" ").includes("transactions_r")))
    throw fail(502, "Etsy 授权响应缺少有效的订单读取凭据。");
  return { access: data.access_token, refresh: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
}
async function get(row, path, params = {}, authenticated = true) {
  // Fixed host, read-only endpoints, validated numeric identifiers: never a general proxy.
  if (!/^\/shops\/[1-9]\d*(?:\/receipts)?$/.test(path) &&
      !/^\/listings\/[1-9]\d*\/images\/[1-9]\d*$/.test(path)) throw fail(400, "不允许的 Etsy 读取接口。");
  if (authenticated && !row.oauth) throw fail(400, "请先完成店主授权。");
  if (authenticated && row.oauth.expiresAt <= Date.now() + 60000) {
    row.oauth = await exchange(row, { grant_type: "refresh_token", refresh_token: row.oauth.refresh });
    await putConfig(row); // Persist rotated refresh tokens before any further API request.
  }
  const url = new URL(API + path); url.search = new URLSearchParams(params);
  const request = () => jsonFetch(url, { headers: { "x-api-key": `${row.keystring}:${row.sharedSecret}`,
    ...(authenticated ? { Authorization: `Bearer ${row.oauth.access}` } : {}), Accept: "application/json" } });
  try { return await request(); }
  catch (e) {
    if (!authenticated || e.upstreamStatus !== 401) throw e;
    row.oauth = await exchange(row, { grant_type: "refresh_token", refresh_token: row.oauth.refresh });
    await putConfig(row);
    return request();
  }
}
export async function completeAuthorization(request, input) {
  if (!input || typeof input.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.state) ||
      typeof input.code !== "string" || !input.code || input.code.length > 2000) throw fail(400, "授权回调无效，请重新发起授权。");
  return withCloudLock(async () => {
    const key = `etsyshipping:oauth:${hash(input.state)}`, raw = await redis(["GET", key]);
    if (!raw) throw fail(400, "授权已使用或已过期，请重新授权。");
    const state = openConfig(raw, key);
    if (state.expires <= Date.now() || state.session !== hash(cookieToken(request))) throw fail(403, "请使用发起授权的管理员会话完成授权。");
    const row = await config(state.shopId);
    if (row.revision !== state.revision || state.redirectUri !== redirectUri()) throw fail(409, "店铺配置已改变，请重新授权。");
    await redis(["DEL", key]); // One-time code and state, even when the exchange fails.
    const oauth = await exchange(row, { grant_type: "authorization_code", code: input.code,
      code_verifier: state.verifier, redirect_uri: state.redirectUri });
    const shop = await get(row, `/shops/${row.shopId}`, {}, false);
    if (etsyId(shop.shop_id) !== row.shopId || etsyId(shop.user_id) !== oauth.access.split(".")[0])
      throw fail(403, "授权的 Etsy 账号不是这个 Shop ID 的店主，未保存授权。");
    row.oauth = oauth; row.revision++; row.updatedAt = iso();
    await putConfig(row);
    return { ok: true, shopId: row.shopId, name: row.name };
  });
}

function publicJob(job) {
  if (!job) return null;
  return { id: job.id, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt || null,
    retryAt: job.retryAt || null, shops: job.shops.map(({ shopId, name, status, from, to, inserted, updated, unchanged, warnings, error, offset, total }) =>
      ({ shopId, name, status, from, to, inserted, updated, unchanged, warnings, error, fetched: offset, total })) };
}
async function readJob() {
  const raw = await redis(["GET", JOB]); return raw ? openConfig(raw, JOB) : null;
}
async function writeJob(job) { await redis(["SET", JOB, sealConfig(job, JOB)]); }
export async function syncStatus() { return { job: publicJob(await readJob()) }; }
export async function startSync(input = {}) {
  return withCloudLock(async () => {
    const current = await readJob();
    if (current?.status === "running") return { job: publicJob(current) };
    const to = Math.floor(Date.now() / 1000);
    const from = input?.since ? Math.floor(Date.parse(input.since) / 1000) : to - 30 * 86400;
    if (!Number.isSafeInteger(from) || from < 946684800 || from > to) throw fail(400, "同步起始日期无效。");
    const shops = (await listConfigs()).filter((r) => r.enabled).map((r) => ({
      shopId: r.shopId, name: r.name, revision: r.revision,
      from: !input?.since && r.lastSyncedAt ? Math.max(946684800, Math.floor(Date.parse(r.lastSyncedAt) / 1000) - 300) : from,
      to, offset: 0, total: null, pending: [], lastPage: false, lastReceiptId: "", imageIndex: 0,
      inserted: 0, updated: 0, unchanged: 0, warnings: 0,
      status: r.authorized ? "pending" : "skipped", error: r.authorized ? "" : "尚未完成店主授权",
    }));
    if (!shops.length) throw fail(400, "没有启用的店铺，请先添加、授权并启用店铺。");
    const job = { id: randomBytes(16).toString("hex"), startedAt: iso(), status: shops.some((s) => s.status === "pending") ? "running" : "completed", shops };
    await writeJob(job); return { job: publicJob(job) };
  });
}
export async function retrySync(input) {
  return withCloudLock(async () => {
    const job = await readJob();
    if (!job || job.id !== input?.jobId) throw fail(409, "任务已改变，请刷新。");
    for (const s of job.shops.filter((s) => ["failed", "skipped"].includes(s.status))) {
      const row = await config(s.shopId);
      if (!row.enabled || !row.oauth) continue;
      Object.assign(s, { revision: row.revision, name: row.name, status: "pending", error: "", offset: 0,
        total: null, pending: [], lastPage: false, lastReceiptId: "", imageIndex: 0, inserted: 0, updated: 0, unchanged: 0, warnings: 0 });
    }
    job.status = job.shops.some((s) => ["pending", "running"].includes(s.status)) ? "running" : "completed";
    job.retryAt = null; job.failures = 0; delete job.finishedAt;
    await writeJob(job); return { job: publicJob(job) };
  });
}
export function safeImageUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "i.etsystatic.com" &&
    !url.username && !url.password && !url.port && url.href.length <= 4000 ? url.href : ""; } catch { return ""; }
}
async function commitOrder(job, shop, row, lock) {
  const key = `${shop.shopId}:${row.receiptId}`, raw = await redis(["HGET", ORDERS, key]);
  const old = raw ? openConfig(raw, key) : null;
  const value = { ...row, shopId: shop.shopId, shopName: shop.name };
  const changed = !old || (Date.parse(value.updatedAt) >= Date.parse(old.updatedAt) && JSON.stringify(value) !== JSON.stringify(old));
  shop[!old ? "inserted" : changed ? "updated" : "unchanged"]++;
  if (etsyWarnings(row).length || row.items.some((i) => !i.imageUrl)) shop.warnings++;
  shop.pending.shift(); shop.imageIndex = 0;
  const script = "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('HSET',KEYS[2],ARGV[2],ARGV[3]); redis.call('ZADD',KEYS[3],ARGV[4],ARGV[2]); redis.call('SET',KEYS[4],ARGV[5]); return 1";
  const saved = await redis(["EVAL", script, 4, LOCK, ORDERS, INDEX, JOB, lock, key,
    changed ? sealConfig(value, key) : raw, Math.floor(Date.parse(row.createdAt) / 1000), sealConfig(job, JOB)]);
  if (saved !== 1) throw fail(409, "同步锁已失效，请继续任务。");
}
export async function stepSync(input) {
  return withCloudLock(async (lock) => {
    const job = await readJob();
    if (!job || job.id !== input?.jobId) throw fail(409, "任务已改变，请刷新同步状态。");
    if (job.status !== "running" || job.retryAt > Date.now()) return { job: publicJob(job) };
    const s = job.shops.find((s) => ["pending", "running"].includes(s.status));
    if (!s) { job.status = "completed"; job.finishedAt = iso(); await writeJob(job); return { job: publicJob(job) }; }
    try {
      const row = await config(s.shopId);
      if (!row.enabled || !row.oauth || row.revision !== s.revision) throw fail(409, "店铺已停用、授权失效或配置改变，请检查后重试此店铺。");
      s.status = "running"; s.error = "";
      if (s.pending.length) {
        const order = s.pending[0], item = order.items[s.imageIndex];
        if (item) {
          item.imageUrl = "";
          if (item.listingId && item.imageId) {
            try {
              const data = await get(row, `/listings/${item.listingId}/images/${item.imageId}`, {}, false);
              if (etsyId(data.listing_id) !== item.listingId || etsyId(data.listing_image_id) !== item.imageId) throw fail(502, "图片标识不匹配。");
              item.imageUrl = safeImageUrl(data.url_fullxfull);
              if (!item.imageUrl) item.imageWarning = "图片地址不可用";
            } catch (e) {
              if (e.retryAfter || ![403, 404].includes(e.upstreamStatus)) throw e;
              item.imageWarning = "商品图片已删除或无访问权限";
            }
          } else item.imageWarning = "订单未提供商品图片标识";
          s.imageIndex++;
        }
        if (s.imageIndex >= order.items.length) {
          job.failures = 0; job.retryAt = null;
          await commitOrder(job, s, order, lock);
          return { job: publicJob(job) };
        }
      } else if (s.lastPage) {
        row.lastSyncedAt = new Date(s.to * 1000).toISOString();
        await putConfig(row); s.status = "done";
      } else {
        const page = await get(row, `/shops/${s.shopId}/receipts`, { min_last_modified: s.from,
          max_last_modified: s.to, limit: 10, offset: s.offset, sort_on: "receipt_id", sort_order: "asc" });
        if (!Array.isArray(page.results) || page.results.length > 10 || !Number.isSafeInteger(page.count) || page.count < 0 ||
            (s.total !== null && s.total !== page.count) || s.offset + page.results.length > page.count)
          throw fail(502, "订单分页发生变化或不完整，请重试此店铺。");
        const bundle = bundleFromReceipts(page.results, { shopId: s.shopId, shopName: s.name });
        for (const order of bundle.orders) {
          if (s.lastReceiptId && BigInt(order.receiptId) <= BigInt(s.lastReceiptId)) throw fail(502, "订单分页出现重复或乱序，请重试。");
          s.lastReceiptId = order.receiptId;
        }
        s.total = page.count; s.offset += bundle.orders.length; s.lastPage = s.offset >= s.total;
        if (!s.lastPage && bundle.orders.length !== 10) throw fail(502, "订单分页不完整，请重试此店铺。");
        s.pending = bundle.orders;
      }
      job.failures = 0; job.retryAt = null;
    } catch (e) {
      if (e.status === 503) throw e; // Storage failure must not turn into a completed/advanced task.
      if (e.retryAfter && (job.failures || 0) < 3) {
        job.failures = (job.failures || 0) + 1; job.retryAt = Date.now() + e.retryAfter * 1000;
        s.error = `${e.message} 正在等待重试。`;
      } else { s.status = "failed"; s.error = e.status ? e.message : "Etsy 订单字段格式不完整，请检查后重试此店铺。"; s.pending = []; job.failures = 0; job.retryAt = null; }
    }
    if (!job.shops.some((s) => ["pending", "running"].includes(s.status))) { job.status = "completed"; job.finishedAt = iso(); }
    await writeJob(job); return { job: publicJob(job) };
  });
}
export async function listCloudOrders(input) {
  const offset = Number(input?.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) throw fail(400, "订单分页参数无效。");
  const ids = await redis(["ZREVRANGE", INDEX, offset, offset + 24]);
  if (!Array.isArray(ids)) throw fail(503, "订单索引不可用。");
  const rows = ids.length ? await redis(["HMGET", ORDERS, ...ids]) : [];
  if (!Array.isArray(rows) || rows.some((r) => !r)) throw fail(503, "订单存储不完整，请联系维护人员。");
  return { items: rows.map((raw, i) => openConfig(raw, ids[i])), total: await redis(["ZCARD", INDEX]), offset };
}
