// Shared, dependency-free interchange validation. Never persist arbitrary input keys.
export const ETSY_FORMAT = "etsyshipping.etsy-orders";
export const ETSY_FILE_LIMIT = 8 * 1024 * 1024;
export function etsyId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Etsy ID 超出安全整数范围，不能可靠导入。");
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/.test(id)) throw new Error("Etsy ID 无效。");
  return id;
}
const string = (value, max = 4000) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max)
    throw new Error("订单文本类型无效或过长。");
  return value;
};
const date = (value) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("订单时间无效。");
  return new Date(value).toISOString();
};
const money = (value) => {
  if (!value || !Number.isSafeInteger(value.amount) || value.amount < 0 ||
      !Number.isSafeInteger(value.divisor) || value.divisor <= 0 ||
      !/^[A-Z]{3}$/.test(value.currency_code))
    throw new Error("订单金额或币种缺失 / 无效，不能用零金额代替。");
  return { amount: value.amount, divisor: value.divisor, currency_code: value.currency_code };
};
const optionalId = (v) => v == null || v === 0 ? "" : etsyId(v);
const boolean = (v) => {
  if (typeof v !== "boolean") throw new Error("订单付款或发货状态无效。");
  return v;
};
export function validateEtsyBundle(input) {
  if (!input || input.format !== ETSY_FORMAT || input.version !== 1 ||
      !Array.isArray(input.orders) || input.orders.length > 1000)
    throw new Error("请选择本地 Etsy 下载工具生成的 JSON 文件（最多 1000 笔）。");
  const shopId = etsyId(input.shopId), seen = new Set();
  const orders = input.orders.map((o) => {
    const receiptId = etsyId(o.receiptId);
    if (seen.has(receiptId)) throw new Error("文件包含重复 Etsy 订单号。");
    seen.add(receiptId);
    if (!Array.isArray(o.items) || !o.items.length || o.items.length > 500)
      throw new Error(`订单 ${receiptId} 的商品明细缺失或过多。`);
    const itemIds = new Set();
    const items = o.items.map((i) => {
      const transactionId = etsyId(i.transactionId);
      if (itemIds.has(transactionId)) throw new Error("同一订单包含重复商品明细。");
      itemIds.add(transactionId);
      if (!Number.isSafeInteger(i.quantity) || i.quantity < 0 || i.quantity > 1000000)
        throw new Error("商品数量无效。");
      if (!Array.isArray(i.variations) || i.variations.length > 100)
        throw new Error("商品规格格式无效。");
      return {
        transactionId, listingId: optionalId(i.listingId || null),
        imageId: optionalId(i.imageId || null), title: string(i.title),
        sku: string(i.sku, 500), quantity: i.quantity, price: money(i.price),
        isDigital: boolean(i.isDigital),
        variations: i.variations.map((v) => ({ name: string(v.name), value: string(v.value) })),
      };
    });
    const country = string(o.country, 2).toUpperCase();
    if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("国家代码无效。");
    return {
      receiptId, createdAt: date(o.createdAt), updatedAt: date(o.updatedAt),
      status: string(o.status, 100), isPaid: boolean(o.isPaid), isShipped: boolean(o.isShipped),
      recipient: string(o.recipient, 500), address: string(o.address),
      city: string(o.city, 500), region: string(o.region, 500), postal: string(o.postal, 100),
      country, total: money(o.total), buyerMessage: string(o.buyerMessage),
      giftMessage: string(o.giftMessage), items,
    };
  });
  return { format: ETSY_FORMAT, version: 1, shopId,
    shopName: string(input.shopName, 200), exportedAt: date(input.exportedAt), orders };
}
export function bundleFromReceipts(receipts, { shopId, shopName = "", exportedAt = new Date().toISOString() }) {
  const timestamp = (v) => {
    if (!Number.isSafeInteger(v) || v < 946684800 || v > 8640000000000)
      throw new Error("Etsy 返回的订单时间无效。");
    return new Date(v * 1000).toISOString();
  };
  return validateEtsyBundle({ format: ETSY_FORMAT, version: 1, shopId, shopName, exportedAt,
    orders: receipts.map((r) => ({
      receiptId: r.receipt_id, createdAt: timestamp(r.create_timestamp ?? r.created_timestamp),
      updatedAt: timestamp(r.update_timestamp ?? r.updated_timestamp), status: r.status,
      isPaid: r.is_paid, isShipped: r.is_shipped, recipient: r.name,
      address: [r.first_line, r.second_line].filter(Boolean).join("\n"),
      city: r.city, region: r.state, postal: r.zip, country: r.country_iso,
      total: r.grandtotal, buyerMessage: r.message_from_buyer, giftMessage: r.gift_message,
      items: r.transactions?.map((t) => ({
        transactionId: t.transaction_id, listingId: t.listing_id, imageId: t.listing_image_id,
        title: t.title, sku: t.sku, quantity: t.quantity, price: t.price, isDigital: t.is_digital,
        variations: (t.variations || []).map((v) => ({ name: v.formatted_name, value: v.formatted_value })),
      })),
    })),
  });
}
export function etsyWarnings(order) {
  const missing = [["收件人", order.recipient], ["地址", order.address], ["国家", order.country]]
    .filter(([, value]) => !value?.trim()).map(([name]) => name);
  return [
    ...(missing.length ? [`缺少${missing.join("、")}（可能受接口权限限制）`] : []),
    ...(!order.isPaid ? ["未付款"] : []),
    ...(order.items.some((i) => i.isDigital) ? ["包含数字商品"] : []),
    ...(order.items.some((i) => !i.sku) ? ["部分商品没有 SKU"] : []),
  ];
}
