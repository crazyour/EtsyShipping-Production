// Run with PLAYWRIGHT_MODULE pointing to an installed playwright module.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.TEST_URL || "http://127.0.0.1:4190";
const navigate = async (name) => {
  await page.locator(`#sidebar [data-page="${name}"]`).click();
};
const action = async (name, id) => {
  await page
    .locator(`[data-action="${name}"]${id ? `[data-id="${id}"]` : ""}`)
    .first()
    .click();
};
const submit = async () => {
  await page.locator('#workForm [type="submit"]').click();
  await page.waitForFunction(
    () => !document.querySelector("#workDialog").open,
    null,
    { timeout: 12000 },
  );
};
const fill = async (values) => {
  for (const [key, value] of Object.entries(values))
    await page.locator(`#field-${key}`).fill(String(value));
};
try {
  await page.goto(base);
  await page.waitForFunction(() =>
    document.querySelector("#serverBadge").textContent.includes("正常"),
  );
  await page.locator("#userName").fill("admin");
  await page.locator("#password").fill("admin");
  await page.locator("#loginButton").click();
  await page.locator("#pageContent h1").waitFor();
  await mkdir("test-output", { recursive: true });
  await page.screenshot({
    path: "test-output/dashboard-desktop.png",
    fullPage: true,
  });
  for (const name of [
    "upload",
    "orders",
    "shipping",
    "warehouse",
    "returns",
    "tracking",
    "master",
    "admin",
    "settings",
    "dashboard",
  ]) {
    await navigate(name);
    assert.ok(await page.locator("#pageContent h1").textContent());
  }
  await navigate("orders");
  await action("new-order");
  await fill({
    externalId: "BROWSER-TEST",
    recipient: "Browser Buyer",
    country: "US",
    city: "Seattle",
    postal: "98101",
    address: "Example Test Road",
    product: "Browser test bookmark",
    quantity: 2,
    amount: 24,
    weight: 180,
    sku: "BM-01",
  });
  await submit();
  const orderId = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("etsyshipping.workspace.v1")).orders.find(
        (o) => o.externalId === "BROWSER-TEST",
      ).id,
  );
  await action("order", orderId);
  await page.locator("#field-sku").selectOption("BM-01");
  await page.locator('[name="reviewed"]').check();
  await submit();
  await navigate("shipping");
  await action("select", orderId);
  await action("shipping-draft", orderId);
  await page.locator("#workForm input[type=checkbox]").check();
  await submit();
  const taskId = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("etsyshipping.workspace.v1")).tasks.find(
        (t) => t.orderId === id,
      ).id,
    orderId,
  );
  await navigate("warehouse");
  await action("select", taskId);
  await action("task-next", taskId);
  await action("task-next", taskId);
  await action("task-next", taskId);
  await fill({ weight: 200 });
  await submit();
  await action("task-next", taskId);
  await page.locator("#printSheet").waitFor();
  await page.screenshot({ path: "test-output/print-preview.png" });
  await page.locator('[name="printed"]').check();
  await submit();
  await action("task-next", taskId);
  await submit();
  console.log("Warehouse flow passed");
  await navigate("returns");
  const returnId = await page.evaluate(
    (id) =>
      JSON.parse(
        localStorage.getItem("etsyshipping.workspace.v1"),
      ).returns.find((r) => r.orderId === id).id,
    orderId,
  );
  await action("confirm-return", returnId);
  await submit();
  await navigate("tracking");
  const shipId = await page.evaluate(
    (id) =>
      JSON.parse(
        localStorage.getItem("etsyshipping.workspace.v1"),
      ).shipments.find((s) => s.orderId === id).id,
    orderId,
  );
  await action("shipment", shipId);
  await action("tracking-event", shipId);
  await fill({ location: "Seattle", text: "浏览器测试：演练签收" });
  await page.locator("#field-status").selectOption("已签收");
  await submit();
  await navigate("master");
  for (const key of [
    "stores",
    "warehouses",
    "presets",
    "skus",
    "templates",
    "prices",
  ]) {
    await action("catalog", key);
    await action("new-catalog", key);
    await page.locator("#workForm").waitFor();
    await page.locator("#workDialog [data-close]").first().click();
    await page.waitForFunction(
      () => !document.querySelector("#workDialog").open,
    );
  }
  await action("catalog", "stores");
  await action("new-catalog", "stores");
  await fill({ code: "QA", name: "Browser Test Store", owner: "admin" });
  await submit();
  assert.match(
    await page.locator("#pageContent").innerText(),
    /Browser Test Store/,
  );
  await navigate("admin");
  for (const key of [
    "users",
    "accounts",
    "diagnostics",
    "audit",
    "maintenance",
  ]) {
    await action("admin-tab", key);
    assert.ok(await page.locator("#pageContent").innerText());
  }
  const backup = await page.evaluate(() =>
    localStorage.getItem("etsyshipping.workspace.v1"),
  );
  await action("restore");
  await page
    .locator("#backupFile")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(backup),
    });
  await page.locator("#workForm input[type=checkbox]").check();
  await submit();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("etsyshipping.workspace.v1")).audit[0]
          .action,
    ),
    "恢复工作区备份",
  );
  await navigate("upload");
  await action("import-orders");
  await page
    .locator("#csvFile")
    .setInputFiles({
      name: "orders.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "store,externalId,recipient,country,city,postal,address,product,quantity,amount,currency\nHana Metal,CSV-TEST,CSV Buyer,US,Seattle,98101,Test Road,CSV product,1,12,USD",
      ),
    });
  await submit();
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("etsyshipping.workspace.v1")).orders.some(
        (o) => o.externalId === "CSV-TEST",
      ),
    ),
    true,
  );
  await action("parse-text");
  await fill({
    text: "收件人：Parsed Buyer\n国家：US\n城市：Seattle\n邮编：98101\n地址：Test Road\n商品：Test product\n数量：1\n金额：12\n币种：USD",
  });
  await page.locator("#workForm [type=submit]").click();
  await page.locator("#field-recipient").waitFor();
  assert.equal(
    await page.locator("#field-recipient").inputValue(),
    "Parsed Buyer",
  );
  await page.locator("#workDialog [data-close]").first().click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('[data-files="订单截图"]').setInputFiles({
    name: "test-order.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .locator(".file-row")
    .filter({ hasText: "test-order.png" })
    .waitFor();
  await action("preview-file");
  await page.locator(".image-preview").waitFor();
  await page.locator("#workDialog [data-close]").first().click();
  await navigate("orders");
  await page.locator("#workspaceSearch").fill("BROWSER-TEST");
  assert.match(await page.locator("#pageContent").innerText(), /Browser Buyer/);
  await page.screenshot({
    path: "test-output/orders-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.locator("#userName").fill("admin");
  await page.locator("#password").fill("admin");
  await page.locator("#loginButton").click();
  await page.locator("#pageContent h1").waitFor();
  const persisted = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("etsyshipping.workspace.v1")).orders.find(
        (o) => o.id === id,
      ),
    orderId,
  );
  assert.equal(persisted.status, "已发货");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: "test-output/dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile page overflow",
  );
  await page.locator("#menuButton").click();
  await navigate("orders");
  await page.screenshot({
    path: "test-output/orders-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile orders overflow",
  );
  await action("new-order");
  await page.screenshot({ path: "test-output/order-form-mobile.png" });
  await page.locator("#workDialog [data-close]").first().click();
  assert.deepEqual(errors, []);
  console.log(
    "Browser flow passed: navigation, order/review/shipping/warehouse/return/tracking, catalog forms, text extraction, image upload, reload persistence, desktop and mobile layouts.",
  );
} catch (e) {
  await page.screenshot({ path: "test-output/failure.png", fullPage: true });
  console.error(await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
}
