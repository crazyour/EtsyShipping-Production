import { WorkspaceUI, pages } from "./workspace.js";
const $ = (s) => document.querySelector(s);
const state = {
  meta: { demoEnabled: false },
  token: sessionStorage.getItem("etsy.accessToken") || "",
  user: sessionStorage.getItem("etsy.userName") || "",
  mode: "demo",
  page: "dashboard",
  workspace: null,
  live: {},
  liveLoading: false,
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj?.[k] ?? obj?.[k[0].toUpperCase() + k.slice(1)];
    if (v !== undefined && v !== null) return v;
  }
};
const array = (v) =>
  Array.isArray(v)
    ? v
    : pick(v, "items", "rows", "data", "orders", "tasks", "results") || [];
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(
      data.error || data.detail || `请求失败（${response.status}）`,
    );
    err.status = response.status;
    throw err;
  }
  return data;
}
async function checkServer() {
  try {
    state.meta = await request("/api/bridge?route=meta");
    for (const id of ["demoDivider", "demoButton", "demoCredential"])
      $("#" + id).hidden = !state.meta.demoEnabled;
    $("#serverBadge").textContent = "网页服务正常";
    $("#serverBadge").className = "server-badge online";
    try {
      await request("/api/bridge?route=runtime");
      $("#connectionText").textContent = "生产服务在线";
    } catch {
      $("#connectionText").textContent = "生产服务暂不可用";
    }
  } catch {
    $("#serverBadge").textContent = "网页连接失败";
    $("#serverBadge").className = "server-badge offline";
    $("#connectionText").textContent = "连接失败";
  }
}
function clearSession() {
  state.token = "";
  state.user = "";
  for (const k of [
    "etsy.accessToken",
    "etsy.refreshToken",
    "etsy.userName",
    "etsy.roles",
  ])
    sessionStorage.removeItem(k);
}
function enterApp(mode, user) {
  state.mode = mode;
  state.user = user;
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
  $("#currentUser").textContent = user;
  $("#userInitial").textContent = user.slice(0, 1).toUpperCase();
  $("#currentRole").textContent =
    mode === "demo" ? "网页演练管理员" : "生产账号 · 只读";
  $("#environmentLabel").textContent =
    mode === "demo" ? "WEB WORKSPACE" : "PRODUCTION";
  $("#modeNotice").textContent =
    mode === "demo"
      ? "演练工作区 · 数据保存在当前浏览器，未向生产系统提交"
      : "生产账号 · 原服务器数据；网页新增写入流程请在演练工作区使用";
  if (mode === "demo") {
    try {
      if (!state.workspace)
        state.workspace = new WorkspaceUI({
          root: $("#pageContent"),
          actor: user,
          toast,
          request,
          meta: state.meta,
        });
      state.workspace.actor = user;
      state.workspace.store.actor = user;
    } catch (e) {
      toast(e.message);
      $("#pageContent").innerHTML =
        `<div class="empty-state"><h2>无法读取本地工作区</h2><p>${esc(e.message)}</p></div>`;
      return;
    }
  }
  showPage("dashboard");
  if (mode === "live") loadLive();
}
function showPage(page) {
  state.page = page;
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === page);
    if (b.dataset.page === page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("#sidebar").classList.remove("open");
  $("#menuButton").setAttribute("aria-expanded", "false");
  $("#workspaceTitle").textContent = pages[page] || "工作台";
  if (state.mode === "demo") state.workspace?.navigate(page);
  else renderLive();
  $("#pageContent").focus({ preventScroll: true });
}
async function login(e) {
  e.preventDefault();
  const userName = $("#userName").value.trim(),
    password = $("#password").value;
  $("#loginError").hidden = true;
  if (!userName || !password) {
    $("#loginError").textContent = "请输入用户名和密码。";
    $("#loginError").hidden = false;
    return;
  }
  const button = $("#loginButton");
  button.disabled = true;
  button.textContent = "正在登录…";
  try {
    if (
      state.meta.demoEnabled &&
      userName === "admin" &&
      password === "admin"
    ) {
      clearSession();
      enterApp("demo", userName);
      return;
    }
    const data = await request("/api/bridge?route=login", {
      method: "POST",
      body: JSON.stringify({ userName, password }),
    });
    if (pick(data, "demoAccess")) {
      clearSession();
      enterApp("demo", pick(data, "userName") || userName);
      return;
    }
    state.token = pick(data, "accessToken");
    if (!state.token) throw new Error("登录响应缺少令牌。");
    state.user = pick(data, "userName") || userName;
    sessionStorage.setItem("etsy.accessToken", state.token);
    sessionStorage.setItem("etsy.userName", state.user);
    if (pick(data, "mustChangePassword")) {
      $("#currentPassword").value = password;
      $("#passwordDialog").showModal();
    } else enterApp("live", state.user);
  } catch (err) {
    $("#loginError").textContent = err.message;
    $("#loginError").hidden = false;
  } finally {
    $("#password").value = "";
    button.disabled = false;
    button.textContent = "登录工作台";
  }
}
async function loadLive() {
  state.liveLoading = true;
  renderLive();
  let expired = false;
  await Promise.all(
    ["dashboard", "orders", "warehouse", "exceptions"].map(async (route) => {
      try {
        state.live[route] = await request("/api/bridge?route=" + route);
      } catch (e) {
        if (e.status === 401) expired = true;
        state.live[route] = { error: e.message };
      }
    }),
  );
  state.liveLoading = false;
  if (expired) {
    leaveApp();
    toast("登录已失效，请重新登录");
    return;
  }
  renderLive();
}
function renderLive() {
  if (state.liveLoading) {
    $("#pageContent").innerHTML =
      '<div class="empty-state"><h2>正在读取生产数据…</h2></div>';
    return;
  }
  const route = {
    dashboard: "dashboard",
    orders: "orders",
    warehouse: "warehouse",
    tracking: "exceptions",
  }[state.page];
  let body = "";
  if (!route)
    body =
      '<div class="empty-state"><h2>该流程目前仅开放网页演练</h2><p>真实生产写入需要接通原服务器接口。退出后使用站点管理员账号，可操作完整的本地演练流程。</p></div>';
  else if (state.live[route]?.error)
    body = `<div class="empty-state"><h2>暂时无法读取生产数据</h2><p>${esc(state.live[route].error)}</p><p>服务器恢复后点击顶部刷新。</p></div>`;
  else if (route === "dashboard") {
    const d = state.live.dashboard || {};
    const m = pick(d, "metrics") || {};
    body = `<div class="metric-grid">${[
      ["订单数量", pick(d, "orderCount")],
      ["待复核", pick(m, "pendingReviewCount")],
      ["待发货", pick(m, "pendingShippingCount")],
      ["物流异常", pick(m, "exceptionCount")],
    ]
      .map(
        ([name, value]) =>
          `<div class="metric-card"><span>${name}</span><strong>${esc(value ?? "—")}</strong></div>`,
      )
      .join("")}</div>`;
  } else {
    const rows = array(state.live[route]);
    const defs =
      route === "orders"
        ? [
            ["业务单号", "businessNumber"],
            ["店铺", "storeName"],
            ["收件人", "recipientName"],
            ["国家", "destinationCountry"],
            ["商品", "productSummary"],
            ["状态", "state"],
          ]
        : route === "warehouse"
          ? [
              ["任务号", "warehouseTaskNo"],
              ["订单", "externalOrderId"],
              ["商品", "productName"],
              ["数量", "quantity"],
              ["状态", "status"],
            ]
          : [
              ["订单", "externalOrderId"],
              ["物流商", "providerCode"],
              ["追踪号", "trackingNumber"],
              ["状态", "unifiedStatus"],
              ["位置", "lastLocation"],
            ];
    body =
      Array.isArray(rows) && rows.length
        ? `<div class="table-scroll"><table><thead><tr>${defs.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${defs.map(([, k]) => `<td>${esc(pick(r, k) || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
        : '<div class="empty-state"><h2>暂无生产记录</h2></div>';
  }
  $("#pageContent").innerHTML =
    `<header class="page-heading"><div><h1>${esc(pages[state.page])}</h1><p>当前账号授权范围内的生产数据</p></div></header><section class="section">${body}</section>`;
}
function leaveApp() {
  clearSession();
  $("#appView").hidden = true;
  $("#loginView").hidden = false;
  $("#password").value = "";
  $("#loginError").hidden = true;
  checkServer();
}
$("#loginForm").addEventListener("submit", login);
$("#showPassword").addEventListener("click", () => {
  const show = $("#password").type === "password";
  $("#password").type = show ? "text" : "password";
  $("#showPassword").textContent = show ? "隐藏" : "显示";
});
$("#demoButton").addEventListener("click", () => {
  if (state.meta.demoEnabled) enterApp("demo", "admin");
});
document
  .querySelectorAll("[data-page]")
  .forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));
