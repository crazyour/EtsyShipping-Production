const DEFAULT_UPSTREAM = "https://shipping.sunfacework.com";
const routes = {
  runtime: { path: "/api/runtime/status", auth: false, params: [] },
  dashboard: { path: "/api/dashboard/overview", auth: true, params: ["range"] },
  orders: { path: "/api/orders", auth: true, params: ["page", "pageSize"] },
  warehouse: { path: "/api/warehouse/tasks", auth: true, params: [] },
  exceptions: { path: "/api/tracking/exceptions", auth: true, params: ["page", "pageSize"] },
  users: { path: "/api/users", auth: true, params: [] },
  stores: { path: "/api/stores", auth: true, params: [] },
  presets: { path: "/api/logistics/presets", auth: true, params: [] },
  channels: { path: "/api/logistics/channels", auth: true, params: [] }
};

function send(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function jsonBody(request) {
  if (request.body !== undefined) {
    if (typeof request.body === "object" && request.body !== null) return request.body;
    try { return JSON.parse(String(request.body)); } catch { return null; }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

function upstreamBase() {
  const configured = process.env.ETSY_SERVER_URL || DEFAULT_UPSTREAM;
  let url;
  try { url = new URL(configured); } catch { throw new Error("ETSY_SERVER_URL 无效"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("ETSY_SERVER_URL 必须是 HTTPS 服务器地址");
  }
  return url.origin + url.pathname.replace(/\/$/, "");
}

async function forward(request, response, path, { auth = true, body, params = [] } = {}) {
  const authorization = request.headers.authorization || "";
  if (auth && !/^Bearer [^\s]+$/.test(authorization)) {
    return send(response, 401, { error: "当前登录已失效，请重新登录。" });
  }

  const incoming = new URL(request.url || "/", "http://localhost");
  const query = new URLSearchParams();
  for (const param of params) {
    const value = incoming.searchParams.get(param);
    if (value !== null && value.length <= 100) query.set(param, value);
  }

  try {
    const url = `${upstreamBase()}${path}${query.size ? `?${query}` : ""}`;
    const upstream = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(auth ? { Authorization: authorization } : {}),
        "X-EtsyShipping-Client": "MacWeb/0.2"
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12_000)
    });
    const raw = await upstream.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { data = { error: upstream.ok ? "服务器返回了非 JSON 数据。" : `服务器返回 ${upstream.status}。` }; }
    return send(response, upstream.status, data);
  } catch (error) {
    return send(response, 502, {
      error: "无法连接生产服务器。请检查服务器状态或稍后重试。",
      detail: error?.name === "TimeoutError" ? "连接超时" : "上游服务不可用"
    });
  }
}

export default async function handler(request, response) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const route = url.searchParams.get("route");
    const method = request.method || "GET";
    if (route === "meta" && method === "GET") {
      return send(response, 200, {
        upstream: upstreamBase(), profile: "production", clientVersion: "3.0.2",
        demoEnabled: !process.env.VERCEL
      });
    }
    if (route === "login" && method === "POST") {
      const data = await jsonBody(request);
      const userName = typeof data?.userName === "string" ? data.userName.trim() : "";
      const password = typeof data?.password === "string" ? data.password : "";
      if (!userName || !password || userName.length > 100 || password.length > 500) {
        return send(response, 400, { error: "请输入有效的用户名和密码。" });
      }
      return forward(request, response, "/api/auth/login", {
        auth: false, body: { userName, password }
      });
    }
    if (route === "change-password" && method === "POST") {
      const data = await jsonBody(request);
      if (typeof data?.currentPassword !== "string" || typeof data?.newPassword !== "string" ||
          !data.currentPassword || !data.newPassword || data.currentPassword.length > 500 || data.newPassword.length > 500) {
        return send(response, 400, { error: "修改密码请求格式无效。" });
      }
      return forward(request, response, "/api/auth/change-password", {
        body: { currentPassword: data.currentPassword, newPassword: data.newPassword }
      });
    }
    if (route === "logout" && method === "POST") {
      return forward(request, response, "/api/auth/logout", { body: {} });
    }
    if (method === "GET" && Object.hasOwn(routes, route)) {
      const config = routes[route];
      return forward(request, response, config.path, config);
    }
    return send(response, 404, { error: "未知接口。" });
  } catch {
    return send(response, 500, { error: "服务配置无效或请求处理失败。" });
  }
}
