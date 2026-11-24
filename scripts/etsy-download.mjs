import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { EtsyClient, createAuthorization, parseCallback, validateConfig } from "./etsy-client.mjs";
import { ETSY_FILE_LIMIT, etsyId, etsyWarnings } from "../dist/etsy-orders.js";

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: "boolean" }, config: { type: "string", default: "etsy-local.config.json" },
    "shop-id": { type: "string" }, "shop-name": { type: "string", default: "" },
    since: { type: "string" }, until: { type: "string" },
    "output-dir": { type: "string", default: "etsy-exports" },
  } });
  if (values.help) {
    console.log(`本地 Etsy 订单下载（只读，不上传网站）
npm run etsy:download -- --shop-id 123456 --since 2026-11-01 --shop-name 我的店铺
可选：--until ISO日期 --config 本机配置路径 --output-dir 输出目录
时间按订单最后更新时间筛选，纯日期按 UTC 零点解释；不填 until 则截至本次启动。
先参照 docs/etsy-local-import.md 配置 Etsy 应用及本机 HTTPS 回调。
每次运行由店主授权，令牌仅存于本次进程内存，不落盘。`);
    return;
  }
  const shopId = etsyId(values["shop-id"]);
  const until = values.until || new Date().toISOString();
  if (!values.since || !Number.isFinite(Date.parse(values.since)) ||
      Date.parse(values.since) < Date.UTC(2000, 0, 1) ||
      !Number.isFinite(Date.parse(until)) || Date.parse(values.since) > Date.parse(until))
    throw new Error("请用 --since 指定起始日期，并确认 --until 不早于起始日期。");
  let config;
  try { config = JSON.parse(await readFile(resolve(values.config), "utf8")); }
  catch { throw new Error("无法读取本机配置；请按 docs/etsy-local-import.md 创建 etsy-local.config.json。"); }
  config = validateConfig(config);
  const authorization = createAuthorization(config);
  console.log(`将只读取 Shop ID ${shopId} 的订单，不修改店铺、不发货、不上传网站。
请在店主使用的浏览器打开以下 Etsy 官方授权链接：\n${authorization.url}
授权后浏览器跳到本机 HTTPS 地址。本工具使用手动回调，不启动网站；出现“无法连接”是预期情况。
请从浏览器地址栏复制含 code 和 state 的完整回调地址，粘贴到下方。
请勿将地址发给其他人；输入不会显示，按回车提交。`);
  // Avoid echoing the authorization code into terminal logs / shell history.
  if (!process.stdin.isTTY) throw new Error("请在本机交互式终端运行，不要通过管道传入授权码。");
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
  let callback;
  try {
    callback = await prompt.question("", { signal: AbortSignal.timeout(10 * 60 * 1000) });
  } finally { prompt.close(); }
  const code = parseCallback(callback, config, authorization);
  const client = new EtsyClient(config, { onProgress: (message) => console.log(message) });
  await client.authorize(code, authorization.verifier);
  const bundle = await client.download({ shopId, shopName: values["shop-name"], since: values.since, until });
  client.tokens = null;
  const content = JSON.stringify(bundle, null, 2);
  if (Buffer.byteLength(content) > ETSY_FILE_LIMIT) throw new Error("订单文件超过 8 MB，请缩小下载时间范围。");
  const directory = resolve(values["output-dir"]);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const output = resolve(directory, `etsy-${shopId}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(output, content, { flag: "wx", mode: 0o600 });
  const warnings = bundle.orders.filter((o) => etsyWarnings(o).length).length;
  console.log(`下载完成：${bundle.orders.length} 笔订单，${warnings} 笔需要检查资料。\n文件：${output}
下一步：网站“订单助手” → “导入 Etsy 本地订单” → 选择此 JSON → 预览并确认。
文件含客户资料，请妥善保管。仅包含订单及图片 ID，不包含图片原件或授权密钥。`);
}
main().catch((error) => {
  // Never print remote response bodies, tokens, config, or stack traces.
  console.error(error.name === "AbortError" ? "授权等待超时，请重新运行。" : error.message);
  process.exitCode = 1;
});