$("#menuButton").addEventListener("click", () => {
  const open = $("#sidebar").classList.toggle("open");
  $("#menuButton").setAttribute("aria-expanded", String(open));
});
$("#logoutButton").addEventListener("click", async () => {
  if (state.mode === "live")
    try {
      await request("/api/bridge?route=logout", { method: "POST", body: "{}" });
    } catch {}
  leaveApp();
});
$("#refreshButton").addEventListener("click", async () => {
  checkServer();
  if (state.mode === "live") loadLive();
  else {
    try {
      const { WorkspaceStore } = await import("./workspace-store.js");
      state.workspace.store = new WorkspaceStore(localStorage, state.user);
      state.workspace.render();
      toast("已刷新本地工作区");
    } catch (e) {
      toast(e.message);
    }
  }
});
$("#passwordClose").addEventListener("click", () =>
  $("#passwordDialog").close(),
);
$("#passwordDialog").addEventListener("close", () => {
  if ($("#appView").hidden) clearSession();
  $("#currentPassword").value = "";
  $("#newPassword").value = "";
  $("#confirmPassword").value = "";
});
$("#passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#passwordError").hidden = true;
  try {
    if (!$("#currentPassword").value || !$("#newPassword").value)
      throw new Error("请填写当前密码与新密码。");
    if ($("#newPassword").value !== $("#confirmPassword").value)
      throw new Error("两次新密码不一致。");
    await request("/api/bridge?route=change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: $("#currentPassword").value,
        newPassword: $("#newPassword").value,
      }),
    });
    $("#passwordDialog").close();
    clearSession();
    toast("密码已修改，请重新登录");
  } catch (err) {
    $("#passwordError").textContent = err.message;
    $("#passwordError").hidden = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("#sidebar").classList.remove("open");
    $("#menuButton").setAttribute("aria-expanded", "false");
  }
});
window.addEventListener("storage", (e) => {
  if (e.key === "etsyshipping.workspace.v1" && !$("#appView").hidden)
    toast("其他标签页已更新工作区，请点击刷新");
});
checkServer();
if (state.token && state.user) enterApp("live", state.user);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
