// Mock UI acceptance test; no real Etsy or database credentials are used.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const base = process.env.TEST_URL || "http://127.0.0.1:4192";
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors = [], calls = []; let signedIn = false, configured = true, administrator = true, job = null, step = 0, orders = [];
const setup = { available: true, projectId: "test-project", fields: {} };
const order = { shopId: "12345", shopName: "Hana Metal", receiptId: "98765", recipient: "Private Buyer", country: "US",
  city: "Seattle", region: "WA", postal: "00123", address: "123 Test Street", status: "paid", isPaid: true, isShipped: false,
  total: { amount: 1200, divisor: 100, currency_code: "USD" },
  items: [{ transactionId: "56789", title: "Brass bookmark", sku: "BM-01", quantity: 1, isDigital: false,
    price: { amount: 1200, divisor: 100, currency_code: "USD" },
    variations: [{ name: "Color", value: "Gold" }, { name: "Size", value: "15 cm" }],
    imageUrl: "https://i.etsystatic.com/mock.jpg" }] };
page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://i.etsystatic.com/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#e9d18e"/></svg>' }));
await page.route("**/api/bridge?*", async (route) => {
  const request = route.request(), name = new URL(request.url()).searchParams.get("route"); calls.push(name);
  let json = {};
  if (name === "meta") json = { demoEnabled: false, siteAdminConfigured: true };
  if (name === "admin-session") json = { admin: signedIn && configured && administrator, userName: "admin", serverConfigAdmin: administrator, serverConfig: setup };
  if (name === "login") { signedIn = true; json = { demoAccess: true, userName: administrator ? "admin" : "demo", serverConfigAdmin: administrator, serverConfig: administrator ? setup : null, apiAdmin: configured && administrator, apiAdminNotice: configured ? "" : "尚未配置服务端持久存储，不能保存 API 密钥。" }; }
  if (name === "admin-logout") signedIn = false;
  if (name === "admin-etsy-config") json = { items: [{ shopId: "12345", name: "Hana Metal", enabled: true, authorized: true,
    hasCredentials: true, revision: 2, updatedAt: new Date().toISOString(), updatedBy: "admin", authorizationStatus: "已授权" }] };
  if (name === "etsy-sync-status") json = { job };
  if (name === "etsy-cloud-orders") json = { items: orders, total: orders.length, offset: 0 };
  if (name === "etsy-sync-start") {
    job = { id: "job-test", status: "running", shops: [{ shopId: "12345", name: "Hana Metal", status: "running", fetched: 0, total: 1,
      inserted: 0, updated: 0, unchanged: 0, warnings: 0 }] }; step = 0; json = { job };
  }
  if (name === "etsy-sync-step") {
    await new Promise((r) => setTimeout(r, 150)); step++;
    if (step >= 3) { job.status = "completed"; job.shops[0].status = "done"; job.shops[0].inserted = 1; orders = [order]; }
    job.shops[0].fetched = 1; json = { job };
  }
  if (name === "etsy-callback") json = { ok: true, shopId: "12345", name: "Hana Metal" };
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
});
async function login() {
  await page.locator("#userName").fill("admin"); await page.locator("#password").fill("test-password");
  await page.locator("#loginButton").click(); await page.locator("#pageContent h1").waitFor();
}
async function openCloud() {
  assert.equal(await page.locator('[data-page="admin"]').count(), 0);
  await page.locator('[data-page="etsyCloud"]').click();
  await page.getByRole("heading", { name: "Etsy 订单同步", exact: true }).waitFor();
}
try {
  await mkdir("test-output", { recursive: true });
  await page.goto(base); await login(); await openCloud();
  await page.getByRole("button", { name: "返回我的订单", exact: true }).click();
  await page.getByRole("heading", { name: "我的订单", exact: true }).waitFor();
  await openCloud();
  await page.getByRole("heading", { name: "API 接入与配置 · 仅管理员", exact: true }).waitFor();
  for (const href of ["https://vercel.com/account/tokens", "https://console.upstash.com/", "https://www.etsy.com/developers/"]) {
    const link = page.locator(`#pageContent a[href="${href}"]`);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match(await link.getAttribute("rel"), /noopener/);
  }
  await page.getByText("服务器配置要填什么？", { exact: true }).click();
  await page.getByText("Upstash REST URL / REST Token", { exact: true }).waitFor();
  await page.locator('[data-action="server-config-open"]').click();
  await page.locator("#setupToken").waitFor();
  await page.locator("#workDialog [data-close]").first().click();
  assert.equal(await page.getByRole("heading", { name: "Etsy 订单同步", exact: true }).isVisible(), true);
  await page.locator('[data-action="etsy-config-open"]').click();
  await page.getByRole("heading", { name: "Etsy API 配置 · 仅管理员", exact: true }).waitFor();
  await page.locator('[data-action="etsy-config-edit"]').first().click();
  await page.locator("#etsyKeystring").waitFor();
  await page.locator("#workDialog [data-close]").first().click();
  assert.equal(await page.getByRole("heading", { name: "Etsy 订单同步", exact: true }).isVisible(), true);
  await page.locator('[data-action="cloud-start"]').click();
  assert.equal(await page.locator('[data-action="cloud-start"]').isDisabled(), true);
  await page.getByRole("heading", { name: "已保存的真实订单 · 1 笔", exact: true }).waitFor();
  assert.equal(calls.filter((n) => n === "etsy-sync-start").length, 1);
  assert.equal(calls.filter((n) => n === "etsy-sync-step").length, 3);
  await page.screenshot({ path: "test-output/etsy-cloud-desktop.png" });
  await page.locator('[data-action="cloud-detail"]').click();
  await page.getByText("Color: Gold; Size: 15 cm", { exact: true }).waitFor();
  assert.equal(await page.locator("#workDialog img").count(), 1);
  await page.locator("#workDialog [data-close]").first().click();
  const downloadPromise = page.waitForEvent("download"); await page.locator('[data-action="cloud-export"]').click();
  const download = await downloadPromise; assert.equal(download.suggestedFilename(), "etsy-orders.csv");
  const csv = await readFile(await download.path(), "utf8"); assert.match(csv, /"externalId","store"/); assert.match(csv, /Color: Gold/);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.doesNotMatch(storage, /Private Buyer|123 Test Street|98765|mock.jpg/);
  await page.setViewportSize({ width: 375, height: 812 }); await page.screenshot({ path: "test-output/etsy-cloud-mobile.png" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 812, height: 375 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A reload must restore admin authority from the cookie endpoint, not from local roles.
  job.status = "running"; job.shops[0].status = "running"; step = 2;
  await page.reload(); await page.locator("#pageContent h1").waitFor(); await openCloud();
  await page.getByRole("button", { name: "继续未完成同步", exact: true }).click();
  await page.getByText("本轮已结束，请查看各店铺结果。", { exact: true }).waitFor();
  assert.equal(calls.filter((n) => n === "etsy-sync-start").length, 1);
  // Callback removes code/state from the URL and completes without persisting them in browser storage.
  await page.goto(`${base}/etsy-callback.html?state=test-state&code=test-code`);
  await page.getByText("Hana Metal（12345）已授权。返回工作台后即可一键同步订单。", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, "");
  await page.goto(base); await page.locator("#pageContent h1").waitFor(); await openCloud();
  await page.locator("#logoutButton").click();
  await page.locator("#loginView").waitFor({ state: "visible" });
  assert.equal(await page.locator("#pageContent").textContent(), "");
  assert.equal(await page.locator("#loginView").isVisible(), true);
  configured = false; await login(); await openCloud();
  await page.getByText("尚未配置服务端持久存储，不能保存 API 密钥。", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-action="cloud-start"]').count(), 0);
  assert.equal(await page.getByText("Private Buyer", { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-action="etsy-config-open"]').isDisabled(), true);
  const before = calls.length;
  await page.locator('[data-action="server-config-open"]').click();
  await page.locator("#setupToken").waitFor();
  assert.equal(calls.length, before); // Bootstrap opens without touching unavailable cloud storage.
  await page.locator("#workDialog [data-close]").first().click();
  await page.locator("#logoutButton").click();
  administrator = false; await login(); await openCloud();
  assert.equal(await page.locator('[data-action="server-config-open"]').count(), 0);
  assert.equal(await page.locator('[data-action="etsy-config-open"]').count(), 0);
  assert.equal(await page.getByRole("heading", { name: "API 接入与配置 · 仅管理员", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Cloud UI passed: one-click orchestration, resume, photos, English CSV, no local PII, mobile/landscape, callback and logout/locked state.");
} finally { await browser.close(); }
