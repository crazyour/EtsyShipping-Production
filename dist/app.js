const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  loginView: $("#loginView"), appView: $("#appView"), loginForm: $("#loginForm"),
  userName: $("#userName"), password: $("#password"), showPassword: $("#showPassword"),
  loginButton: $("#loginButton"), loginError: $("#loginError"), demoButton: $("#demoButton"),
  demoDivider: $("#demoDivider"), demoCredential: $("#demoCredential"),
  serverBadge: $("#serverBadge"), connectionText: $("#connectionText"), pageContent: $("#pageContent"),
  mainNav: $("#mainNav"), mobileNav: $("#mobileNav"), refreshButton: $("#refreshButton"),
  logoutButton: $("#logoutButton"), settingsButton: $("#settingsButton"), menuButton: $("#menuButton"),
  sidebar: $(".sidebar"), currentUser: $("#currentUser"), currentRole: $("#currentRole"),
  userInitial: $("#userInitial"), toast: $("#toast"), passwordDialog: $("#passwordDialog"),
  passwordForm: $("#passwordForm"), currentPassword: $("#currentPassword"), newPassword: $("#newPassword"),
  confirmPassword: $("#confirmPassword"), passwordError: $("#passwordError"),
  changePasswordButton: $("#changePasswordButton")
};

const state = {
  mode: "demo",
  demoUserName: "演示用户",
  page: "dashboard",
  token: sessionStorage.getItem("etsy.accessToken") || "",
  userName: sessionStorage.getItem("etsy.userName") || "",
  roles: (() => { try { const roles = JSON.parse(sessionStorage.getItem("etsy.roles") || "[]"); return Array.isArray(roles) ? roles : []; } catch { return []; } })(),
  meta: { upstream: "https://shipping.sunfacework.com", profile: "production", clientVersion: "3.0.2", demoEnabled: false },
  online: false,
  loading: false,
  live: { dashboard: null, orders: null, warehouse: null, exceptions: null, users: null }
};

const demo = {
  orders: [
    { businessNumber: "HM-261123-0142", storeName: "Hana Metal", recipientName: "Emma R.", destinationCountry: "US", productSummary: "Brass bookmark × 2", state: "待复核", currentHandler: "林晓", updated: "10:42" },
    { businessNumber: "HM-261123-0139", storeName: "Hana Metal", recipientName: "Luca B.", destinationCountry: "IT", productSummary: "Custom name plate × 1", state: "待选物流", currentHandler: "王宁", updated: "10:26" },
    { businessNumber: "MN-261123-0087", storeName: "Moon Needle", recipientName: "Olivia T.", destinationCountry: "GB", productSummary: "Embroidery kit × 1", state: "仓库处理中", currentHandler: "东京仓", updated: "09:58" },
    { businessNumber: "HM-261122-0134", storeName: "Hana Metal", recipientName: "Noah S.", destinationCountry: "CA", productSummary: "Metal luggage tag × 3", state: "已发货", currentHandler: "云途", updated: "昨天" }
  ],
  warehouse: [
    { taskNo: "WH-261123-031", order: "HM-261123-0136", product: "Brass bookmark", qty: 2, warehouse: "东京仓", status: "待拣货", owner: "未领取" },
    { taskNo: "WH-261123-029", order: "MN-261123-0087", product: "Embroidery kit", qty: 1, warehouse: "东京仓", status: "待打印", owner: "田中" },
    { taskNo: "WH-261123-024", order: "HM-261123-0128", product: "Metal luggage tag", qty: 4, warehouse: "上海仓", status: "待交运", owner: "陈凯" }
  ],
  exceptions: [
    { order: "HM-261118-0107", provider: "YunExpress", tracking: "YT••••4831", status: "运输停滞", location: "Los Angeles, US", updated: "14 小时前", level: "bad" },
    { order: "HM-261120-0121", provider: "SF IECS", tracking: "SF••••9027", status: "尾程待确认", location: "Vancouver, CA", updated: "3 小时前", level: "warn" },
    { order: "MN-261116-0069", provider: "Yanwen", tracking: "YW••••1760", status: "地址异常", location: "London, GB", updated: "1 天前", level: "bad" }
  ]
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function pick(object, ...keys) {
  if (!object) return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
    const pascal = key[0].toUpperCase() + key.slice(1);
    if (object[pascal] !== undefined && object[pascal] !== null) return object[pascal];
  }
}

