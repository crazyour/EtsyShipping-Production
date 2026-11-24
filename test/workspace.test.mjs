import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkspaceStore,
  STORAGE_KEY,
  csvEncode,
  csvParse,
} from "../dist/workspace-store.js";
const memory = () => ({
  value: null,
  getItem() {
    return this.value;
  },
  setItem(k, v) {
    assert.equal(k, STORAGE_KEY);
    this.value = v;
  },
});
const order = {
  store: "Hana Metal",
  externalId: "TEST-001",
  recipient: "Test Buyer",
  country: "US",
  city: "Seattle",
  postal: "98101",
  address: "Test address",
  product: "Brass bookmark",
  quantity: 2,
  amount: 24,
  currency: "USD",
  weight: 180,
};

test("order → review → shipment → warehouse → Etsy return persists across reloads", () => {
  const storage = memory(),
    s = new WorkspaceStore(storage);
  const id = s.saveOrder(order);
  s.review(id, "BM-01");
  s.createShipment(id, {
    preset: "P-01",
    warehouse: "东京仓",
    weight: 180,
    fee: 24,
  });
  const task = s.data.tasks.find((t) => t.orderId === id),
    shipment = s.data.shipments.find((x) => x.orderId === id);
  assert.match(shipment.tracking, /^DEMO-/);
  assert.equal(s.data.orders.find((o) => o.id === id).status, "仓库处理中");
  s.advanceTask(task.id);
  s.advanceTask(task.id);
  assert.throws(() => s.advanceTask(task.id, { weight: 0 }), /重量/);
  s.advanceTask(task.id, { weight: 200 });
  assert.throws(() => s.advanceTask(task.id), /打印/);
  s.advanceTask(task.id, { printed: true });
  assert.throws(() => s.advanceTask(task.id), /确认/);
  s.advanceTask(task.id, { confirmed: true });
  const r = s.data.returns.find((r) => r.orderId === id);
  s.confirmReturn(r.id);
  const reloaded = new WorkspaceStore(storage);
  assert.equal(reloaded.data.orders.find((o) => o.id === id).status, "已发货");
  assert.equal(
    reloaded.data.returns.find((x) => x.id === r.id).status,
    "已回填",
  );
  assert.equal(
    reloaded.data.shipments.find((x) => x.id === shipment.id).weight,
    200,
  );
  assert.throws(
    () => s.cancelShipment(shipment.id, "不能取消已交运包裹"),
    /已交运/,
  );
  assert.equal(
    reloaded.data.audit.some((a) => a.action === "确认 Etsy 人工回填"),
    true,
  );
});
test("invalid state transitions do not write or partially mutate records", () => {
  const storage = memory(),
    s = new WorkspaceStore(storage);
  const id = s.saveOrder(order);
  const before = storage.value;
  assert.throws(
    () =>
      s.createShipment(id, {
        preset: "P-01",
        warehouse: "东京仓",
        weight: 180,
      }),
    /复核/,
  );
  assert.equal(storage.value, before);
  assert.throws(() => s.review(id, "MISSING"), /SKU/);
  assert.equal(storage.value, before);
  s.review(id, "BM-01");
  assert.throws(
    () =>
      s.createShipment(id, {
        preset: "P-01",
        warehouse: "东京仓",
        weight: 3000,
      }),
    /上限/,
  );
  s.createShipment(id, { preset: "P-01", warehouse: "东京仓", weight: 180 });
  const ship = s.data.shipments.find((x) => x.orderId === id);
  assert.throws(
    () => s.tracking(ship.id, { text: "提前签收", status: "已签收" }),
    /交运/,
  );
  assert.throws(() => s.saveOrder(order, id), /不能编辑/);
  assert.throws(() => s.archiveOrder(id, "错误订单"), /物流记录/);
  s.cancelShipment(ship.id, "重新选择渠道");
  assert.equal(s.data.orders.find((o) => o.id === id).status, "待选物流");
  assert.equal(
    s.data.tasks.find((t) => t.shipmentId === ship.id).status,
    "已取消",
  );
});
test("duplicate orders, negative values and invalid countries are rejected", () => {
  const s = new WorkspaceStore(memory());
  s.saveOrder(order);
  assert.throws(() => s.saveOrder(order), /已存在/);
  for (const change of [
    { quantity: 1.5 },
    { quantity: 0 },
    { amount: -1 },
    { country: "USA" },
    { weight: -2 },
    { currency: "BAD" },
  ])
    assert.throws(() =>
      s.saveOrder({ ...order, externalId: "OTHER", ...change }),
    );
});
test("storage quota failure rolls back in-memory data and cross-tab conflicts are detected", () => {
  const storage = memory();
  const a = new WorkspaceStore(storage),
    b = new WorkspaceStore(storage);
  a.saveOrder(order);
  assert.throws(() => b.saveOrder({ ...order, externalId: "NEW" }), /标签页/);
  const before = JSON.stringify(a.data);
  storage.setItem = () => {
    throw new Error("quota");
  };
  assert.throws(() => a.saveOrder({ ...order, externalId: "NEW" }), /未保存/);
  assert.equal(JSON.stringify(a.data), before);
});
test("catalog edits protect referenced identifiers and built-in admin", () => {
  const s = new WorkspaceStore(memory());
  assert.throws(() => s.toggleCatalog("users", "USER-01"), /不能停用/);
  assert.throws(
    () =>
      s.saveCatalog("skus", { ...s.data.skus[0], code: "RENAMED" }, "SKU-01"),
    /引用/,
  );
  s.toggleCatalog("skus", "SKU-01");
  assert.throws(() => s.review("ORD-001", "BM-01"), /SKU/);
  s.saveCatalog("stores", { name: "New Store", code: "NEW" });
  assert.equal(s.data.stores.at(-1).enabled, true);
});
test("warehouse task ownership is enforced", () => {
  const storage = memory();
  const a = new WorkspaceStore(storage, "first");
  a.advanceTask("WH-003");
  const b = new WorkspaceStore(storage, "second");
  assert.throws(() => b.advanceTask("WH-003"), /自己领取/);
});
test("CSV round-trips quoted commas and line breaks and neutralizes spreadsheet formulas", () => {
  const rows = [{ name: 'a,"b"\n中文', value: "=1+1" }];
  const parsed = csvParse(csvEncode(rows, ["name", "value"]));
  assert.equal(parsed[0].name, rows[0].name);
  assert.equal(parsed[0].value, "'=1+1");
  assert.throws(() => csvParse('a,b\n"broken'), /引号/);
  assert.throws(() => csvParse("a,a\n1,2"), /重复/);
});
test("synthetic maintenance preserves catalogs and an auditable record", () => {
  const s = new WorkspaceStore(memory());
  s.resetSynthetic();
  assert.equal(s.data.orders.length, 0);
  assert.equal(s.data.shipments.length, 0);
  assert.equal(s.data.tasks.length, 0);
  assert.equal(s.data.returns.length, 0);
  assert.ok(s.data.stores.length);
  assert.equal(s.data.audit[0].action, "清理演练业务数据");
});
test("backup restoration validates references and keeps revision monotonic", () => {
  const s = new WorkspaceStore(memory());
  const backup = structuredClone(s.data);
  s.resetSynthetic();
  s.restore(backup);
  assert.equal(s.data.orders.length, 4);
  assert.equal(s.data.revision, 2);
  assert.equal(s.data.audit[0].action, "恢复工作区备份");
  const broken = structuredClone(backup);
  broken.tasks[0].orderId = "missing";
  assert.throws(() => s.restore(broken), /引用/);
  assert.equal(s.data.revision, 2);
});
