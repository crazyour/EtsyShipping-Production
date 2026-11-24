import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { etsyId, bundleFromReceipts } from "../dist/etsy-orders.js";

const API = "https://openapi.etsy.com/v3/application";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
export function validateConfig(config) {
  for (const key of ["keystring", "sharedSecret"]) {
    if (typeof config[key] !== "string" || !/^[A-Za-z0-9_-]+$/.test(config[key]) ||
        config[key].startsWith("REPLACE_"))
      throw new Error(`请在本机配置文件填写有效的 ${key}，不要发送到聊天或上传网站。`);
  }
  const url = new URL(config.redirectUri);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("回调必须是无查询参数的本机 HTTPS 地址，例如 https://localhost:4443/callback。");
  return { keystring: config.keystring, sharedSecret: config.sharedSecret, redirectUri: url.href };
}
export function createAuthorization(config) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL("https://www.etsy.com/oauth/connect");
  url.search = new URLSearchParams({ response_type: "code", client_id: config.keystring,
    redirect_uri: config.redirectUri, scope: "transactions_r", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  return { url: url.href, verifier, state };
}
export function parseCallback(value, config, authorization) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("请粘贴完整回调地址，不是单独的 code。"); }
  const expected = new URL(config.redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash || url.username || url.password)
    throw new Error("回调地址与本次配置不符。");
  const states = url.searchParams.getAll("state");
  const received = Buffer.from(states[0] || ""), state = Buffer.from(authorization.state);
  if (states.length !== 1 || received.length !== state.length || !timingSafeEqual(received, state))
    throw new Error("授权 state 不匹配；请使用本次运行生成的授权链接。");
  if (url.searchParams.has("error")) throw new Error("店主未完成授权，请重新运行。");
  const codes = url.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0] || codes[0].length > 2000)
    throw new Error("回调缺少有效授权码。");
  return codes[0];
}
export class EtsyClient {
  constructor(config, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onProgress = () => {} } = {}) {
    this.config = validateConfig(config);
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.onProgress = onProgress;
    this.tokens = null;
  }
  async token(parameters) {
    let response;
    try {
      response = await this.fetch(TOKEN_URL, { method: "POST", redirect: "error",
        signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.keystring, ...parameters }) });
    } catch { throw new Error("Etsy 授权连接失败或超时，请重新运行授权。"); }
    if (!response.ok) throw new Error(`Etsy 授权失败（HTTP ${response.status}），请检查应用状态与回调配置后重新授权。`);
    let data;
    try { data = await response.json(); } catch { throw new Error("Etsy 授权响应不是有效 JSON。"); }
    if (typeof data.access_token !== "string" || !data.access_token ||
        typeof data.refresh_token !== "string" || !data.refresh_token ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0)
      throw new Error("Etsy 授权响应缺少有效凭据。");
    if (data.scope && !String(data.scope).split(" ").includes("transactions_r"))
      throw new Error("未获得订单读取权限。");
    this.tokens = { access: data.access_token, refresh: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000 };
  }
  async authorize(code, verifier) {
    await this.token({ grant_type: "authorization_code", code, code_verifier: verifier,
      redirect_uri: this.config.redirectUri });
  }
  async get(path, params = {}) {
    // No arbitrary hosts or write endpoints, even when called by other local code.
    if (!/^\/shops\/[1-9]\d*\/receipts(?:\/[1-9]\d*\/transactions)?$/.test(path))
      throw new Error("只允许读取指定店铺的订单接口。");
    if (!this.tokens) throw new Error("请先授权店铺。");
    if (Date.now() >= this.tokens.expiresAt - 30000)
      await this.token({ grant_type: "refresh_token", refresh_token: this.tokens.refresh });
    const url = new URL(API + path);
    url.search = new URLSearchParams(params);
    let refreshed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.sleep(250);
      let response;
      try {
        response = await this.fetch(url, { method: "GET", redirect: "error",
          signal: AbortSignal.timeout(30000), headers: {
            "x-api-key": `${this.config.keystring}:${this.config.sharedSecret}`,
            Authorization: `Bearer ${this.tokens.access}`, Accept: "application/json",
          } });
      } catch { throw new Error("Etsy 订单连接失败或超时；没有生成不完整文件，请稍后重试。"); }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.token({ grant_type: "refresh_token", refresh_token: this.tokens.refresh });
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const raw = response.headers.get("retry-after");
        const delay = raw == null ? 2 ** attempt : /^\d+(\.\d+)?$/.test(raw)
          ? Number(raw) : Math.max(0, (Date.parse(raw) - Date.now()) / 1000);
        if (!Number.isFinite(delay) || delay > 30 || attempt === 3)
          throw new Error(`Etsy 暂时限流或不可用（HTTP ${response.status}）。请稍后重新下载，勿连续重试。`);
        this.onProgress("Etsy 暂时限流或不可用，正在按要求等待重试…");
        await this.sleep(Math.max(delay, 1) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`读取订单失败（HTTP ${response.status}）。请确认 Shop ID、店主授权和应用权限。`);
      try { return await response.json(); } catch { throw new Error("Etsy 返回了无效 JSON，下载已中止。"); }
    }
    throw new Error("Etsy 读取失败，请重新授权后重试。");
  }
  async download({ shopId, shopName = "", since, until = new Date().toISOString() }) {
    shopId = etsyId(shopId);
    const from = Math.floor(Date.parse(since) / 1000), to = Math.floor(Date.parse(until) / 1000);
    if (!Number.isSafeInteger(from) || from < 946684800 || !Number.isSafeInteger(to) || from > to)
      throw new Error("下载日期范围无效；请填写 2000 年以后的 ISO 日期。");
    const receipts = new Map();
    for (let offset = 0; ; offset += 100) {
      const page = await this.get(`/shops/${shopId}/receipts`, {
        min_last_modified: from, max_last_modified: to, limit: 100, offset,
        sort_on: "receipt_id", sort_order: "asc",
      });
      if (!Array.isArray(page.results) || !Number.isSafeInteger(page.count) || page.count < 0 || page.results.length > 100)
        throw new Error("Etsy 订单分页响应不完整。");
      if (page.count > 1000 || offset >= 1000)
        throw new Error("时间范围内超过 1000 笔订单，请缩小日期范围后重试。");
      for (const receipt of page.results) {
        const id = etsyId(receipt.receipt_id);
        if (receipts.has(id)) throw new Error("订单分页发生变化，请重新下载当前时间范围。");
        // The receipts endpoint includes transactions. Fetch explicitly only if absent.
        if (!Array.isArray(receipt.transactions) || !receipt.transactions.length) {
          const details = await this.get(`/shops/${shopId}/receipts/${id}/transactions`);
          if (!Array.isArray(details.results) || details.count !== details.results.length)
            throw new Error("Etsy 商品明细响应不完整。");
          receipt.transactions = details.results;
        }
        receipts.set(id, receipt);
      }
      this.onProgress(`已读取 ${receipts.size} 笔订单。`);
      if (offset + page.results.length >= page.count) break;
      if (page.results.length !== 100) throw new Error("订单分页不完整，请重新下载。");
    }
    return bundleFromReceipts([...receipts.values()], { shopId, shopName, exportedAt: until });
  }
}