function asArray(value, depth = 0) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || depth >= 3) return [];
  for (const key of ["items", "rows", "data", "orders", "tasks", "results"]) {
    const nested = pick(value, key);
    if (Array.isArray(nested)) return nested;
    if (nested && typeof nested === "object") {
      const rows = asArray(nested, depth + 1);
      if (rows.length) return rows;
    }
  }
  return [];
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.detail || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function checkServer() {
  try {
    state.meta = await request("/api/bridge?route=meta");
    const demoEnabled = state.meta.demoEnabled === true;
    elements.demoDivider.hidden = !demoEnabled;
    elements.demoButton.hidden = !demoEnabled;
    elements.demoCredential.hidden = !demoEnabled;
    await request("/api/bridge?route=runtime");
    state.online = true;
    elements.serverBadge.className = "server-badge online";
    elements.serverBadge.innerHTML = "<span></span>服务器在线";
    elements.connectionText.textContent = "服务器在线";
  } catch {
    state.online = false;
    elements.serverBadge.className = "server-badge offline";
    elements.serverBadge.innerHTML = "<span></span>服务器离线";
    elements.connectionText.textContent = "服务器暂不可用";
  }
}

function saveSession(data) {
  state.token = pick(data, "accessToken") || "";
  state.userName = pick(data, "userName") || elements.userName.value.trim();
  state.roles = Array.isArray(pick(data, "roles")) ? pick(data, "roles") : [];
  sessionStorage.setItem("etsy.accessToken", state.token);
  sessionStorage.removeItem("etsy.refreshToken");
  sessionStorage.setItem("etsy.userName", state.userName);
  sessionStorage.setItem("etsy.roles", JSON.stringify(state.roles));
}

function clearSession() {
  ["etsy.accessToken", "etsy.refreshToken", "etsy.userName", "etsy.roles"].forEach((key) => sessionStorage.removeItem(key));
  state.token = ""; state.userName = ""; state.roles = [];
}

function enterApp(mode) {
  state.mode = mode;
  elements.loginView.hidden = true;
  elements.appView.hidden = false;
  const name = mode === "demo" ? state.demoUserName : state.userName;
  elements.currentUser.textContent = name;
  elements.userInitial.textContent = name.slice(0, 1).toUpperCase();
  elements.currentRole.textContent = mode === "demo" ? (name === "admin" ? "本地演示管理员 · 不写入生产" : "演示模式 · 不写入生产") : (state.roles.join(" / ") || "生产用户");
  showPage("dashboard");
  if (mode === "live") loadLiveData();
}

function leaveApp() {
  clearSession();
  state.mode = "demo";
  state.live = { dashboard: null, orders: null, warehouse: null, exceptions: null, users: null };
  elements.appView.hidden = true;
  elements.loginView.hidden = false;
  elements.password.value = "";
  elements.loginError.hidden = true;
  checkServer();
}

async function login(event) {
  event.preventDefault();
  const userName = elements.userName.value.trim();
  const password = elements.password.value;
  elements.loginError.hidden = true;
  if (!userName || !password) {
    elements.loginError.textContent = "请输入用户名和密码。";
    elements.loginError.hidden = false;
    return;
  }
  if (state.meta.demoEnabled === true && userName === "admin" && password === "admin") {
    state.demoUserName = "admin";
    elements.password.value = "";
    enterApp("demo");
    toast("已进入本地演示管理员工作台，不会写入生产数据。");
    return;
  }
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "正在登录…";
  try {
    const data = await request("/api/bridge?route=login", { method: "POST", body: JSON.stringify({ userName, password }) });
    if (!pick(data, "accessToken")) throw new Error("服务器登录响应缺少令牌，请联系管理员检查接口。");
    saveSession(data);
    if (pick(data, "mustChangePassword")) {
      elements.currentPassword.value = password;
      elements.password.value = "";
      elements.passwordDialog.showModal();
    } else {
      elements.password.value = "";
      enterApp("live");
    }
  } catch (error) {
    elements.loginError.textContent = error.message;
    elements.loginError.hidden = false;
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = "登录";
  }
}

