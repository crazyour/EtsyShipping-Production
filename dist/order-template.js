// Keep column order compatible with the user-supplied order import template.
export const ORDER_CSV_COLUMNS = Object.freeze([
  "externalId", "store", "recipient", "country", "city", "postal", "address",
  "phone", "email", "product", "quantity", "sku", "variation", "amount",
  "currency", "weight", "deadline", "notes",
]);
export const ORDER_TEMPLATE_FILENAME = "order-import-template.csv";
export const ORDER_TEMPLATE_EXAMPLE = Object.freeze({
  externalId: "EXAMPLE-ORDER-001",
  store: "Hana Metal",
  recipient: "Test Buyer",
  country: "US",
  city: "Seattle",
  postal: "98101",
  address: "123 Example Street",
  phone: "",
  email: "buyer@example.com",
  product: "Brass bookmark",
  quantity: 1,
  sku: "BM-01",
  variation: "Color: Gold; Size: 15 cm",
  amount: 12,
  currency: "USD",
  weight: 90,
  deadline: "",
  notes: "Sample data only. Replace before importing.",
});
