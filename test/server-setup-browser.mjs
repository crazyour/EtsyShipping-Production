// UI acceptance with synthetic credentials and intercepted requests only.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const base = process.env.TEST_URL || "http://127.0.0.1:4193";
const keys = ["ETSY_CONFIG_ENCRYPTION_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SITE_PUBLIC_ORIGIN"];
let administrator = true, failNext = false;
const writes = [], errors = [], saved = new Set();
const password = "ui-only-admin-password", token = "ui-only-vercel-token", redisToken = "ui-only-redis-token";
page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://api.vercel.com/**", () => { throw new Error("The browser must not call Vercel directly"); });
await page.route("**/api/bridge?*", async (route) => {
  const name = new URL(route.request().url()).searchParams.get("route"); let status = 200, json = {};
  if (name === "meta") json = { demoEnabled: false, siteAdminConfigured: true };
  if (name === "login") json = administrator ? { demoAccess: true, userName: "admin", apiAdmin: false,
    serverConfigAdmin: true, apiAdminNotice: "尚未配置 API 密钥加密密钥。",
    serverConfig: { available: true, projectId: "prj_test_only", fields: Object.fromEntries(keys.map((key) => [key, false])) } }
    : { accessToken: "ordinary-test-user", userName: "worker" };
  if (name === "admin-server-config") {
    const data = route.request().postDataJSON(); writes.push(data);
    assert.equal(data.password, password); assert.equal(data.vercelToken, token);
    if (data.action === "save") {
      await new Promise((r) => setTimeout(r, 200));
      if (failNext) { failNext = false; status = 502; json = { error: "测试连接失败，未确认保存。" }; }
      else {
        assert.equal(data.confirmed, true); assert.equal(data.values.UPSTASH_REDIS_REST_TOKEN, redisToken);
        assert.equal(Buffer.from(data.values.ETSY_CONFIG_ENCRYPTION_KEY, "base64").length, 32);
        for (const key of keys) if (data.values[key]) saved.add(key);
      }
    }
    if (status === 200) json = { ok: true, fields: Object.fromEntries(keys.map((key) => [key, { saved: saved.has(key), active: false }])),
      message: data.action === "save" ? "已保存到 Vercel，请重新部署后使用。" : "已检查，不返回密钥值。" };
  }
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
});
async function login(user = "admin") {
  await page.locator("#userName").fill(user); await page.locator("#password").fill(password);
  await page.locator("#loginButton").click(); await page.locator("#pageContent h1").waitFor();
  await page.locator('[data-page="admin"]').click();
}
async function credentials() {
  await page.locator("#setupPassword").fill(password); await page.locator("#setupToken").fill(token);
}
async function fillSettings() {
  await page.locator("#setupGenerate").click();
  await page.locator("#setup-UPSTASH_REDIS_REST_URL").fill("https://example.upstash.io");
  await page.locator("#setup-UPSTASH_REDIS_REST_TOKEN").fill(redisToken);
  await page.locator("#setup-SITE_PUBLIC_ORIGIN").fill("https://site.example");
}
try {
  await mkdir("test-output", { recursive: true }); await page.goto(base); await login();
  assert.equal(await page.locator('[data-action="etsy-config-open"]').count(), 0);
  await page.locator('[data-action="server-config-open"]').click();
  await page.getByRole("heading", { name: "服务器配置 · 仅管理员", exact: true }).waitFor();
  assert.equal(await page.locator("#setupUser").inputValue(), "admin");
  await credentials();
  await page.getByRole("button", { name: "检查已保存配置", exact: true }).click();
  await page.getByText("已检查，不返回密钥值。", { exact: true }).waitFor();
  assert.equal(await page.locator("#setupPassword").inputValue(), ""); assert.equal(await page.locator("#setupToken").inputValue(), "");
  await fillSettings(); const generated = await page.locator("#setup-ETSY_CONFIG_ENCRYPTION_KEY").inputValue();
  await page.locator("#setupGenerate").click();
  assert.equal(await page.locator("#setup-ETSY_CONFIG_ENCRYPTION_KEY").inputValue(), generated); // Don't replace a key already typed/generated.
  await credentials(); await page.getByRole("button", { name: "保存到 Vercel（需重新部署）", exact: true }).click();
  await page.getByText("请确认密钥备份及保存目标。", { exact: true }).waitFor(); assert.equal(writes.length, 1);
  await page.locator("#setupConfirmed").check(); failNext = true;
  await page.getByRole("button", { name: "保存到 Vercel（需重新部署）", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "保存到 Vercel（需重新部署）", exact: true }).isDisabled(), true);
  await page.getByText("测试连接失败，未确认保存。", { exact: true }).waitFor();
  for (const id of ["setupPassword", "setupToken", "setup-ETSY_CONFIG_ENCRYPTION_KEY", "setup-UPSTASH_REDIS_REST_TOKEN"])
    assert.equal(await page.locator(`#${id}`).inputValue(), "");
  await credentials(); await fillSettings(); await page.locator("#setupConfirmed").check();
  await page.getByRole("button", { name: "保存到 Vercel（需重新部署）", exact: true }).click();
  await page.getByText("已保存到 Vercel，请重新部署后使用。", { exact: true }).waitFor();
  assert.equal(writes.filter((w) => w.action === "save").length, 2);
  for (const key of keys) assert.equal(await page.locator(`#setup-${key}`).isDisabled(), true);
  assert.equal(await page.locator("#setupGenerate").isDisabled(), true);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const secret of [password, token, redisToken, generated]) assert.ok(!storage.includes(secret));
  await page.screenshot({ path: "test-output/server-setup-desktop.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator("#setupResult").scrollIntoViewIfNeeded(); await page.screenshot({ path: "test-output/server-setup-mobile.png" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 812, height: 375 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#workDialog [data-close]").first().click();
  await page.locator('[data-action="server-config-open"]').click(); await page.locator("#setupPassword").fill(password);
  await page.locator("#workDialog [data-close]").first().click();
  await page.locator('[data-action="server-config-open"]').click(); assert.equal(await page.locator("#setupPassword").inputValue(), "");
  await page.locator("#workDialog [data-close]").first().click();
  await page.locator("#logoutButton").click(); await page.locator("#loginView").waitFor({ state: "visible" });
  administrator = false; await login("worker");
  assert.equal(await page.locator('[data-action="server-config-open"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log("Server setup UI passed: bootstrap admin, inspect/save, consent, error cleanup, no local secrets, no overwrite, mobile/landscape and ordinary-user denial.");
} finally { await browser.close(); }