async function changePassword(event) {
  event.preventDefault();
  elements.passwordError.hidden = true;
  if (!elements.currentPassword.value || !elements.newPassword.value) {
    elements.passwordError.textContent = "当前密码和新密码不能为空。";
    elements.passwordError.hidden = false;
    return;
  }
  if (elements.newPassword.value !== elements.confirmPassword.value) {
    elements.passwordError.textContent = "两次输入的新密码不一致。";
    elements.passwordError.hidden = false;
    return;
  }
  try {
    await request("/api/bridge?route=change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: elements.currentPassword.value, newPassword: elements.newPassword.value })
    });
    elements.passwordDialog.close();
    clearSession();
    elements.password.value = "";
    elements.currentPassword.value = "";
    elements.newPassword.value = "";
    elements.confirmPassword.value = "";
    toast("密码已修改，请使用新密码重新登录。");
  } catch (error) {
    elements.passwordError.textContent = error.message;
    elements.passwordError.hidden = false;
  }
}

async function loadLiveData() {
  state.loading = true;
  renderCurrentPage();
  let expired = false;
  const jobs = [
    ["dashboard", "/api/bridge?route=dashboard&range=Today"],
    ["orders", "/api/bridge?route=orders&page=1&pageSize=100"],
    ["warehouse", "/api/bridge?route=warehouse"],
    ["exceptions", "/api/bridge?route=exceptions&page=1&pageSize=100"]
  ];
  await Promise.all(jobs.map(async ([key, path]) => {
    try { state.live[key] = await request(path); }
    catch (error) {
      if (error.status === 401) expired = true;
      state.live[key] = { error: error.message };
    }
  }));
  state.loading = false;
  if (expired) {
    leaveApp();
    elements.loginError.textContent = "登录已失效，请重新登录。";
    elements.loginError.hidden = false;
    return;
  }
  renderCurrentPage();
}

