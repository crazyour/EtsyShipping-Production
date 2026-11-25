import {
  WorkspaceStore,
  catalogs,
  ORDER_STATES,
  TASK_STATES,
  csvEncode,
  csvParse,
  now,
  uid,
} from "./workspace-store.js";
import { ORDER_CSV_COLUMNS, ORDER_TEMPLATE_FILENAME, ORDER_TEMPLATE_EXAMPLE } from "./order-template.js";
import { EtsyCloudUI } from "./etsy-cloud-ui.js";
import { openServerSetup } from "./server-setup-ui.js";

export const pages = {
  dashboard: "经营看板",
  upload: "订单助手",
  orders: "我的订单",
  shipping: "待选择物流",
  warehouse: "仓库与打印",
  returns: "Etsy 人工回填",
  tracking: "物流状态",
  master: "业务设置",
  settings: "连接与安全",
  etsyCloud: "Etsy 订单同步",
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (v) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
const tag = (v) =>
  `<span class="tag ${/异常|取消|失败|停用/.test(v) ? "bad" : /完成|签收|发货|启用|回填$/.test(v) && !v.startsWith("待") ? "good" : "warn"}">${esc(v || "未设置")}</span>`;
const btn = (label, action, id = "", primary = false) =>
  `<button type="button" class="action-button${primary ? " primary" : ""}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
const empty = (
  message = "没有符合条件的记录",
  detail = "调整筛选条件，或使用上方按钮创建记录。",
) =>
  `<div class="empty-state"><strong>${esc(message)}</strong><p>${esc(detail)}</p></div>`;
const table = (heads, rows) =>
  rows.length
    ? `<div class="table-scroll" tabindex="0" aria-label="数据表格，可横向滚动"><table><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : empty();
const field = (key, label, type = "text", opts = {}) => ({
  key,
  label,
  type,
  ...opts,
});
const options = (list, value) =>
  list
    .map((x) => {
      const [v, t] = Array.isArray(x) ? x : [x, x];
      return `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(t)}</option>`;
    })
    .join("");
function fields(definitions, values = {}) {
  return `<div class="form-grid">${definitions.map((f) => `<div class="form-field ${f.type === "textarea" ? "span-2" : ""}"><label for="field-${f.key}">${esc(f.label)}${f.required ? ' <span aria-hidden="true">*</span>' : ""}</label>${f.type === "select" ? `<select id="field-${f.key}" name="${f.key}" ${f.required ? "required" : ""}>${options(f.options, values[f.key])}</select>` : f.type === "textarea" ? `<textarea id="field-${f.key}" name="${f.key}" rows="3" ${f.required ? "required" : ""} maxlength="4000">${esc(values[f.key])}</textarea>` : `<input id="field-${f.key}" name="${f.key}" type="${f.type}" value="${esc(values[f.key])}" ${f.required ? "required" : ""} ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.type === "number" ? 'step="any"' : ""} maxlength="500">`}</div>`).join("")}</div>`;
}
function download(name, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class WorkspaceUI {
  constructor({ root, actor, toast, request, meta, mode = "demo", apiAdmin = false, apiAdminNotice = "", serverConfigAdmin = false, serverConfig = null }) {
    this.apiAdmin = apiAdmin;
    this.apiAdminNotice = apiAdminNotice;
    this.serverConfigAdmin = serverConfigAdmin;
    this.serverConfig = serverConfig;
    this.etsyConfigs = [];
    this.cloud = new EtsyCloudUI(this);
    this.root = root;
    this.actor = actor;
    this.toast = toast;
    this.request = request;
    this.meta = meta;
    this.mode = mode;
    this.store = new WorkspaceStore(localStorage, actor);
    this.page = "dashboard";
    this.tab = "stores";
    this.selection = "";
    this.query = "";
    this.filter = "";
    this.storeFilter = "";
    this.countryFilter = "";
    this.pageNumber = 1;
    this.selected = new Set();
    this.attachments = [];
    this.attachmentUrls = [];
    this.clickHandler = (e) => {
      const control = e.target.closest("[data-action]");
      if (control)
        this.action(control.dataset.action, control.dataset.id, control).catch(
          (err) => this.toast(err.message),
        );
    };
    this.root.addEventListener("click", this.clickHandler);
    this.root.addEventListener("dblclick", (e) => {
      const row = e.target.closest("[data-order]");
      if (row) this.orderDetail(row.dataset.order);
    });
    this.root.addEventListener("change", (e) => this.change(e));
    this.root.addEventListener("input", (e) => {
      if (e.target.id === "workspaceSearch") {
        const start = e.target.selectionStart;
        this.query = e.target.value;
        this.pageNumber = 1;
        this.render();
        const input = this.root.querySelector("#workspaceSearch");
        input.focus();
        input.setSelectionRange(start, start);
      }
    });
    this.dialog = document.querySelector("#workDialog");
    this.dialog.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) this.dialog.close();
    });
    this.dialog.addEventListener("close", () => {
      if (this.dialog.open) return;
      this.dialog.replaceChildren();
      this.modalCleanup?.();
      this.modalCleanup = null;
      this.lastFocus?.focus?.();
    });
    this.dropHandler = (e) => {
      if (this.page !== "upload" || !e.dataTransfer?.files.length) return;
      e.preventDefault();
      this.addFiles([...e.dataTransfer.files]).catch((err) =>
        this.toast(err.message),
      );
    };
    this.root.addEventListener("dragover", (e) => {
      if (this.page === "upload") e.preventDefault();
    });
    this.root.addEventListener("drop", this.dropHandler);
  }
  destroy() {
    this.root.removeEventListener("click", this.clickHandler);
    this.attachmentUrls.forEach(URL.revokeObjectURL);
  }
  get data() {
    return this.store.data;
  }
  heading(title, subtitle, actions = "") {
    return `<header class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="page-actions">${actions}</div></header>`;
  }
  panel(title, body, actions = "") {
    return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2><div class="page-actions">${actions}</div></div>${body}</section>`;
  }
  toolbar(extra = "") {
    return `<div class="toolbar"><label class="search-box" for="workspaceSearch"><span>搜索</span><input id="workspaceSearch" value="${esc(this.query)}" placeholder="输入编号、名称或关键词"></label>${extra}</div>`;
  }
  matches(row) {
    return (
      !this.query ||
      Object.values(row).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(this.query.toLowerCase()),
      )
    );
  }
  navigate(page) {
    if (this.page === "etsyCloud" && page !== "etsyCloud") this.cloud.stop = true;
    this.page = page;
    this.query = "";
    this.filter = "";
    this.storeFilter = "";
    this.countryFilter = "";
    this.selection = "";
    this.pageNumber = 1;
    this.selected.clear();
    this.render();
  }
  render() {
    const renderers = {
      dashboard: () => this.dashboard(),
      upload: () => this.upload(),
      orders: () => this.orders(),
      shipping: () => this.shipping(),
      warehouse: () => this.warehouse(),
      returns: () => this.returns(),
      tracking: () => this.tracking(),
      master: () => this.catalogPage(),
      settings: () => this.settings(),
      etsyCloud: () => this.cloud.render(),
    };
    this.root.innerHTML = (renderers[this.page] || renderers.dashboard)();
    document.querySelectorAll("[data-page]").forEach((b) => {
      b.classList.toggle("active", b.dataset.page === this.page);
      if (b.dataset.page === this.page) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    document.querySelector("#workspaceTitle").textContent =
      pages[this.page] || "工作台";
    document.querySelector("#recordStatus").textContent =
      this.page === "etsyCloud" ? `${this.cloud.total} 笔云端订单 · 不计入浏览器演练订单`
        : `${this.data.orders.filter((o) => !o.archived).length} 笔订单 · 最近保存 ${date(this.data.audit[0]?.at)}`;
  }
  dialogForm(title, body, onSubmit, submit = "保存", wide = false) {
    this.lastFocus = document.activeElement;
    if (this.dialog.open) {
      this.dialog.close();
      this.dialog.replaceChildren();
    }
    // close events are queued; open the next dialog after the old one has cleared.
    queueMicrotask(() => {
      this.dialog.classList.toggle("wide", wide);
      this.dialog.innerHTML = `<form id="workForm"><div class="dialog-heading"><h2>${esc(title)}</h2><button type="button" data-close aria-label="关闭对话框">关闭</button></div><div class="dialog-body">${body}<p class="form-error" id="workError" role="alert" tabindex="-1" hidden></p></div><footer class="dialog-footer"><button type="button" class="action-button" data-close>关闭</button>${onSubmit ? `<button class="action-button primary" type="submit">${esc(submit)}</button>` : ""}</footer></form>`;
      this.dialog.showModal();
      const form = this.dialog.querySelector("form");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!onSubmit) return;
        const button = form.querySelector("[type=submit]");
        button.disabled = true;
        try {
          const values = Object.fromEntries(new FormData(form));
          await onSubmit(values, form);
          this.dialog.close();
          this.render();
        } catch (err) {
          const out = form.querySelector("#workError");
          out.textContent = err.message;
          out.hidden = false;
          out.focus();
        } finally {
          button.disabled = false;
        }
      });
    });
  }
  confirm(title, message, fn, submit = "确认") {
    this.dialogForm(
      title,
      `<p class="confirm-copy">${esc(message)}</p>`,
      () => fn(),
      submit,
    );
  }
  dashboard() {
    const orders = this.data.orders.filter((o) => !o.archived);
    const metrics = [
      ["待复核", orders.filter((o) => o.status === "待复核").length, "orders"],
      [
        "待选择物流",
        orders.filter((o) => o.status === "待选物流").length,
        "shipping",
      ],
      [
        "仓库待处理",
        this.data.tasks.filter((t) => !["已交运", "已取消"].includes(t.status))
          .length,
        "warehouse",
      ],
      [
        "物流异常",
        this.data.shipments.filter((s) => s.status === "运输异常").length,
        "tracking",
      ],
    ];
    const totals = {};
    orders
      .filter((o) => o.status !== "已取消")
      .forEach(
        (o) =>
          (totals[o.currency] = (totals[o.currency] || 0) + Number(o.amount)),
      );
    return (
      this.heading(
        "经营看板",
        "订单识别、物流制单与仓库协作",
        btn("客户看板", "customer-report") +
          btn("新建订单", "new-order", "", true),
      ) +
      `<div class="metric-grid">${metrics.map(([name, count, page]) => `<button class="metric-card" data-action="goto" data-id="${page}"><span>${name}</span><strong>${count}</strong><small>查看待办</small></button>`).join("")}</div>` +
      `<div class="dashboard-grid">${this.panel(
        "订单与履约概览",
        `<div class="summary-grid"><div><span>订单总数</span><strong>${orders.length}</strong></div><div><span>已完成发货</span><strong>${orders.filter((o) => o.status === "已发货").length}</strong></div><div><span>订单金额（按币种）</span><strong class="amounts">${
          Object.entries(totals)
            .map(([c, v]) => `${c} ${v.toFixed(2)}`)
            .join("<br>") || "—"
        }</strong></div><div><span>演练运费 / CNY</span><strong>${this.data.shipments
          .filter((s) => s.status !== "已取消")
          .reduce((sum, s) => sum + Number(s.fee || 0), 0)
          .toFixed(2)}</strong></div></div>`,
      )}${this.panel(
        "操作流程",
        `<ol class="workflow-list">${[
          ["上传订单资料", "订单截图与产品图分别管理", "upload"],
          ["复核订单 / 绑定 SKU", "核对地址、规格、金额及申报信息", "orders"],
          ["选择物流 / 仓库履约", "制单、拣货、称重、打印与交运", "shipping"],
          ["Etsy 人工回填", "复制追踪资料，人工确认回填", "returns"],
        ]
          .map(
            ([title, desc, page]) =>
              `<li><button data-action="goto" data-id="${page}"><strong>${title}</strong><span>${desc}</span></button></li>`,
          )
          .join("")}</ol>`,
      )}</div>` +
      this.panel(
        "最近订单",
        this.orderTable(orders.slice(0, 6), false),
        btn("全部订单", "goto", "orders"),
      ) +
      this.panel(
        "最近操作记录",
        this.auditTable(this.data.audit.slice(0, 5)),
      )
    );
  }
  orderTable(rows, selectable = true) {
    return table(
      [
        selectable
          ? '<input type="checkbox" id="selectAll" aria-label="选择本页订单">'
          : "序号",
        "业务单号 / 平台订单号",
        "店铺 / 收件人",
        "国家",
        "商品 / SKU",
        "数量",
        "订单状态",
        "当前处理人",
        "操作",
      ],
      rows.map(
        (o, i) =>
          `<tr data-order="${esc(o.id)}"><td>${selectable ? `<input type="checkbox" class="order-check" value="${esc(o.id)}" aria-label="选择 ${esc(o.number)}" ${this.selected.has(o.id) ? "checked" : ""}>` : i + 1}</td><td><button class="cell-link" data-action="order" data-id="${esc(o.id)}">${esc(o.number)}</button><small>${esc(o.externalId || "未填写平台单号")}</small></td><td>${esc(o.store)}<small>${esc(o.recipient)}</small></td><td>${esc(o.country)}</td><td>${esc(o.product)}<small>${esc(o.sku || "待绑定 SKU")}</small></td><td>${o.quantity}</td><td>${tag(o.status)}</td><td>${esc(o.handler || "未分配")}</td><td><button class="row-button" data-action="order" data-id="${esc(o.id)}">查看 / 复核</button></td></tr>`,
      ),
    );
  }
  orders() {
    const rows = this.data.orders.filter(
      (o) =>
        !o.archived &&
        this.matches(o) &&
        (!this.filter || o.status === this.filter) &&
        (!this.storeFilter || o.store === this.storeFilter) &&
        (!this.countryFilter ||
          o.country.toLowerCase().includes(this.countryFilter.toLowerCase())),
    );
    const count = Math.max(1, Math.ceil(rows.length / 15));
    this.pageNumber = Math.min(this.pageNumber, count);
    return (
      this.heading(
        "我的订单",
        "双击订单查看收件资料、商品、原始资料和处理记录。",
        btn("Etsy 订单同步", "cloud-open") + btn("上传 / 新建订单", "goto", "upload") +
          btn("导出订单", "export-orders") +
          btn("手工新建订单", "new-order", "", true),
      ) +
      this.panel(
        "订单列表",
        this.toolbar(
          `<label>订单状态<select id="statusFilter">${options(["", ...ORDER_STATES], this.filter)}</select></label><label>店铺<select id="storeFilter">${options([["", "全部店铺"], ...this.data.stores.map((s) => s.name)], this.storeFilter)}</select></label><label>国家<input id="countryFilter" value="${esc(this.countryFilter)}" placeholder="US / GB" maxlength="2"></label>`,
        ) +
          `<div class="selection-bar"><span id="selectionCount">已选 ${this.selected.size} 项</span>${btn("批量复核", "bulk-review")}${btn("导出选中", "export-selected")}<span class="muted">共 ${rows.length} 条记录</span></div>` +
          this.orderTable(
            rows.slice((this.pageNumber - 1) * 15, this.pageNumber * 15),
          ) +
          `<div class="pagination">${btn("上一页", "prev-page")}<span>第 ${this.pageNumber} / ${count} 页</span>${btn("下一页", "next-page", String(count))}</div>`,
      )
    );
  }
  orderFields() {
    return [
      field("externalId", "Etsy / 平台订单号"),
      field("store", "店铺", "select", {
        required: true,
        options: this.data.stores.filter((s) => s.enabled).map((s) => s.name),
      }),
      field("recipient", "收件人", "text", { required: true }),
      field("country", "国家代码", "text", { required: true }),
      field("city", "城市", "text", { required: true }),
      field("postal", "邮编", "text", { required: true }),
      field("address", "详细地址", "textarea", { required: true }),
      field("phone", "联系电话"),
      field("email", "电子邮箱", "email"),
      field("product", "商品名称", "text", { required: true }),
      field("quantity", "数量", "number", { min: 1, required: true }),
      field("sku", "内部 SKU"),
      field("variation", "规格 / 定制内容"),
      field("amount", "订单金额", "number", { min: 0, required: true }),
      field("currency", "币种", "select", {
        options: ["USD", "EUR", "GBP", "CNY", "JPY"],
      }),
      field("weight", "预估重量(g)", "number", { min: 0 }),
      field("deadline", "最晚发货日", "date"),
      field("notes", "备注", "textarea"),
    ];
  }
  orderForm(id, initial = {}) {
    const row = this.data.orders.find((o) => o.id === id);
    this.dialogForm(
      row ? "编辑订单" : "手工新建订单",
      `<p class="notice">保存到当前浏览器演练工作区。编辑后订单重新进入待复核。</p>${fields(this.orderFields(), row || { quantity: 1, amount: 0, currency: "USD", country: "US", ...initial })}`,
      (v) => {
        const saved = this.store.saveOrder(
          {
            ...v,
            attachments:
              row?.attachments ||
              this.attachments.map((a) => ({
                id: a.id,
                name: a.name,
                kind: a.kind,
                size: a.size,
              })),
          },
          id,
        );
        this.toast("订单已保存，等待复核");
        this.selection = saved;
        this.attachments = [];
      },
      "保存订单",
      true,
    );
  }
  orderDetail(id) {
    const o = this.data.orders.find((o) => o.id === id);
    if (!o) return;
    const info = [
      ["业务单号", o.number],
      ["平台单号", o.externalId],
      ["店铺", o.store],
      ["订单状态", o.status],
      ["收件人", o.recipient],
      ["国家 / 城市", `${o.country} / ${o.city}`],
      ["地址", `${o.address} ${o.postal}`],
      ["商品", `${o.product} × ${o.quantity}`],
      ["SKU / 规格", `${o.sku || "未绑定"} / ${o.variation || "—"}`],
      ["金额", `${o.currency} ${o.amount}`],
      ["重量", `${o.weight || 0} g`],
      ["备注", o.notes],
    ];
    this.dialogForm(
      "订单详情 · " + o.number,
      `<div class="detail-actions">${["待复核", "待选物流"].includes(o.status) ? btn("编辑资料", "edit-order", id) : ""}${btn("打印订单", "print-order", id)}${btn("归档错误订单", "archive-order", id)}</div><dl class="detail-grid">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`).join("")}</dl>${o.status === "待复核" ? `<h3>复核与 SKU 绑定</h3>${fields([field("sku", "选择已核对的 SKU", "select", { options: [["", "请选择 SKU"], ...this.data.skus.filter((s) => s.enabled).map((s) => [s.code, `${s.code} · ${s.name}`])], required: true })], o)}<label class="check-label"><input name="reviewed" type="checkbox" required>我已核对收件资料、商品规格、数量和申报资料</label>` : ""}<h3>原始资料</h3><div class="attachment-list">${o.attachments?.length ? o.attachments.map((a) => btn(a.name, "view-file", a.id)).join("") : '<p class="muted">该订单没有附加图片。</p>'}</div><h3>处理记录</h3>${this.auditTable(this.data.audit.filter((a) => a.target === id).slice(0, 10))}`,
      o.status === "待复核"
        ? (v) => {
            this.store.review(id, v.sku);
            this.toast("复核完成，可选择物流");
          }
        : null,
      "确认复核",
      true,
    );
    this.bindDialogActions();
  }
  bindDialogActions() {
    queueMicrotask(() => {
      this.dialog
        .querySelector(".dialog-body")
        ?.addEventListener("click", (e) => {
          const b = e.target.closest("[data-action]");
          if (!b) return;
          const { action, id } = b.dataset;
          this.dialog.close();
          setTimeout(
            () =>
              this.action(action, id, b).catch((err) =>
                this.toast(err.message),
              ),
            0,
          );
        });
    });
  }
  upload() {
    return (
      this.heading(
        "订单助手",
        "按原版流程分别上传订单截图和产品辨认图，再核对资料。",
        btn("手工新建订单", "new-order", "", true),
      ) +
      `<div class="notice">AI 服务未连接。可先上传图片留档，粘贴订单文本提取字段，再人工复核；此处不会产生虚假的 AI 识别结果。<div class="page-actions"><button class="action-button" disabled>开始 AI 识别（服务未连接）</button></div></div>` +
      `<div class="upload-grid">${["订单截图", "产品辨认图"]
        .map((kind, i) =>
          this.panel(
            `${i + 1}　上传${kind}`,
            `<div class="upload-zone"><div class="upload-symbol" aria-hidden="true">＋</div><strong>拖入图片，或选择文件</strong><p>${i ? "用于拣货、外观核对和仓库单据，不参与地址识别。" : "请包含订单号、收件地址、SKU、数量、金额与币种。"}</p><label class="file-button">选择${kind}<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-files="${kind}"></label><small>PNG / JPG / WebP，单张不超过 8 MB</small></div><div class="file-list">${
              this.attachments
                .filter((a) => a.kind === kind)
                .map(
                  (a) =>
                    `<div class="file-row"><img src="${a.url}" alt="${esc(a.name)}"><span>${esc(a.name)}<small>${Math.ceil(a.size / 1024)} KB · 已保存本机</small></span>${btn("预览", "preview-file", a.id)}${btn("移除", "remove-file", a.id)}</div>`,
                )
                .join("") || '<p class="muted">尚未选择图片</p>'
            }</div>`,
          ),
        )
        .join("")}</div>` +
      this.panel(
        "订单资料录入",
        `<div class="panel-padding"><p>已有文本订单可提取常用字段；CSV 可批量导入。图片保存在本机，不上传至外部服务。</p><div class="page-actions">${btn("粘贴文本 / 提取字段", "parse-text")}${btn("CSV 导入订单", "import-orders")}${btn("下载 CSV 模板", "download-order-template")}${btn("根据所选资料建单", "new-order", "", true)}</div></div>`,
      )
    );
  }
  async attachmentDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("etsyshipping-files", 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("files", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(new Error("浏览器无法保存图片。请检查存储权限。"));
    });
  }
  async fileDb(method, value) {
    const db = await this.attachmentDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(
          "files",
          method === "get" ? "readonly" : "readwrite",
        );
        const req = tx.objectStore("files")[method](value);
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(new Error("图片存储失败。"));
      });
    } finally {
      db.close();
    }
  }
  async addFiles(files, kind = "订单截图") {
    for (const f of files) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(f.type))
        throw new Error("只支持 PNG、JPEG 和 WebP 图片。");
      if (f.size > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8 MB。");
      if (this.attachments.length >= 20)
        throw new Error("每笔订单最多上传 20 张图片。");
      const id = uid("FILE");
      await this.fileDb("put", { id, blob: f, name: f.name });
      const url = URL.createObjectURL(f);
      this.attachmentUrls.push(url);
      this.attachments.push({ id, url, name: f.name, size: f.size, kind });
    }
    this.render();
    this.toast("图片已保存到当前浏览器");
  }
  async viewFile(id) {
    const file = await this.fileDb("get", id);
    if (!file)
      throw new Error("当前浏览器未找到这张图片；备份文件不包含图片原件。");
    const url = URL.createObjectURL(file.blob);
    this.dialogForm(
      file.name,
      `<img class="image-preview" src="${url}" alt="${esc(file.name)}">`,
      null,
      "",
      true,
    );
    this.modalCleanup = () => URL.revokeObjectURL(url);
  }
  shipping() {
    const rows = this.data.orders.filter(
      (o) => o.status === "待选物流" && !o.archived && this.matches(o),
    );
    const o = rows.find((o) => o.id === this.selection) || rows[0];
    return (
      this.heading(
        "待选择物流",
        "选择订单，核对收件人和包裹，再选择物流渠道与发货仓库。",
      ) +
      `<div class="split-view">${this.panel(
        "待处理订单",
        this.toolbar() +
          table(
            ["业务单号", "收件人", "国家", "操作"],
            rows.map(
              (r) =>
                `<tr class="${o?.id === r.id ? "selected-row" : ""}"><td>${esc(r.number)}<small>${esc(r.product)}</small></td><td>${esc(r.recipient)}</td><td>${esc(r.country)}</td><td>${btn("选择", "select", r.id)}</td></tr>`,
            ),
          ),
      )}${this.panel("订单摘要与发货准备", o ? `<div class="panel-padding"><h3>${esc(o.number)}</h3>${tag(o.status)}<dl class="definition-list"><dt>收件人</dt><dd>${esc(o.recipient)}</dd><dt>目的地</dt><dd>${esc(o.country + " / " + o.city)}</dd><dt>商品</dt><dd>${esc(o.product)} × ${o.quantity}</dd><dt>SKU</dt><dd>${esc(o.sku)}</dd><dt>预估重量</dt><dd>${o.weight} g</dd></dl><div class="notice">创建后生成以 DEMO 开头的演练单号，并进入仓库任务，不调用物流商接口。</div><div class="page-actions">${btn("复核与编辑", "edit-order", o.id)}${btn("准备发货", "shipping-draft", o.id, true)}</div></div>` : empty("没有待选择物流的订单", "请先在“我的订单”完成复核。"))}</div>` +
      this.panel(
        "常用物流方案",
        table(
          ["方案名称", "物流商", "渠道", "支持国家", "重量上限"],
          this.data.presets
            .filter((p) => p.enabled)
            .map(
              (p) =>
                `<tr><td>${esc(p.name)}</td><td>${esc(p.provider)}</td><td>${esc(p.channel)}</td><td>${esc(p.countries)}</td><td>${esc(p.weightLimit)} g</td></tr>`,
            ),
        ),
        btn("管理物流方案", "catalog", "presets"),
      )
    );
  }
  shippingDraft(id) {
    const o = this.data.orders.find((o) => o.id === id);
    this.dialogForm(
      "发货草稿 · " + o.number,
      `<p class="notice">仅创建演练物流单；真实发货需要生产服务和物流商凭据。</p>${fields([field("preset", "物流方案", "select", { options: this.data.presets.filter((p) => p.enabled).map((p) => [p.id, p.name]), required: true }), field("warehouse", "发货仓库", "select", { options: this.data.warehouses.filter((w) => w.enabled).map((w) => w.name), required: true }), field("weight", "包裹重量(g)", "number", { min: 1, required: true }), field("fee", "演练运费(CNY)", "number", { min: 0 })], { weight: o.weight, fee: 0 })}<label class="check-label"><input type="checkbox" required>已核对目的国、商品申报和包裹资料</label>`,
      (v) => {
        this.store.createShipment(id, v);
        this.toast("演练物流单已创建，仓库任务已生成");
      },
      "创建演练物流单",
    );
  }
  warehouse() {
    const rows = this.data.tasks.filter(
      (t) =>
        this.matches({
          ...t,
          ...this.data.orders.find((o) => o.id === t.orderId),
        }) &&
        (!this.filter || t.status === this.filter),
    );
    const t = rows.find((t) => t.id === this.selection) || rows[0];
    const o = t && this.data.orders.find((o) => o.id === t.orderId);
    const actions = {
      待领取: "领取任务",
      拣货中: "完成拣货",
      待称重: "录入实际重量",
      待打印: "预览并打印",
      待交运: "确认交运",
    };
    return (
      this.heading(
        "仓库与打印",
        "领取任务，核对商品、称重、打印和交运。",
        btn("打印机设置", "printer") + btn("扫描 / 输入任务号", "scan"),
      ) +
      `<div class="status-chips">${TASK_STATES.map((s) => `<button data-action="filter" data-id="${s}" class="${this.filter === s ? "active" : ""}">${s} <b>${this.data.tasks.filter((t) => t.status === s).length}</b></button>`).join("")}${btn("全部", "filter")}</div>` +
      this.panel(
        "仓库任务",
        this.toolbar() +
          table(
            [
              "任务号 / 订单",
              "商品 / SKU",
              "数量",
              "仓库",
              "状态",
              "领取人",
              "操作",
            ],
            rows.map((r) => {
              const order =
                this.data.orders.find((o) => o.id === r.orderId) || {};
              return `<tr class="${r.id === t?.id ? "selected-row" : ""}"><td>${esc(r.id)}<small>${esc(order.number)}</small></td><td>${esc(order.product)}<small>${esc(order.sku)}</small></td><td>${esc(order.quantity)}</td><td>${esc(r.warehouse)}</td><td>${tag(r.status)}</td><td>${esc(r.owner || "未领取")}</td><td>${btn("任务详情", "select", r.id)}</td></tr>`;
            }),
          ),
      ) +
      (t
        ? this.panel(
            "当前任务详情",
            `<div class="task-detail"><div><h3>${esc(o?.product)} × ${esc(o?.quantity)}</h3><p>${esc(o?.variation || "标准规格")}</p><p class="muted">${esc(t.id)} · ${esc(t.warehouse)} · ${esc(t.owner || "未领取")}</p><p>实际重量：<strong>${t.weight || "待称重"} g</strong></p>${actions[t.status] ? btn(actions[t.status], "task-next", t.id, true) : tag(t.status)}</div><div class="print-options"><article><strong>物流商官方原面单</strong><p>演练物流单无官方面单文件。</p><button class="action-button" disabled>未连接物流商</button></article><article><strong>演练包裹 / 转运标签</strong><p>标明 DEMO，仅用于流程演练。</p>${btn("预览演练标签", "print-label", t.id)}</article><article><strong>仓库拣货单</strong><p>核对 SKU、规格和数量，不自动推进状态。</p>${btn("预览拣货单", "print-picking", t.id)}</article></div></div>`,
          )
        : "")
    );
  }
  taskNext(id) {
    const t = this.data.tasks.find((t) => t.id === id);
    if (t.status === "待称重")
      this.dialogForm(
        "录入实际重量",
        fields(
          [field("weight", "重量(g)", "number", { min: 1, required: true })],
          t,
        ),
        (v) => {
          this.store.advanceTask(id, v);
          this.toast("称重完成");
        },
        "保存重量",
      );
    else if (t.status === "待打印")
      this.printDocument(t.orderId, "仓库拣货单", id);
    else if (t.status === "待交运")
      this.confirm(
        "确认交运",
        "确认该演练包裹已完成核对、称重和打印？确认后生成 Etsy 人工回填任务。",
        () => {
          this.store.advanceTask(id, { confirmed: true });
          this.toast("已交运，人工回填任务已生成");
        },
      );
    else {
      this.store.advanceTask(id);
      this.render();
      this.toast("任务状态已更新");
    }
  }
  printDocument(orderId, kind = "订单资料", taskId, template = {}) {
    const o = this.data.orders.find((o) => o.id === orderId);
    if (!o) return;
    const shipment = this.data.shipments.find(
      (s) => s.orderId === orderId && s.status !== "已取消",
    );
    const html = `<div id="printSheet" class="print-sheet"><div class="print-brand">上海哲誉实业有限公司 <small>EtsyShipping</small></div><h2>${esc(kind)}</h2><div class="demo-watermark">DEMO · 演练单据 · 不可用于真实寄递</div><p><strong>业务单号：</strong>${esc(o.number)}　<strong>平台单号：</strong>${esc(o.externalId)}</p><dl class="detail-grid"><dt>店铺</dt><dd>${esc(o.store)}</dd><dt>收件人</dt><dd>${esc(o.recipient)}</dd><dt>地址</dt><dd>${esc(o.address + " / " + o.city + " / " + o.postal + " / " + o.country)}</dd><dt>物流号</dt><dd>${esc(shipment?.tracking || "未制单")}</dd></dl>${table(["SKU", "商品名称", "规格 / 定制", "数量"], [`<tr><td>${esc(o.sku)}</td><td>${esc(o.product)}</td><td>${esc(o.variation || "—")}</td><td>${o.quantity}</td></tr>`])}<p>备注：${esc(o.notes || "—")}</p><p>打印日期：${date(now())}　操作人：${esc(this.actor)}</p><p class="print-footer">拣货核对 □　数量核对 □　包裹复核 □</p></div><div class="print-controls">${btn("打开系统打印", "system-print")}${taskId ? '<label class="check-label"><input type="checkbox" name="printed" required>已在系统打印对话框完成打印</label>' : ""}<p class="muted">浏览器无法知道打印是否成功；取消系统打印后请勿确认完成。</p></div>`;
    const printMeta = `<p class="muted">模板：${esc(template.name || kind)} · 版本：${esc(template.version || "1.0")} · 纸张偏好：${esc(template.paper || this.data.settings.paper)}（请在系统打印窗口选择相同纸张）</p>`;
    const printable = html.replace(
      '<p class="print-footer">',
      `<p>${esc(template.footer || "")}</p><p class="print-footer">`,
    );
    this.dialogForm(
      kind + "预览",
      printMeta + printable,
      taskId
        ? () => {
            this.store.advanceTask(taskId, { printed: true });
            this.toast("已确认打印，等待交运");
          }
        : null,
      "确认已打印",
      true,
    );
    queueMicrotask(() =>
      this.dialog
        .querySelector('[data-action="system-print"]')
        ?.addEventListener("click", () => {
          const area = document.querySelector("#printArea");
          area.innerHTML = printable
            .split('<div class="print-controls">')[0]
            .replace('id="printSheet"', "");
          window.print();
        }),
    );
  }
  tracking() {
    const rows = this.data.shipments.filter(
      (s) =>
        this.matches({
          ...s,
          ...this.data.orders.find((o) => o.id === s.orderId),
        }) &&
        (!this.filter || s.status === this.filter),
    );
    return (
      this.heading(
        "物流状态与异常",
        "查看演练物流单、记录人工轨迹和异常处理结果。",
      ) +
      this.panel(
        "物流订单",
        this.toolbar(
          `<label>物流状态<select id="statusFilter">${options(["", "待交运", "运输中", "运输异常", "已签收", "已取消"], this.filter)}</select></label>`,
        ) +
          table(
            [
              "业务单号",
              "物流商 / 渠道",
              "追踪号",
              "仓库",
              "物流状态",
              "最新物流信息",
              "操作",
            ],
            rows.map((s) => {
              const o = this.data.orders.find((o) => o.id === s.orderId);
              return `<tr><td>${esc(o?.number)}</td><td>${esc(s.provider)}<small>${esc(s.channel)}</small></td><td>${esc(s.tracking)}</td><td>${esc(s.warehouse)}</td><td>${tag(s.status)}</td><td>${esc(s.events[0]?.text || s.exception || "暂无轨迹")}</td><td>${btn("查看详情", "shipment", s.id)}</td></tr>`;
            }),
          ),
      )
    );
  }
  shipment(id) {
    const s = this.data.shipments.find((s) => s.id === id);
    if (!s) return;
    this.dialogForm(
      "物流详情 · " + s.tracking,
      `<dl class="detail-grid"><dt>物流商</dt><dd>${esc(s.provider)}</dd><dt>物流渠道</dt><dd>${esc(s.channel)}</dd><dt>状态</dt><dd>${tag(s.status)}</dd><dt>重量</dt><dd>${s.weight} g</dd></dl><div class="detail-actions">${btn("人工同步 / 处理异常", "tracking-event", id)}${btn("取消演练物流单", "cancel-shipment", id)}</div><p class="notice">本单未发送给物流商；轨迹由人工录入，自动同步需连接真实物流服务。</p><h3>物流轨迹</h3><ol class="timeline">${s.events.map((e) => `<li><strong>${esc(e.text)}</strong><span>${date(e.at)} · ${esc(e.location || "未填写位置")}</span></li>`).join("") || "<li>暂无物流事件</li>"}</ol>`,
      null,
      "",
      true,
    );
    this.bindDialogActions();
  }
  returns() {
    return (
      this.heading(
        "Etsy 人工回填",
        "复制追踪信息，在原订单平台完成填写后，再回到这里确认。",
      ) +
      `<div class="notice">不会自动写回 Etsy。演练追踪号不可填写到真实订单。</div>` +
      this.panel(
        "人工回填任务",
        table(
          [
            "业务单号 / 平台单号",
            "店铺",
            "承运商",
            "正确追踪号",
            "回填状态",
            "操作",
          ],
          this.data.returns.map((r) => {
            const o = this.data.orders.find((o) => o.id === r.orderId);
            const s = this.data.shipments.find((s) => s.id === r.shipmentId);
            return `<tr><td>${esc(o?.number)}<small>${esc(o?.externalId)}</small></td><td>${esc(o?.store)}</td><td>${esc(s?.provider)}</td><td>${esc(s?.tracking)}</td><td>${tag(r.status)}</td><td><div class="row-actions">${btn("复制资料", "copy-return", r.id)}${r.status === "待回填" ? btn("确认已人工填写", "confirm-return", r.id) : esc(r.actor)}</div></td></tr>`;
          }),
        ),
      )
    );
  }
  catalogPage() {
    const key = this.tab;
    return (
      this.heading(
        "业务设置",
        "维护店铺、仓库、物流方案、SKU、打印模板与价格。",
      ) +
      this.catalogTabs(
        ["stores", "warehouses", "presets", "skus", "templates", "prices"],
        key,
      ) +
      this.catalog(key)
    );
  }
  catalogTabs(keys, selected) {
    return `<nav class="subtabs" aria-label="资料分类">${keys.map((key) => `<button data-action="catalog" data-id="${key}" class="${selected === key ? "active" : ""}" aria-current="${selected === key ? "page" : "false"}">${esc(catalogs[key].title)}</button>`).join("")}</nav>`;
  }
  catalog(key) {
    const cfg = catalogs[key];
    const fs = cfg.fields.slice(0, 5);
    const rows = this.data[key].filter((r) => this.matches(r));
    return this.panel(
      cfg.title,
      (key === "stores"
        ? '<p class="notice">Etsy 授权状态：未连接。Shop ID 是配置记录，不代表已完成 OAuth 授权。</p>'
        : "") +
        this.toolbar() +
        table(
          [...fs.map((f) => esc(f.label)), "状态", "操作"],
          rows.map(
            (r) =>
              `<tr>${fs.map((f) => `<td>${esc(r[f.key] ?? "—")}</td>`).join("")}<td>${tag(r.enabled ? "启用" : "停用")}</td><td><div class="row-actions">${btn("编辑", "edit-catalog", key + ":" + r.id)}${btn(r.enabled ? "停用" : "启用", "toggle-catalog", key + ":" + r.id)}${key === "templates" ? btn("预览", "template-preview", r.id) : ""}</div></td></tr>`,
          ),
        ),
      btn("导出 CSV", "export-catalog", key) +
        (key === "prices" ? btn("导入价格", "import-prices") : "") +
        btn("新建" + cfg.singular, "new-catalog", key, true),
    );
  }
  catalogForm(key, id) {
    const cfg = catalogs[key];
    const row = this.data[key].find((r) => r.id === id);
    this.dialogForm(
      (row ? "编辑" : "新建") + cfg.singular,
      fields(cfg.fields, row || {}),
      (v) => {
        this.store.saveCatalog(key, v, id);
        this.toast("资料已保存");
      },
      "保存",
      true,
    );
  }
  auditTable(rows) {
    return table(
      ["时间", "操作人", "动作", "对象", "说明"],
      rows.map(
        (a) =>
          `<tr><td>${date(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td><td>${esc(a.detail || "—")}</td></tr>`,
      ),
    );
  }
  async openEtsyConfig() {
    if (!this.apiAdmin) throw new Error("此功能仅限服务端验证的站点管理员。");
    const data = await this.request("/api/bridge?route=admin-etsy-config");
    this.etsyConfigs = data.items;
    this.dialogForm("Etsy API 配置 · 仅管理员",
      `<p class="notice">配置与授权令牌在服务端加密保存。每家店先保存凭据，再点击官方授权。更换应用凭据需重新授权。请在 Etsy 应用中登记回调地址：<code>${esc(location.origin + "/etsy-callback.html")}</code></p>
      <div class="page-actions">${btn("添加店铺配置", "etsy-config-edit", "", true)}</div>` +
      table(["店铺 / Shop ID", "配置状态", "凭据", "最近修改", "操作"], this.etsyConfigs.map((row) =>
        `<tr><td>${esc(row.name)}<small>${esc(row.shopId)}</small></td><td>${tag(row.enabled ? "启用" : "停用")}<small>${esc(row.authorizationStatus)}</small></td><td>${row.hasCredentials ? "已保存（不回显）" : "未配置"}</td><td>${date(row.updatedAt)}<small>${esc(row.updatedBy)}</small></td><td>${btn("修改 / 停用", "etsy-config-edit", row.shopId)}${btn(row.authorized ? "重新授权" : "官方授权", "etsy-authorize", row.shopId)}</td></tr>`)),
      null, "", true);
    this.bindDialogActions();
  }
  editEtsyConfig(shopId) {
    if (!this.apiAdmin) throw new Error("此功能仅限服务端验证的站点管理员。");
    const row = this.etsyConfigs.find((r) => r.shopId === shopId);
    if (shopId && !row) throw new Error("请刷新配置列表后重试。");
    this.dialogForm(row ? "修改 Etsy API 配置" : "添加 Etsy 店铺配置",
      `<p class="notice">不要填写 Etsy 登录密码。应用 Keystring / Shared Secret 只发送到本站后台加密保存，不会回显。${row ? "不更换凭据时，两项密钥均留空；更换时两项同时填写并重新授权。" : "保存后请单独完成该店铺的官方授权。"}</p>` +
      fields([field("shopId", "Etsy Shop ID", "text", { required: true }),
        field("name", "店铺名称", "text", { required: true }),
        field("enabled", "配置状态（不代表同步已运行）", "select", { options: [["false", "停用"], ["true", "启用"]] })],
        row ? { ...row, enabled: String(row.enabled) } : { enabled: "false" }) +
      `<div class="form-grid"><div class="form-field"><label for="etsyKeystring">应用 Keystring</label><input id="etsyKeystring" name="keystring" type="password" autocomplete="new-password" maxlength="500" ${row ? "" : "required"}></div>
      <div class="form-field"><label for="etsySharedSecret">应用 Shared Secret</label><input id="etsySharedSecret" name="sharedSecret" type="password" autocomplete="new-password" maxlength="500" ${row ? "" : "required"}></div></div>`,
      async (values, form) => {
        try {
          await this.request("/api/bridge?route=admin-etsy-config", { method: "POST", body: JSON.stringify({
            shopId: row?.shopId || values.shopId.trim(), name: values.name, enabled: values.enabled === "true",
            revision: row?.revision || 0, keystring: values.keystring, sharedSecret: values.sharedSecret,
          }) });
          this.toast("API 配置已加密保存，请确认官方授权状态后同步");
          setTimeout(() => this.openEtsyConfig().catch((e) => this.toast(e.message)), 0);
        } finally {
          form.querySelector("#etsyKeystring").value = "";
          form.querySelector("#etsySharedSecret").value = "";
        }
      }, "加密保存", true);
    queueMicrotask(() => {
      if (row) this.dialog.querySelector("#field-shopId").readOnly = true;
    });
  }
  settings() {
    return (
      this.heading("连接与安全", "当前站点、原服务器与浏览器数据存储状态。") +
      this.panel(
        "当前连接",
        `<div class="panel-padding"><dl class="detail-grid"><dt>运行方式</dt><dd>Vercel / 浏览器工作台</dd><dt>当前账号</dt><dd>${esc(this.actor)}</dd><dt>当前模式</dt><dd>浏览器演练，数据仅保存本机</dd><dt>原生产服务器</dt><dd>${esc(this.meta?.upstream || "未配置")}</dd><dt>数据保存</dt><dd>订单与设置：localStorage；图片：IndexedDB</dd><dt>账号密码</dt><dd>由 Vercel 服务端验证，不保存到本机工作区</dd></dl><p class="notice">同一浏览器的演练数据由此站点的使用者共享；清除浏览器数据后会丢失，请定期导出备份。跨设备协作需接入数据库。</p><div class="page-actions">${btn("导出备份", "backup")}${btn("打印设置", "printer")}</div></div>`,
      )
    );
  }
  async change(e) {
    const input = e.target;
    try {
      if (input.id === "cloudSince") { this.cloud.since = input.value; return; }
      if (input.dataset.files) {
        await this.addFiles([...input.files], input.dataset.files);
        return;
      }
      if (input.id === "statusFilter") {
        this.filter = input.value;
        this.pageNumber = 1;
        this.render();
      }
      if (input.id === "storeFilter") {
        this.storeFilter = input.value;
        this.pageNumber = 1;
        this.render();
      }
      if (input.id === "countryFilter") {
        this.countryFilter = input.value;
        this.pageNumber = 1;
        this.render();
      }
      if (input.classList.contains("order-check")) {
        input.checked
          ? this.selected.add(input.value)
          : this.selected.delete(input.value);
        this.root.querySelector("#selectionCount").textContent =
          `已选 ${this.selected.size} 项`;
      }
      if (input.id === "selectAll") {
        this.root.querySelectorAll(".order-check").forEach((c) => {
          c.checked = input.checked;
          c.checked
            ? this.selected.add(c.value)
            : this.selected.delete(c.value);
        });
        this.root.querySelector("#selectionCount").textContent =
          `已选 ${this.selected.size} 项`;
      }
    } catch (err) {
      this.toast(err.message);
    }
  }
  async importCsv(key) {
    const isOrders = key === "orders";
    this.dialogForm(
      isOrders ? "CSV 导入订单" : "CSV 导入价格",
      `<p>请使用导出 / 模板中的英文字段名。文件上限 1 MB，最多 500 行。所有数据验证通过后一次保存。</p><input id="csvFile" name="csvFile" type="file" accept=".csv,text/csv" required><p class="muted">${isOrders ? "必须包含 store, recipient, country, city, postal, address, product, quantity, amount, currency。" : "必须包含 name, firstWeight, firstPrice, stepWeight, stepPrice, effective。"}</p>`,
      async (_v, form) => {
        const f = form.querySelector("#csvFile").files[0];
        if (f.size > 1024 * 1024) throw new Error("CSV 文件不能超过 1 MB。");
        const rows = csvParse(await f.text());
        if (!rows.length || rows.length > 500)
          throw new Error("请导入 1–500 行记录。");
        const memory = {
          value: JSON.stringify(this.data),
          getItem() {
            return this.value;
          },
          setItem(_k, v) {
            this.value = v;
          },
        };
        const sandbox = new WorkspaceStore(memory, this.actor);
        for (const row of rows) {
          if (isOrders) sandbox.saveOrder({ ...row, synthetic: true });
          else sandbox.saveCatalog(key, row);
        }
        this.store.commit(
          "批量 CSV 导入",
          `${rows.length} 条${isOrders ? "订单" : "价格"}`,
          (d) => {
            d[key] = sandbox.data[key];
          },
        );
        this.toast(`已导入 ${rows.length} 条记录`);
      },
      "验证并导入",
    );
  }
  async action(action, id, el) {
    if (action === "server-config-open") return openServerSetup(this);
    if (action === "cloud-open") return this.cloud.open();
    if (action.startsWith("cloud-")) return this.cloud.action(action.slice(6), id);
    switch (action) {
      case "etsy-authorize": {
        if (!this.apiAdmin) throw new Error("请重新登录管理员账号。");
        const data = await this.request("/api/bridge?route=etsy-authorize", { method: "POST", body: JSON.stringify({ shopId: id }) });
        const url = new URL(data.url);
        if (url.origin !== "https://www.etsy.com" || url.pathname !== "/oauth/connect") throw new Error("授权链接无效。");
        location.assign(url.href);
        break;
      }
      case "etsy-config-open":
        await this.openEtsyConfig();
        break;
      case "etsy-config-edit":
        this.editEtsyConfig(id);
        break;
      case "goto":
        document.querySelector(`[data-page="${id}"]`)?.click();
        break;
      case "new-order":
        this.orderForm();
        break;
      case "edit-order":
        this.orderForm(id);
        break;
      case "order":
        this.orderDetail(id);
        break;
      case "select":
        this.selection = id;
        this.render();
        break;
      case "filter":
        this.filter = id;
        this.render();
        break;
      case "prev-page":
        this.pageNumber = Math.max(1, this.pageNumber - 1);
        this.render();
        break;
      case "next-page":
        this.pageNumber = Math.min(Number(id), this.pageNumber + 1);
        this.render();
        break;
      case "export-orders":
        download(
          "订单.csv",
          csvEncode(
            this.data.orders.filter((o) => !o.archived),
            this.orderFields().map((f) => f.key),
          ),
          "text/csv;charset=utf-8",
        );
        break;
      case "export-selected":
        if (!this.selected.size) throw new Error("请先选择订单。");
        download(
          "选中订单.csv",
          csvEncode(
            this.data.orders.filter((o) => this.selected.has(o.id)),
            this.orderFields().map((f) => f.key),
          ),
          "text/csv;charset=utf-8",
        );
        break;
      case "bulk-review": {
        const rows = this.data.orders.filter((o) => this.selected.has(o.id));
        if (!rows.length) throw new Error("请先选择订单。");
        if (
          rows.some(
            (o) =>
              o.status !== "待复核" ||
              !this.data.skus.some((s) => s.enabled && s.code === o.sku),
          )
        )
          throw new Error(
            "批量复核要求所有选中订单处于待复核状态且已绑定有效 SKU。",
          );
        this.confirm(
          "批量复核",
          `确认已逐笔核对所选 ${rows.length} 笔订单的收件、商品和申报资料？`,
          () => {
            this.store.commit("批量复核", `${rows.length} 笔订单`, (d) => {
              d.orders
                .filter((o) => this.selected.has(o.id))
                .forEach((o) => {
                  o.status = "待选物流";
                  o.updatedAt = now();
                });
            });
            this.selected.clear();
            this.toast("批量复核完成");
          },
        );
        break;
      }
      case "archive-order":
        this.dialogForm(
          "归档错误订单",
          fields([field("reason", "归档原因", "textarea", { required: true })]),
          (v) => {
            this.store.archiveOrder(id, v.reason);
            this.toast("订单已归档，历史记录保留");
          },
          "确认归档",
        );
        break;
      case "shipping-draft":
        this.shippingDraft(id);
        break;
      case "task-next":
        this.taskNext(id);
        break;
      case "scan":
        this.dialogForm(
          "扫描 / 输入任务号",
          fields([
            field("code", "任务号或业务单号", "text", { required: true }),
          ]),
          (v) => {
            const t = this.data.tasks.find(
              (t) =>
                t.id === v.code.trim() ||
                this.data.orders.find((o) => o.id === t.orderId)?.number ===
                  v.code.trim(),
            );
            if (!t) throw new Error("未找到任务，请核对编号。");
            this.query = "";
            this.filter = "";
            this.selection = t.id;
            this.toast("已定位任务");
          },
          "查找任务",
        );
        break;
      case "print-order":
        this.printDocument(id);
        break;
      case "print-picking":
      case "print-label": {
        const t = this.data.tasks.find((t) => t.id === id);
        this.printDocument(
          t.orderId,
          action === "print-picking" ? "仓库拣货单" : "演练包裹标签",
        );
        break;
      }
      case "template-preview": {
        const t = this.data.templates.find((t) => t.id === id);
        const o = this.data.orders[0];
        if (!o) throw new Error("请先创建一笔订单用于预览。");
        this.printDocument(o.id, t.kind, undefined, t);
        break;
      }
      case "printer":
        this.dialogForm(
          "打印机与纸张设置",
          `<p>具体打印机由系统打印对话框选择。下列名称用于记录工作区默认偏好。</p>${fields([field("printer", "默认打印机备注"), field("paper", "纸张", "select", { options: ["A4", "100×150mm", "100×100mm"] })], this.data.settings)}`,
          (v) => {
            this.store.commit("保存打印偏好", "打印设置", (d) =>
              Object.assign(d.settings, v),
            );
            this.toast("打印偏好已保存");
          },
        );
        break;
      case "shipment":
        this.shipment(id);
        break;
      case "tracking-event":
        this.dialogForm(
          "人工轨迹 / 异常处理",
          `<p class="notice">记录人工事件，不冒充物流商自动同步。</p>${fields([field("status", "物流状态", "select", { options: ["运输中", "运输异常", "已签收"] }), field("location", "当前位置"), field("text", "事件内容 / 处理结果", "textarea", { required: true })])}`,
          (v) => {
            this.store.tracking(id, v);
            this.toast("物流事件已记录");
          },
          "记录事件",
        );
        break;
      case "cancel-shipment":
        this.dialogForm(
          "取消演练物流单",
          `<p>仅取消当前演练记录；取消后订单返回待选择物流。</p>${fields([field("reason", "取消原因", "textarea", { required: true })])}`,
          (v) => {
            this.store.cancelShipment(id, v.reason);
            this.toast("演练物流单已取消");
          },
          "确认取消",
        );
        break;
      case "copy-return": {
        const r = this.data.returns.find((r) => r.id === id);
        const o = this.data.orders.find((o) => o.id === r.orderId);
        const s = this.data.shipments.find((s) => s.id === r.shipmentId);
        const text = `演练资料，不可填入真实订单\n平台订单：${o.externalId}\n承运商：${s.provider}\n追踪号：${s.tracking}`;
        try {
          await navigator.clipboard.writeText(text);
          this.toast("演练回填资料已复制");
        } catch {
          this.dialogForm(
            "复制回填资料",
            `<textarea readonly rows="6">${esc(text)}</textarea>`,
            null,
          );
        }
        break;
      }
      case "confirm-return":
        this.confirm(
          "确认人工回填",
          "确认已在演练流程中核对并填写追踪资料？此操作不会请求 Etsy API。",
          () => {
            this.store.confirmReturn(id);
            this.toast("已记录人工回填");
          },
        );
        break;
      case "catalog":
        this.tab = id;
        this.query = "";
        this.page = "master";
        this.render();
        break;
      case "new-catalog":
        this.catalogForm(id);
        break;
      case "edit-catalog": {
        const [key, rowId] = id.split(":");
        this.catalogForm(key, rowId);
        break;
      }
      case "toggle-catalog": {
        const [key, rowId] = id.split(":");
        this.confirm(
          "切换启用状态",
          "停用后，新建业务的选项将不再包含该资料，历史记录保留。",
          () => {
            this.store.toggleCatalog(key, rowId);
            this.toast("资料状态已更新");
          },
        );
        break;
      }
      case "export-catalog":
        download(
          id + ".csv",
          csvEncode(
            this.data[id],
            catalogs[id].fields.map((f) => f.key),
          ),
          "text/csv;charset=utf-8",
        );
        break;
      case "backup":
        download(
          "EtsyShipping-备份-" + now().slice(0, 10) + ".json",
          JSON.stringify(this.data, null, 2),
          "application/json",
        );
        break;
      case "download-order-template":
        download(
          ORDER_TEMPLATE_FILENAME,
          csvEncode([ORDER_TEMPLATE_EXAMPLE], ORDER_CSV_COLUMNS),
          "text/csv;charset=utf-8",
        );
        break;
      case "import-orders":
        await this.importCsv("orders");
        break;
      case "import-prices":
        await this.importCsv("prices");
        break;
      case "parse-text":
        this.dialogForm(
          "从订单文本提取字段",
          `<p>按“字段：内容”逐行粘贴。支持收件人、国家、城市、邮编、地址、商品、SKU、数量、金额、店铺和订单号。使用规则提取，不是 AI 识别。</p>${fields([field("text", "订单文本", "textarea", { required: true })])}`,
          (v) => {
            const map = {
              收件人: "recipient",
              国家: "country",
              城市: "city",
              邮编: "postal",
              地址: "address",
              商品: "product",
              SKU: "sku",
              数量: "quantity",
              金额: "amount",
              店铺: "store",
              订单号: "externalId",
              币种: "currency",
            };
            const initial = {};
            for (const line of v.text.split("\n")) {
              const m = line.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
              if (m && Object.hasOwn(map, m[1].trim()))
                initial[map[m[1].trim()]] = m[2].trim();
            }
            if (!Object.keys(initial).length)
              throw new Error("未找到可提取字段，请使用“收件人：张三”格式。");
            setTimeout(() => this.orderForm(null, initial), 0);
          },
          "提取并人工复核",
        );
        break;
      case "preview-file":
      case "view-file":
        await this.viewFile(id);
        break;
      case "remove-file":
        this.attachments = this.attachments.filter((a) => a.id !== id);
        this.render();
        break;
      case "customer-report": {
        const totals = new Map();
        this.data.orders
          .filter((o) => !o.archived)
          .forEach((o) => {
            const key = o.recipient + " / " + o.country;
            totals.set(key, (totals.get(key) || 0) + 1);
          });
        this.dialogForm(
          "客户看板",
          table(
            ["客户 / 国家", "订单数"],
            [...totals].map(
              ([name, count]) =>
                `<tr><td>${esc(name)}</td><td>${count}</td></tr>`,
            ),
          ),
          null,
          "",
          true,
        );
        break;
      }
      default:
        throw new Error("操作不可用，请刷新后重试。");
    }
  }
}
