import { csvEncode } from "./workspace-store.js";
import { ORDER_CSV_COLUMNS } from "./order-template.js";
import { etsyWarnings } from "./etsy-orders.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (v) => `${v.currency_code} ${v.amount / v.divisor}`;
const button = (label, action, disabled = false, id = "") => `<button type="button" class="action-button" data-action="cloud-${action}" data-id="${esc(id)}" ${disabled ? "disabled" : ""}>${esc(label)}</button>`;
const table = (heads, rows) => `<div class="table-scroll" tabindex="0" aria-label="Etsy 数据表格，可横向滚动"><table><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
const labels = { pending: "等待中", running: "同步中", done: "完成", failed: "失败", skipped: "已跳过" };
export function cloudCsvRows(orders) {
  return orders.map((o) => ({ externalId: o.receiptId, store: o.shopName, recipient: o.recipient,
    country: o.country, city: o.city, postal: o.postal, address: [o.address, o.region].filter(Boolean).join("\n"),
    phone: "", email: "", product: o.items.map((i) => `${i.title} × ${i.quantity}`).join(" | "),
    quantity: o.items.reduce((sum, i) => sum + i.quantity, 0), sku: o.items.map((i) => i.sku).join(" | "),
    variation: o.items.map((i) => `${i.sku || i.transactionId}: ${i.variations.map((v) => `${v.name}: ${v.value}`).join("; ")}`).join(" | "),
    amount: o.total.amount / o.total.divisor, currency: o.total.currency_code, weight: "", deadline: "",
    notes: [`Shop ID: ${o.shopId}`, `Status: ${o.status}`, o.buyerMessage, o.giftMessage,
      ...o.items.map((i) => `Item ${i.transactionId} image: ${i.imageUrl || "Unavailable"}`)].filter(Boolean).join("\n"),
  }));
}
export class EtsyCloudUI {
  constructor(workspace) { this.w = workspace; this.epoch = 0; this.reset(); }
  reset() { this.epoch++; this.running = false; this.stop = true; this.busy = false; this.items = []; this.total = 0; this.offset = 0; this.job = null; this.error = ""; this.since = ""; }
  render() {
    const w = this.w;
    const heading = w.heading("Etsy 订单同步", "真实订单保存在网站后台，与浏览器演练订单分开；此页仅管理员可访问。",
      button("返回高级管理", "back") + (w.apiAdmin ? '<button type="button" class="action-button" data-action="etsy-config-open">店铺授权与配置</button>' : ""));
    if (!w.apiAdmin) return heading + `<p class="notice" role="status">${esc(w.apiAdminNotice || "请使用服务端验证的管理员账号登录，并完成安全存储配置。")}</p>`;
    const shops = this.job?.shops || [];
    const actions = `<div class="toolbar"><label for="cloudSince">补取历史的起始日期（可选）<input id="cloudSince" type="date" min="2000-01-01" max="${new Date().toISOString().slice(0, 10)}" value="${esc(this.since)}" ${this.running || this.busy ? "disabled" : ""}></label>
      ${button(this.running ? "正在自动同步…" : this.job?.status === "running" ? "继续未完成同步" : "一键同步所有店铺", "start", this.running || this.busy)}
      ${button("暂停", "pause", !this.running)}${button("重试失败店铺", "retry", this.running || this.busy || !shops.some((s) => ["failed", "skipped"].includes(s.status)))}
      ${button("刷新状态", "refresh", this.running || this.busy)}</div>`;
    return heading + w.panel("同步控制", actions + `<div class="panel-padding"><p>留空：首次读取近 30 天，之后增量同步；填写日期：补取该日期以来有更新的订单。停用店铺不参与。无需下载再上传。</p><p class="muted">请保持此页面打开。关闭页面或会话过期会暂停后续批次，重新登录后点击继续。图片保存 Etsy 链接，不是原图备份。</p>
      <p role="status" aria-live="polite">${this.running ? (this.job?.retryAt > Date.now() ? "Etsy 限流或暂不可用，正在等待自动重试。" : "正在分批读取、匹配图片并自动保存…") : this.job?.status === "running" ? "任务尚未完成，可以继续。" : this.job ? "本轮已结束，请查看各店铺结果。" : "尚未开始同步。"}</p>
      ${this.error ? `<p class="form-error" role="alert">${esc(this.error)}</p>` : ""}</div>` + (shops.length ? table(["店铺", "结果", "已读取 / 总计", "新增 / 更新 / 未变化", "资料缺失订单", "说明"], shops.map((s) =>
        `<tr><td>${esc(s.name)}<small>${esc(s.shopId)}</small></td><td>${labels[s.status] || esc(s.status)}</td><td>${s.fetched} / ${s.total ?? "—"}</td><td>${s.inserted} / ${s.updated} / ${s.unchanged}</td><td>${s.warnings}</td><td>${esc(s.error || "—")}</td></tr>`)) : "")) +
      w.panel(`已保存的真实订单 · ${this.total} 笔`, this.items.length ? table(["订单号 / 店铺", "收件人 / 地址", "商品", "订单总额", "操作"], this.items.map((o, index) =>
        `<tr><td>${esc(o.receiptId)}<small>${esc(o.shopName)} · ${esc(o.shopId)}</small></td><td>${esc(o.recipient || "收件人缺失")}<small>${esc([o.address, o.city, o.region, o.postal, o.country].filter(Boolean).join(", ") || "地址未返回")}</small></td><td>${esc(o.items.map((i) => `${i.title} × ${i.quantity}`).join(" / "))}</td><td>${esc(money(o.total))}</td><td>${button("详情与图片", "detail", false, index)}</td></tr>`)) : '<div class="empty-state"><p>暂无已保存订单；请先授权并同步店铺。</p></div>',
      button("导出本页（英文 CSV）", "export", !this.items.length || this.busy) + button("上一页", "prev", this.offset === 0 || this.busy || this.running) + button("下一页", "next", this.offset + this.items.length >= this.total || this.busy || this.running));
  }
  paint() {
    if (this.w.page !== "etsyCloud") return;
    const active = document.activeElement;
    const action = this.w.root.contains(active) ? active?.dataset?.action : null;
    this.w.render();
    if (action) {
      const replacement = [...this.w.root.querySelectorAll("[data-action]")].find((b) => b.dataset.action === action && !b.disabled);
      replacement?.focus({ preventScroll: true });
    }
  }
  async request(route, body) {
    return this.w.request(`/api/bridge?route=${route}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  }
  async load() {
    const epoch = this.epoch;
    const [status, orders] = await Promise.all([this.request("etsy-sync-status"), this.request(`etsy-cloud-orders&offset=${this.offset}`)]);
    if (epoch !== this.epoch || !this.w.apiAdmin) return;
    this.job = status.job; this.items = orders.items; this.total = orders.total;
  }
  async open() {
    this.w.navigate("etsyCloud");
    if (!this.w.apiAdmin || this.running) return;
    this.busy = true; this.paint();
    try { await this.load(); this.error = ""; } catch (e) { this.error = e.message; }
    finally { this.busy = false; this.paint(); }
  }
  async run(retry = false) {
    if (this.running || this.busy) return;
    this.running = true; this.stop = false; this.error = "";
    const epoch = this.epoch;
    this.paint();
    try {
      const response = retry ? await this.request("etsy-sync-retry", { jobId: this.job.id })
        : this.job?.status === "running" ? { job: this.job }
        : await this.request("etsy-sync-start", this.since ? { since: `${this.since}T00:00:00.000Z` } : {});
      if (epoch !== this.epoch) return;
      this.job = response.job;
      while (this.job.status === "running" && !this.stop && this.w.apiAdmin && epoch === this.epoch) {
        if (!this.job.retryAt || Date.now() >= this.job.retryAt) {
          const next = await this.request("etsy-sync-step", { jobId: this.job.id });
          if (epoch !== this.epoch) return;
          this.job = next.job;
        }
        this.paint();
        await new Promise((r) => setTimeout(r, 500));
      }
      if (epoch === this.epoch && this.w.apiAdmin) await this.load();
    } catch (e) { if (epoch === this.epoch) this.error = `${e.message} 已保存的订单不会丢失，可刷新后继续。`; }
    finally { if (epoch === this.epoch) { this.running = false; this.paint(); } }
  }
  detail(index) {
    const o = this.items[Number(index)]; if (!o) return;
    const warnings = etsyWarnings(o);
    this.w.dialogForm(`Etsy 订单 ${o.receiptId}`, `<p>${esc(o.shopName)} · ${esc(o.status)} · ${esc(money(o.total))}</p>
      <p>${esc([o.recipient, o.address, o.city, o.region, o.postal, o.country].filter(Boolean).join(" / "))}</p>
      ${warnings.length ? `<p class="notice">${esc(warnings.join("；"))}</p>` : ""}` + table(["商品图片", "商品 / SKU", "数量", "颜色、尺寸与定制", "单价"], o.items.map((i) => {
        const image = /^https:\/\/i\.etsystatic\.com\//.test(i.imageUrl || "") ? i.imageUrl : "";
        return `<tr><td>${image ? `<a href="${esc(image)}" target="_blank" rel="noopener noreferrer"><img class="etsy-order-image" src="${esc(image)}" alt="${esc(i.title)}" loading="lazy" referrerpolicy="no-referrer"></a>` : esc(i.imageWarning || "图片未提供")}</td><td>${esc(i.title)}<small>${esc(i.sku || "无 SKU")}</small></td><td>${i.quantity}</td><td>${esc(i.variations.map((v) => `${v.name}: ${v.value}`).join("; ") || "规格未提供")}</td><td>${esc(money(i.price))}</td></tr>`;
      })) + `<p>买家备注：${esc(o.buyerMessage || "—")}</p><p class="muted">图片为商品图，不保证包含聊天附件或买家定制稿。此页不会创建物流单或回填 Etsy。</p>`, null, "", true);
  }
  async action(action, id) {
    if (action === "back") { this.stop = true; this.w.navigate("admin"); return; }
    if (!this.w.apiAdmin) throw new Error("此功能仅限服务端验证的管理员。");
    if (action === "start" || action === "retry") return this.run(action === "retry");
    if (action === "pause") { this.stop = true; return; }
    if (action === "detail") { this.detail(id); return; }
    if (action === "export") {
      const url = URL.createObjectURL(new Blob([csvEncode(cloudCsvRows(this.items), ORDER_CSV_COLUMNS)], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = "etsy-orders.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (this.running || this.busy) return;
    if (action === "next") this.offset += 25;
    if (action === "prev") this.offset = Math.max(0, this.offset - 25);
    await this.open();
  }
}