function pageHeading(title, description, actions = "") {
  return `<header class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
}

function liveError(data) {
  if (!data?.error) return "";
  return `<div class="empty-state"><strong>暂时无法读取生产数据</strong><p>${escapeHtml(data.error)} 页面结构仍可使用，服务器恢复后点击刷新即可。</p></div>`;
}

function statusTag(value) {
  const text = String(value || "未知");
  const tone = /完成|发货|签收|正常|ready|delivered|complete/i.test(text) ? "good" : /异常|失败|取消|超时|error|cancel/i.test(text) ? "bad" : /待|处理中|pending|review/i.test(text) ? "warn" : "";
  return `<span class="tag ${tone}">${escapeHtml(text)}</span>`;
}

function renderDashboard() {
  const live = state.mode === "live" ? state.live.dashboard : null;
  if (state.mode === "live" && live?.error) return pageHeading("今日总览", "先看需要处理的订单、物流和仓库事项。") + `<section class="section">${liveError(live)}</section>`;
  const metrics = pick(live, "metrics") || {};
  const count = (key, demoValue) => escapeHtml(pick(metrics, key) ?? (state.mode === "demo" ? demoValue : "—"));
  const orderCount = escapeHtml(pick(live, "orderCount") ?? (state.mode === "demo" ? 38 : "—"));
  const money = (key, demoValue) => {
    const value = pick(live, key) ?? (state.mode === "demo" ? demoValue : null);
    return value === null ? "—" : `¥${escapeHtml(value)}`;
  };
  return `${pageHeading("今日总览", "先处理阻塞项，再推进发货和仓库任务。", `<button class="action-button" data-action="install">添加到 Dock</button><button class="action-button primary" data-page="orders">处理订单</button>`)}
    <section class="attention-strip" aria-label="今日待处理">
      <div class="attention-lead"><strong>今天需要你关注</strong><span>${state.mode === "demo" ? "演示数据不会写入生产系统" : "数据来自当前账号授权范围"}</span></div>
      <div class="attention-item warn"><strong>${count("pendingReviewCount", 7)}</strong><span>订单待复核</span></div>
      <div class="attention-item"><strong>${count("pendingShippingCount", 5)}</strong><span>待确认物流</span></div>
      <div class="attention-item"><strong>${count("warehousePendingCount", 9)}</strong><span>仓库待处理</span></div>
      <div class="attention-item danger"><strong>${count("exceptionCount", 3)}</strong><span>物流异常</span></div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>今日经营概览</h2><p>订单与履约数据分开显示</p></div><span class="tag ${state.mode === "demo" ? "warn" : "good"}">${state.mode === "demo" ? "演示" : "实时"}</span></div>
      <div class="metric-row">
        <div class="metric"><span>订单数量</span><strong>${orderCount}</strong><small>当前授权范围</small></div>
        <div class="metric"><span>已完成发货</span><strong>${count("shippedOrderCount", 24)}</strong><small>不含已取消订单</small></div>
        <div class="metric"><span>今日订单金额</span><strong>${money("orderGrossCny", "6,842")}</strong><small>非结算收入</small></div>
        <div class="metric"><span>实际物流费用</span><strong>${money("actualFreightCny", "1,126")}</strong><small>已回填费用</small></div>
      </div>
    </section>
    ${state.mode === "live" && state.live.orders?.error
      ? `<section class="section">${liveError(state.live.orders)}</section>`
      : ordersSection("最近更新的订单", currentOrders().slice(0, 5))}`;
}

function currentOrders() {
  if (state.mode === "demo") return demo.orders;
  return asArray(state.live.orders).map((item) => ({
    businessNumber: pick(item, "businessNumber", "externalOrderId", "id"),
    storeName: pick(item, "storeName", "storeCode"), recipientName: pick(item, "recipientName"),
    destinationCountry: pick(item, "destinationCountry"), productSummary: pick(item, "productSummary"),
    state: pick(item, "state"), currentHandler: pick(item, "currentHandler"),
    updated: formatDate(pick(item, "lastUpdatedAt", "createdAt"))
  }));
}

function ordersSection(title, rows) {
  if (!rows.length) return `<section class="section"><div class="section-head"><h2>${escapeHtml(title)}</h2></div><div class="empty-state"><strong>没有符合条件的订单</strong><p>调整筛选条件，或在服务器恢复后刷新。</p></div></section>`;
  return `<section class="section"><div class="section-head"><div><h2>${escapeHtml(title)}</h2><p>双击原客户端中的详情操作，在网页版中改为明确按钮</p></div></div><div class="table-scroll"><table><thead><tr><th>业务编号</th><th>店铺 / 收件人</th><th>目的国</th><th>商品</th><th>状态</th><th>当前处理人</th><th>更新</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td class="order-id">${escapeHtml(row.businessNumber)}</td><td>${escapeHtml(row.storeName)}<br><span class="muted">${escapeHtml(row.recipientName || "—")}</span></td><td>${escapeHtml(row.destinationCountry || "—")}</td><td>${escapeHtml(row.productSummary || "—")}</td><td>${statusTag(row.state)}</td><td>${escapeHtml(row.currentHandler || "未分配")}</td><td class="muted">${escapeHtml(row.updated || "—")}</td><td><button class="row-button" data-action="readonly">查看</button></td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderOrders() {
  const liveErrorMarkup = state.mode === "live" ? liveError(state.live.orders) : "";
  return `${pageHeading("订单与复核", "上传资料、核对 AI 识别结果、绑定 SKU，并准备发货。", `<button class="action-button" data-action="readonly">手工创建订单</button><button class="action-button primary" data-action="readonly">上传订单资料</button>`)}
    <section class="section"><div class="toolbar"><input id="tableSearch" placeholder="搜索业务编号、店铺或收件人"><select id="statusFilter"><option value="">全部状态</option><option>待复核</option><option>待选物流</option><option>仓库处理中</option><option>已发货</option></select></div>${liveErrorMarkup || `<div id="ordersTableHost">${ordersTableOnly(currentOrders())}</div>`}</section>`;
}

function ordersTableOnly(rows) {
  if (!rows.length) return `<div class="empty-state"><strong>没有订单</strong><p>当前筛选条件下没有匹配结果。</p></div>`;
  return `<div class="table-scroll"><table><thead><tr><th>业务编号</th><th>店铺</th><th>收件人</th><th>目的国</th><th>商品</th><th>状态</th><th>处理人</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td class="order-id">${escapeHtml(row.businessNumber)}</td><td>${escapeHtml(row.storeName)}</td><td>${escapeHtml(row.recipientName || "—")}</td><td>${escapeHtml(row.destinationCountry || "—")}</td><td>${escapeHtml(row.productSummary || "—")}</td><td>${statusTag(row.state)}</td><td>${escapeHtml(row.currentHandler || "未分配")}</td><td><button class="row-button" data-action="readonly">查看详情</button></td></tr>`).join("")}</tbody></table></div>`;
}

function currentExceptions() {
  if (state.mode === "demo") return demo.exceptions;
  return asArray(state.live.exceptions).map((item) => ({
    order: pick(item, "externalOrderId", "customerReference"), provider: pick(item, "providerCode"),
    tracking: pick(item, "trackingNumber", "transferNumber"), status: pick(item, "unifiedStatus", "lastRawStatus"),
    location: pick(item, "lastLocation"), updated: formatDate(pick(item, "lastEventAt")), level: "warn"
  }));
}

function renderShipping() {
  const error = state.mode === "live" ? liveError(state.live.exceptions) : "";
  const rows = currentExceptions();
  return `${pageHeading("物流与异常", "跟踪运输状态，处理停滞、地址、尾程和取消问题。", `<button class="action-button" data-action="readonly">人工同步轨迹</button>`)}
    <section class="section"><div class="section-head"><div><h2>需要人工介入</h2><p>创建、取消真实物流单仍需在已验证流程中二次确认</p></div><span class="tag bad">${rows.length} 项</span></div>${error || `<div class="table-scroll"><table><thead><tr><th>订单</th><th>物流商</th><th>追踪号</th><th>异常</th><th>最后位置</th><th>最后更新</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td class="order-id">${escapeHtml(row.order)}</td><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.tracking || "—")}</td><td><span class="tag ${row.level}">${escapeHtml(row.status)}</span></td><td>${escapeHtml(row.location || "—")}</td><td class="muted">${escapeHtml(row.updated || "—")}</td><td><button class="row-button" data-action="readonly">处理</button></td></tr>`).join("")}</tbody></table></div>`}</section>`;
}

