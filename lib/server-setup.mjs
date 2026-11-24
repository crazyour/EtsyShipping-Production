import { createHash } from "node:crypto";
import { matchesSecret, requireSameOrigin, adminSetup, limitAdminLogin } from "./admin-config.mjs";

// Non-secret deployment binding from this project's .vercel/project.json.
// Never accept a project/team identifier, API URL or environment name from the browser.
export const SETUP_TARGET = Object.freeze({
  projectId: "prj_za4L3kHrbqajbKcc5Qgkk4xNIaxz",
  teamId: "team_8fKFU5bWflEwr3cM3kxSKqf6",
});
export const SETUP_KEYS = Object.freeze([
  "ETSY_CONFIG_ENCRYPTION_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SITE_PUBLIC_ORIGIN",
]);
const fail = (status, message) => Object.assign(new Error(message), { status });
let attempts = { fingerprint: "", until: 0, count: 0 };

function targetReady() {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_PROJECT_ID === SETUP_TARGET.projectId;
}
export function serverSetupStatus() {
  return { available: targetReady(), projectId: SETUP_TARGET.projectId, environment: "production",
    fields: Object.fromEntries(SETUP_KEYS.map((key) => [key, Boolean(process.env[key])])),
    reason: targetReady() ? "" : "请从当前项目的 Vercel 正式部署打开此页，并开启自动暴露系统环境变量；本地与预览部署禁止修改正式配置。" };
}
async function authenticate(request, input) {
  requireSameOrigin(request);
  // Bootstrap does not depend on the still-unconfigured database or encryption key.
  // This process-local cap is supplementary, not a distributed security boundary.
  const password = process.env.SITE_ADMIN_PASSWORD || "";
  const actor = (process.env.SITE_ADMIN_USERNAME || "admin").trim();
  const fingerprint = createHash("sha256").update(`${actor}\0${password}`).digest("hex");
  if (attempts.fingerprint !== fingerprint || attempts.until <= Date.now())
    attempts = { fingerprint, until: Date.now() + 900000, count: 0 };
  if (++attempts.count > 30) throw fail(429, "服务器配置验证次数过多，请 15 分钟后重试。");
  if (adminSetup().ready) await limitAdminLogin();
  if (!password || !actor || typeof input?.userName !== "string" || typeof input?.password !== "string" ||
      input.userName !== actor || input.password.length > 500 || !matchesSecret(input.password, password))
    throw fail(403, "请重新填写当前站点管理员账号和密码；普通账号不能配置服务器。");
  if (!targetReady()) throw fail(403, serverSetupStatus().reason);
  // Vercel Token authorization is independently checked by Vercel on every operation.
  if (typeof input.vercelToken !== "string" || !/^[\x21-\x7e]{10,2048}$/.test(input.vercelToken))
    throw fail(400, "请填写有效的 Vercel Token，不要带空格或换行。");
}
async function vercel(token, path, { body, query = {} } = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  url.search = new URLSearchParams({ teamId: SETUP_TARGET.teamId, ...query });
  let response;
  try {
    response = await fetch(url, { method: body ? "POST" : "GET", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
  } catch { throw fail(502, body ? "保存结果无法确认，可能已部分保存。请先检查配置，勿重新生成加密密钥。" : "无法连接 Vercel，请稍后重试。"); }
  // Never echo upstream messages, values, headers, tokens or request bodies.
  if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? 403 : 502,
    `Vercel 请求未成功（HTTP ${response.status}）。请检查 Token 的当前团队/项目权限；如已尝试保存，请先检查配置。`);
  try { return await response.json(); }
  catch { throw fail(502, "Vercel 返回格式无法确认。请先检查配置，不要直接重复保存。"); }
}
async function environment(token) {
  const project = await vercel(token, `/v9/projects/${SETUP_TARGET.projectId}`);
  if (project.id !== SETUP_TARGET.projectId || project.accountId !== SETUP_TARGET.teamId)
    throw fail(403, "Vercel 返回的项目或团队不匹配，未执行配置写入。");
  const data = await vercel(token, `/v10/projects/${SETUP_TARGET.projectId}/env`, { query: { decrypt: "false" } });
  const envs = Array.isArray(data) ? data : Array.isArray(data.envs) ? data.envs : data.key ? [data] : null;
  if (!envs || envs.some((row) => typeof row.key !== "string" ||
      !(Array.isArray(row.target) || typeof row.target === "string")))
    throw fail(502, "无法确认 Vercel 已有环境变量，已停止写入以保护原配置。");
  const existing = new Set(envs.filter((row) => (Array.isArray(row.target) ? row.target : [row.target]).includes("production")).map((row) => row.key));
  // Project variables can shadow shared variables. Check the documented team endpoint
  // filtered to this project; lack of permission or incomplete results must fail closed.
  const inherited = await vercel(token, "/v1/env", { query: { projectId: SETUP_TARGET.projectId } });
  if (!Array.isArray(inherited?.data) || !inherited.pagination || typeof inherited.pagination !== "object")
    throw fail(502, "无法确认共享环境变量，已停止写入以保护原配置。");
  const shared = inherited.data.length > 0 || inherited.pagination.next != null;
  for (const row of inherited.data) {
    if (typeof row?.key === "string" && Array.isArray(row.target) && row.target.includes("production")) existing.add(row.key);
  }
  return { existing, shared, name: typeof project.name === "string" ? project.name.slice(0, 100) : "当前项目" };
}
function valuesFrom(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !SETUP_KEYS.includes(key))) throw fail(400, "只允许填写页面列出的四项服务器配置。");
  const values = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length > 4096) throw fail(400, "配置值类型或长度无效。");
    if (value === "") continue; // Blank means leave existing settings untouched.
    if (value !== value.trim()) throw fail(400, `${key} 首尾不能有空格或换行。`);
    values[key] = value;
  }
  if (values.ETSY_CONFIG_ENCRYPTION_KEY) {
    const key = Buffer.from(values.ETSY_CONFIG_ENCRYPTION_KEY, "base64");
    if (key.length !== 32 || key.toString("base64") !== values.ETSY_CONFIG_ENCRYPTION_KEY)
      throw fail(400, "加密密钥须为随机 32 字节的标准 Base64 编码，请使用页面生成按钮。");
  }
  if (values.UPSTASH_REDIS_REST_URL) {
    let url;
    try { url = new URL(values.UPSTASH_REDIS_REST_URL); } catch { throw fail(400, "Upstash REST URL 无效。"); }
    if (url.protocol !== "https:" || !url.hostname.endsWith(".upstash.io") || url.port || url.username || url.password ||
        url.search || url.hash || url.pathname !== "/") throw fail(400, "Upstash REST URL 必须是 upstash.io 的 HTTPS 根地址。");
  }
  if (values.UPSTASH_REDIS_REST_TOKEN && !/^[\x21-\x7e]{10,4096}$/.test(values.UPSTASH_REDIS_REST_TOKEN))
    throw fail(400, "Upstash REST Token 无效，不要带空格或换行。");
  if (values.SITE_PUBLIC_ORIGIN) {
    let url;
    try { url = new URL(values.SITE_PUBLIC_ORIGIN); } catch { throw fail(400, "正式网站源地址无效。"); }
    if (url.protocol !== "https:" || url.origin !== values.SITE_PUBLIC_ORIGIN)
      throw fail(400, "正式网站源地址须以 HTTPS 开头，不能带路径或尾部斜杠。");
  }
  return values;
}
export async function configureServer(request, input) {
  await authenticate(request, input);
  if (!input || Object.keys(input).some((key) => !["userName", "password", "vercelToken", "action", "values", "confirmed"].includes(key)) ||
      !["inspect", "save"].includes(input.action)) throw fail(400, "服务器配置请求无效。");
  const values = input.action === "save" ? valuesFrom(input.values) : {};
  if (input.action === "save" && input.confirmed !== true) throw fail(400, "请确认已备份加密密钥，并同意保存到当前项目的 Production 环境。");
  const state = await environment(input.vercelToken);
  const fields = Object.fromEntries(SETUP_KEYS.map((key) => [key, { saved: state.existing.has(key), active: Boolean(process.env[key]) }]));
  if (input.action === "inspect") return { ok: true, projectId: SETUP_TARGET.projectId, name: state.name, fields,
    shared: state.shared, message: state.shared ? "项目关联共享环境变量，此入口停止写入。请在 Vercel 中管理配置。"
      : "已检查配置状态，不返回任何密钥值。已保存不代表当前部署已生效。" };
  if (state.shared) throw fail(409, "项目使用了共享环境变量，请在 Vercel 管理底层配置；此入口不覆盖或遮蔽共享配置。");
  const keys = Object.keys(values);
  if (!keys.length) throw fail(400, "请至少填写一项尚未配置的变量。");
  for (const key of keys) {
    if (state.existing.has(key) || process.env[key]) throw fail(409, `${key} 已存在。为保护数据，此入口不覆盖已有配置，请留空；如需迁移或恢复，请在 Vercel 中操作。`);
  }
  const result = await vercel(input.vercelToken, `/v10/projects/${SETUP_TARGET.projectId}/env`, {
    // No upsert: Vercel rejects duplicates, including concurrent initialization attempts.
    body: keys.map((key) => ({ key, value: values[key], type: "sensitive", target: ["production"] })),
  });
  const created = Array.isArray(result.created) ? result.created : result.created ? [result.created] : [];
  const saved = keys.filter((key) => created.some((row) => row.key === key));
  const ok = Array.isArray(result.failed) && result.failed.length === 0 && saved.length === keys.length;
  for (const key of saved) fields[key].saved = true;
  return { ok, projectId: SETUP_TARGET.projectId, name: state.name, fields, saved, needsRedeploy: true,
    message: ok ? "已保存到当前 Vercel 项目的 Production 环境。请重新部署并重新登录后使用；当前部署不会立即生效。"
      : "未能确认全部保存成功，可能已有部分变量保存。请先检查配置或到 Vercel 核对，勿直接重复生成密钥。" };
}
