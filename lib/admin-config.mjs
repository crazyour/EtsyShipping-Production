import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

const COOKIE = "etsy_site_admin";
const TTL = 15 * 60;
export const CONFIG_KEY = "etsyshipping:admin:etsy-config:v1";
const error = (status, message) => Object.assign(new Error(message), { status });
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function matchesSecret(a, b) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
function encryptionKey() {
  const value = process.env.ETSY_CONFIG_ENCRYPTION_KEY || "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw error(503, "尚未配置 API 密钥加密密钥。");
  return key;
}
function redisConfig() {
  let url;
  try { url = new URL(process.env.UPSTASH_REDIS_REST_URL); } catch {
    throw error(503, "尚未配置服务端持久存储，不能保存 API 密钥。");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".upstash.io") ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.port ||
      !process.env.UPSTASH_REDIS_REST_TOKEN)
    throw error(503, "服务端持久存储配置无效。");
  return { url: url.origin, token: process.env.UPSTASH_REDIS_REST_TOKEN };
}
export function adminSetup() {
  const password = process.env.SITE_ADMIN_PASSWORD || "";
  if (password.length < 16 || !/[a-zA-Z]/.test(password) || !/[^a-zA-Z]/.test(password) ||
      password.toLowerCase().includes("admin") || new Set(password).size < 8)
    return { ready: false, reason: "真实 API 配置已锁定：请先把站点管理员密码改为至少 16 位的强密码（不要包含 admin）。" };
  try { encryptionKey(); redisConfig(); }
  catch (e) { return { ready: false, reason: e.message }; }
  return { ready: true };
}
export async function redis(command) {
  const { url, token } = redisConfig();
  try {
    const response = await fetch(url, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command), signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (result.error || !Object.hasOwn(result, "result")) throw new Error();
    return result.result;
  } catch { throw error(503, "安全存储暂不可用，操作未确认，请稍后刷新重试。"); }
}
export function requireSameOrigin(request) {
  if (request.headers["x-admin-action"] !== "1") throw error(403, "缺少安全请求标记。");
  if (request.headers["sec-fetch-site"] === "cross-site") throw error(403, "不允许跨站管理请求。");
  const origin = request.headers.origin;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw error(403, "请求来源无效。"); }
    const expected = process.env.SITE_PUBLIC_ORIGIN || `${process.env.VERCEL ? "https" : "http"}://${request.headers.host}`;
    if (parsed.origin !== expected) throw error(403, "不允许跨站管理请求。");
  }
}
export function cookieToken(request) {
  const parts = String(request.headers.cookie || "").split(";").map((v) => v.trim());
  const matches = parts.filter((v) => v.startsWith(`${COOKIE}=`));
  const token = matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : "";
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}
function version() {
  return createHmac("sha256", encryptionKey()).update(
    `${process.env.SITE_ADMIN_USERNAME || "admin"}\0${process.env.SITE_ADMIN_PASSWORD}`,
  ).digest("hex");
}
export function cookie(value, maxAge = TTL) {
  return `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.VERCEL ? "; Secure" : ""}`;
}
export async function limitAdminLogin() {
  // Global cap protects all serverless instances without trusting caller-supplied IP headers.
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
  const count = await redis(["EVAL", script, 1, "etsyshipping:admin:login-attempts", 900]);
  if (!Number.isInteger(count) || count > 30) throw error(429, "管理员登录尝试过多，请 15 分钟后重试。");
}
export async function issueAdminSession(request) {
  requireSameOrigin(request);
  const setup = adminSetup();
  if (!setup.ready) throw error(503, setup.reason);
  await revokeAdminSession(request);
  const token = randomBytes(32).toString("hex");
  const session = { actor: process.env.SITE_ADMIN_USERNAME || "admin", version: version(), expires: Date.now() + TTL * 1000 };
  await redis(["SET", `etsyshipping:admin:session:${hash(token)}`, JSON.stringify(session), "EX", TTL]);
  return cookie(token);
}
export async function revokeAdminSession(request) {
  const token = cookieToken(request);
  if (token) await redis(["DEL", `etsyshipping:admin:session:${hash(token)}`]);
}
export async function requireAdmin(request) {
  if (!adminSetup().ready || !cookieToken(request)) throw error(403, "仅经过服务端验证的站点管理员可以设置 API，请重新登录。");
  const raw = await redis(["GET", `etsyshipping:admin:session:${hash(cookieToken(request))}`]);
  let session;
  try { session = JSON.parse(raw); } catch { /* Invalid sessions fail closed. */ }
  if (!session || session.expires <= Date.now() || session.version !== version() ||
      session.actor !== (process.env.SITE_ADMIN_USERNAME || "admin"))
    throw error(403, "管理员会话已失效，请重新登录。");
  return session.actor;
}
export function sealConfig(value, shopId) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`etsy-config:v1:${shopId}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}
export function openConfig(raw, shopId) {
  try {
    const { v, iv, tag, data } = JSON.parse(raw);
    if (v !== 1) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    cipher.setAAD(Buffer.from(`etsy-config:v1:${shopId}`));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, "base64")), cipher.final()]).toString("utf8"));
  } catch { throw error(503, "无法解密 API 配置，请检查服务器加密密钥，勿覆盖现有数据。"); }
}
function metadata(row) {
  return { shopId: row.shopId, name: row.name, enabled: row.enabled, revision: row.revision,
    hasCredentials: Boolean(row.keystring && row.sharedSecret), updatedAt: row.updatedAt,
    updatedBy: row.updatedBy, authorized: Boolean(row.oauth), lastSyncedAt: row.lastSyncedAt || null,
    authorizationStatus: row.oauth ? "已授权" : "待店主授权" };
}
export async function listConfigs() {
  const rows = await redis(["HGETALL", CONFIG_KEY]);
  if (!Array.isArray(rows) || rows.length % 2) throw error(503, "API 配置存储格式无效。");
  const result = [];
  for (let i = 0; i < rows.length; i += 2) result.push(metadata(openConfig(rows[i + 1], rows[i])));
  return result.sort((a, b) => a.shopId.localeCompare(b.shopId));
}
export async function saveConfig(input, actor) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((k) => !["shopId", "name", "enabled", "revision", "keystring", "sharedSecret"].includes(k)))
    throw error(400, "API 配置字段无效；此入口不接受密码、访问令牌或浏览器角色。");
  const { shopId, name, enabled, revision } = input;
  if (typeof shopId !== "string" || !/^[1-9]\d{0,18}$/.test(shopId) || typeof name !== "string" ||
      !name.trim() || name.length > 100 || typeof enabled !== "boolean" || !Number.isInteger(revision) || revision < 0)
    throw error(400, "请填写有效的 Shop ID、名称和配置版本。");
  const previous = await redis(["HGET", CONFIG_KEY, shopId]);
  const old = previous ? openConfig(previous, shopId) : null;
  if ((old?.revision || 0) !== revision) throw error(409, "配置已被其他页面更新，请刷新后重试。");
  const supplied = [input.keystring, input.sharedSecret].some((v) => v !== undefined && v !== "");
  if (supplied && [input.keystring, input.sharedSecret].some((v) => typeof v !== "string" || !/^[A-Za-z0-9_-]{4,500}$/.test(v)))
    throw error(400, "更换凭据时必须同时填写 Keystring 和 Shared Secret。");
  if (!old && !supplied) throw error(400, "首次添加店铺必须填写应用凭据。");
  const row = { shopId, name: name.trim(), enabled, revision: revision + 1,
    ...(!supplied && old?.oauth ? { oauth: old.oauth } : {}),
    ...(!supplied && old?.lastSyncedAt ? { lastSyncedAt: old.lastSyncedAt } : {}),
    keystring: supplied ? input.keystring : old.keystring,
    sharedSecret: supplied ? input.sharedSecret : old.sharedSecret,
    updatedBy: actor, updatedAt: new Date().toISOString() };
  const script = "local old=redis.call('HGET',KEYS[1],ARGV[1]); if (old or '')~=ARGV[2] then return 0 end; if not old and redis.call('HLEN',KEYS[1])>=100 then return -1 end; redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); return 1";
  const saved = await redis(["EVAL", script, 1, CONFIG_KEY, shopId, previous || "", sealConfig(row, shopId)]);
  if (saved === -1) throw error(400, "最多保存 100 家店铺配置。");
  if (saved !== 1) throw error(409, "配置已被其他页面更新，请刷新后重试。");
  return metadata(row);
}