function currentWarehouse() {
  if (state.mode === "demo") return demo.warehouse;
  return asArray(state.live.warehouse).map((item) => ({
    taskNo: pick(item, "warehouseTaskNo", "id"), order: pick(item, "businessNumber", "externalOrderId"),
    product: pick(item, "productName", "sku"), qty: pick(item, "quantity"), warehouse: pick(item, "storeName", "warehouseId"),
    status: pick(item, "status"), owner: pick(item, "claimedByDisplay") || "未领取"
  }));
}

function renderWarehouse() {
  const error = state.mode === "live" ? liveError(state.live.warehouse) : "";
  const rows = currentWarehouse();
  return `${pageHeading("仓库与打印", "领取任务，完成拣货、打包、称重、打印和交运。", `<button class="action-button" data-action="readonly">打印机设置</button><button class="action-button primary" data-action="readonly">扫描任务号</button>`)}
    <section class="section"><div class="section-head"><div><h2>仓库任务</h2><p>网页可以预览单据；实体打印仍使用 Mac 系统打印对话框</p></div></div>${error || `<div class="table-scroll"><table><thead><tr><th>任务号</th><th>订单</th><th>商品</th><th>数量</th><th>仓库</th><th>状态</th><th>领取人</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td class="order-id">${escapeHtml(row.taskNo)}</td><td>${escapeHtml(row.order)}</td><td>${escapeHtml(row.product)}</td><td>${escapeHtml(row.qty)}</td><td>${escapeHtml(row.warehouse)}</td><td>${statusTag(row.status)}</td><td>${escapeHtml(row.owner)}</td><td><button class="row-button" data-action="readonly">处理任务</button></td></tr>`).join("")}</tbody></table></div>`}</section>`;
}

function moduleSection(title, subtitle, modules) {
  return `<section class="section"><div class="section-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></div><div class="module-list">${modules.map(([icon, name, description]) => `<article class="module"><div class="module-icon">${escapeHtml(icon)}</div><div><strong>${escapeHtml(name)}</strong><p>${escapeHtml(description)}</p></div><button data-action="readonly">打开</button></article>`).join("")}</div></section>`;
}

