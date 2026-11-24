const query = new URLSearchParams(location.search);
history.replaceState(null, "", location.pathname); // Do not retain authorization codes in browser history.
const status = document.querySelector("#oauthStatus");
try {
  if (query.has("error")) throw new Error("你未完成 Etsy 授权，现有配置未改变。可以返回工作台重新授权。");
  if (query.getAll("state").length !== 1 || query.getAll("code").length !== 1) throw new Error("授权回调缺少参数，请返回工作台重新授权。");
  // This same-origin POST includes the Strict admin cookie after the cross-site navigation.
  const response = await fetch("/api/bridge?route=etsy-callback", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Admin-Action": "1" },
    body: JSON.stringify({ state: query.get("state"), code: query.get("code") }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "授权保存失败，请重新登录并发起授权。");
  status.textContent = `${data.name}（${data.shopId}）已授权。返回工作台后即可一键同步订单。`;
} catch (error) { status.setAttribute("role", "alert"); status.textContent = error.message; }
