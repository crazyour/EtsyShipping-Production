// UI-only smoke tests. The server permission checks are covered by admin-config.test.mjs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const base = process.env.TEST_URL || "http://127.0.0.1:4190";
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on("pageerror", (e) => errors.push(e.message));
let admin = true, saved = false;
await page.route("**/api/bridge?*", async (route) => {
  const request = route.request(), name = new URL(request.url()).searchParams.get("route");
  let json = {};
  if (name === "meta") json = { demoEnabled: false, siteAdminConfigured: true };
  if (name === "login") json = admin ? { demoAccess: true, userName: "admin", apiAdmin: true } : { accessToken: "ordinary", userName: "worker" };
  if (name === "etsy-sync-status") json = { job: null };
  if (name === "etsy-cloud-orders") json = { items: [], total: 0 };
  if (name === "admin-etsy-config") {
    if (request.method() === "POST") {
      writes.push(request.postDataJSON()); saved = true; json = { item: { revision: 1 } };
    } else json = { items: saved ? [{ shopId: "12345", name: "Test Shop", enabled: false,
      hasCredentials: true, revision: 1, updatedAt: new Date().toISOString(), updatedBy: "admin", authorizationStatus: "待店主授权" }] : [] };
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
});
async function login(user = "admin") {
  await page.locator("#userName").fill(user);
  await page.locator("#password").fill("test-password");
  await page.locator("#loginButton").click();
  await page.locator("#pageContent h1").waitFor();
  await page.locator('[data-page="etsyCloud"]').click();
}
try {
  await mkdir("test-output", { recursive: true });
  await page.goto(base);
  await login();
  await page.locator('[data-action="etsy-config-open"]').click();
  await page.locator('[data-action="etsy-config-edit"]').click();
  await page.locator("#field-shopId").fill("12345");
  await page.locator("#field-name").fill("Test Shop");
  await page.locator("#etsyKeystring").fill("ui-test-keystring");
  await page.locator("#etsySharedSecret").fill("ui-test-secret");
  await page.locator('#workForm [type="submit"]').click();
  await page.getByText("已保存（不回显）", { exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].shopId, "12345");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.doesNotMatch(storage, /ui-test-keystring|ui-test-secret/);
  await page.screenshot({ path: "test-output/admin-api-desktop.png" });
  await page.locator('[data-action="etsy-config-edit"]').last().click();
  assert.equal(await page.locator("#field-shopId").getAttribute("readonly"), "");
  assert.equal(await page.locator("#etsySharedSecret").inputValue(), "");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-output/admin-api-mobile.png" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator("#workDialog [data-close]").first().click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#logoutButton").click();
  admin = false;
  await login("worker");
  assert.equal(await page.locator('[data-action="etsy-config-open"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log("Admin configuration UI passed: save, redaction, no browser persistence, mobile and ordinary-user visibility.");
} finally { await browser.close(); }
