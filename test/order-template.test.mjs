import test from "node:test";
import assert from "node:assert/strict";
import { ORDER_CSV_COLUMNS, ORDER_TEMPLATE_FILENAME, ORDER_TEMPLATE_EXAMPLE } from "../dist/order-template.js";
import { csvEncode, csvParse, WorkspaceStore } from "../dist/workspace-store.js";
test("English CSV template preserves the supplied 18-column schema and imports successfully", () => {
  assert.equal(ORDER_TEMPLATE_FILENAME, "order-import-template.csv");
  assert.deepEqual(ORDER_CSV_COLUMNS, ["externalId", "store", "recipient", "country", "city", "postal", "address", "phone", "email", "product", "quantity", "sku", "variation", "amount", "currency", "weight", "deadline", "notes"]);
  const text = csvEncode([ORDER_TEMPLATE_EXAMPLE], ORDER_CSV_COLUMNS);
  assert.doesNotMatch(text.slice(1), /[^\x00-\x7F]/);
  const parsed = csvParse(text);
  assert.equal(parsed[0].variation, "Color: Gold; Size: 15 cm");
  const memory = { value: null, getItem() { return this.value; }, setItem(_k, v) { this.value = v; } };
  const store = new WorkspaceStore(memory);
  const id = store.saveOrder(parsed[0]);
  assert.equal(store.data.orders.find((o) => o.id === id).amount, 12);
});