function renderMaster() {
  return pageHeading("基础资料", "集中维护发货过程中使用的稳定业务资料。") + moduleSection("业务基础资料", "修改只影响后续业务，历史订单事实不会重算。", [
    ["店", "店铺与 Etsy 授权", "店铺资料、负责人、默认仓库及 Etsy 授权状态。"],
    ["仓", "仓库与发件资料", "仓库代码、发件人、处理人员和授权范围。"],
    ["路", "物流方案与渠道", "物流商、渠道、账号、仓库的精确组合。"],
    ["货", "SKU 与申报模板", "商品资料、HS 编码、重量、价值和国家电话规则。"],
    ["签", "面单与打印模板", "纸张、模板版本、映射规则和默认打印配置。"],
    ["价", "价格版本", "物流报价版本、导入导出和生效记录。"]
  ]);
}

function renderAdmin() {
  return pageHeading("系统管理", "用户、权限、外部服务和生产安全门。") + moduleSection("管理入口", "高风险操作在服务端继续执行角色、范围和安全开关检查。", [
    ["人", "用户、角色与范围", "创建或停用用户，设置店铺与仓库范围，重置临时密码。"],
    ["密", "物流账号与凭据", "维护加密 Provider 凭据；Secret 永不回显。"],
    ["诊", "外部服务诊断", "检查 AI、物流 API、Etsy 与通知连接。"],
    ["态", "运行环境", "查看客户端、服务端、数据库版本和 Production 保护状态。"],
    ["审", "审计日志", "查看用户登录、关键配置和高风险业务操作。"],
    ["测", "测试数据维护", "仅对明确标记的 Synthetic 测试数据执行受控清理。"]
  ]);
}

function renderSettings() {
  return `${pageHeading("连接与安全", "网站只负责界面和安全转发，业务数据仍在原服务器。")}
    <section class="section"><div class="section-head"><h2>当前连接</h2></div><div class="connection-panel">
      <div><dl class="definition-list"><dt>运行方式</dt><dd>${state.meta.demoEnabled ? "Mac 本地网页" : "Vercel 网站"}</dd><dt>客户端兼容</dt><dd>${escapeHtml(state.meta.clientVersion)}</dd><dt>当前模式</dt><dd>${state.mode === "demo" ? "演示，不写入生产" : "真实生产账号"}</dd></dl></div>
      <div><dl class="definition-list"><dt>生产服务器</dt><dd>${escapeHtml(state.meta.upstream)}</dd><dt>连接状态</dt><dd>${state.online ? "在线" : "暂不可用"}</dd><dt>令牌存储</dt><dd>当前标签页 sessionStorage</dd></dl></div>
    </div></section>
    <section class="section"><div class="empty-state"><strong>需要管理员提供真实账号</strong><p>原安装包没有默认账号或密码。本网站不会保存密码，也不会绕过原服务端权限。</p></div></section>`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function renderCurrentPage() {
  if (state.loading && state.mode === "live") {
    elements.pageContent.innerHTML = pageHeading("正在读取工作台", "正在从生产服务器加载当前账号授权的数据。") + `<section class="section"><div class="empty-state"><strong>正在同步</strong><p>请保持页面开启。</p></div></section>`;
    return;
  }
  const renderers = { dashboard: renderDashboard, orders: renderOrders, shipping: renderShipping, warehouse: renderWarehouse, master: renderMaster, admin: renderAdmin, settings: renderSettings };
  elements.pageContent.innerHTML = (renderers[state.page] || renderDashboard)();
  elements.pageContent.focus({ preventScroll: true });
  bindPageActions();
}

function showPage(page) {
  state.page = page;
  $$('[data-page]').forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  elements.sidebar.classList.remove("open");
  elements.menuButton.setAttribute("aria-expanded", "false");
  renderCurrentPage();
}

function bindPageActions() {
  elements.pageContent.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
  elements.pageContent.querySelectorAll('[data-action="readonly"]').forEach((button) => button.addEventListener("click", () => {
    toast(state.mode === "demo" ? "演示模式不会执行生产操作。" : "第一版暂不开放高风险写操作；读取功能可正常连接。" );
  }));
  elements.pageContent.querySelectorAll('[data-action="install"]').forEach((button) => button.addEventListener("click", () => toast("在 Safari 中选择“文件 → 添加到程序坞”即可像应用一样打开。")));
  const search = $("#tableSearch");
  const filter = $("#statusFilter");
  const host = $("#ordersTableHost");
  if (search && filter && host) {
    const update = () => {
      const query = search.value.trim().toLowerCase();
      const status = filter.value;
      const rows = currentOrders().filter((row) => (!query || Object.values(row).join(" ").toLowerCase().includes(query)) && (!status || row.state === status));
      host.innerHTML = ordersTableOnly(rows);
      host.querySelectorAll('[data-action="readonly"]').forEach((button) => button.addEventListener("click", () => toast("订单详情写操作将在接口验证后开放。")));
    };
    search.addEventListener("input", update); filter.addEventListener("change", update);
  }
}

elements.loginForm.addEventListener("submit", login);
elements.demoButton.addEventListener("click", () => {
  if (state.meta.demoEnabled !== true) return;
  state.demoUserName = "演示用户";
  enterApp("demo");
});
elements.showPassword.addEventListener("click", () => {
  const visible = elements.password.type === "text";
  elements.password.type = visible ? "password" : "text";
  elements.showPassword.textContent = visible ? "显示" : "隐藏";
});
elements.passwordForm.addEventListener("submit", changePassword);
elements.passwordDialog.addEventListener("close", () => {
  if (elements.appView.hidden && state.token) clearSession();
  elements.currentPassword.value = "";
  elements.newPassword.value = "";
  elements.confirmPassword.value = "";
});
elements.mainNav.addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button) showPage(button.dataset.page); });
elements.mobileNav.addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button) showPage(button.dataset.page); });
elements.settingsButton.addEventListener("click", () => showPage("settings"));
elements.menuButton.addEventListener("click", () => {
  const open = elements.sidebar.classList.toggle("open");
  elements.menuButton.setAttribute("aria-expanded", String(open));
});
elements.refreshButton.addEventListener("click", async () => {
  await checkServer();
  if (state.mode === "live") await loadLiveData(); else renderCurrentPage();
  toast("工作台已刷新。");
});
elements.logoutButton.addEventListener("click", async () => {
  if (state.mode === "live" && state.token) request("/api/bridge?route=logout", { method: "POST", body: "{}" }).catch(() => {});
  leaveApp();
});

sessionStorage.removeItem("etsy.refreshToken");
checkServer();
if (state.token && state.userName) enterApp("live");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.filter((registration) => registration.active?.scriptURL === `${location.origin}/sw.js`)
      .map((registration) => registration.unregister()));
    if ("caches" in window) {
      const names = await caches.keys().catch(() => []);
      await Promise.all(names.filter((name) => name.startsWith("etsyshipping-")).map((name) => caches.delete(name)));
    }
  });
}
