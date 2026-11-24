const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const definitions = [
  ["ETSY_CONFIG_ENCRYPTION_KEY", "API 凭据加密密钥", "password", "首次初始化可生成 32 字节随机密钥；先备份。恢复已有数据库时必须使用原密钥，不要生成新密钥。"],
  ["UPSTASH_REDIS_REST_URL", "Upstash REST URL", "url", "已创建数据库的 HTTPS REST 根地址，以 .upstash.io 结尾；这里不会创建数据库。"],
  ["UPSTASH_REDIS_REST_TOKEN", "Upstash REST Token", "password", "填写同一数据库的读写 Token，不是只读 Token；不要填写 Etsy 的 Token。"],
  ["SITE_PUBLIC_ORIGIN", "正式网站源地址", "url", "例如 https://etsyshipping.vercel.app，不带路径或尾部斜杠。"],
];

export function openServerSetup(w) {
  if (!w.serverConfigAdmin) throw new Error("请使用经过服务端验证的站点管理员账号登录。");
  const initial = w.serverConfig || { available: false, fields: {}, reason: "请重新登录，以读取服务器配置状态。" };
  w.dialogForm("服务器配置 · 仅管理员",
    `<p class="notice">此操作通过 Vercel 官方接口，仅新增当前项目的 Production 环境变量。已有配置不覆盖。Token 仅当次使用，不保存、不回显；填写前请确认正在访问你自己的正式网站。</p>
    <p>当前项目：<code>${esc(initial.projectId || "未识别")}</code> · Production</p>
    ${!initial.available ? `<p class="form-error" role="alert">${esc(initial.reason)}</p>` : ""}
    <div id="setupResult" role="status" aria-live="polite" tabindex="-1"></div>
    <div id="setupError" class="form-error" role="alert" tabindex="-1" hidden></div>
    <h3>1. 本次身份验证</h3>
    <div class="form-grid">
      <div class="form-field"><label for="setupUser">管理员账号</label><input id="setupUser" name="userName" value="${esc(w.actor)}" readonly autocomplete="username"></div>
      <div class="form-field"><label for="setupPassword">当前管理员密码</label><input id="setupPassword" name="password" type="password" required maxlength="500" autocomplete="off" aria-describedby="setupPasswordHelp"><small id="setupPasswordHelp">保存和检查都需重新验证；不是 Etsy 登录密码。</small></div>
      <div class="form-field span-2"><label for="setupToken">临时 Vercel Token</label><input id="setupToken" name="vercelToken" type="password" required minlength="10" maxlength="2048" autocomplete="off" aria-describedby="setupTokenHelp"><small id="setupTokenHelp">需要当前团队、项目的环境变量读写权限。提交完成后清空，不写入任何环境变量或浏览器存储。使用后可在 Vercel 撤销。</small><a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">打开 Vercel Token 管理</a></div>
    </div>
    <div class="page-actions"><button type="submit" name="setupAction" value="inspect" class="action-button" ${initial.available ? "" : "disabled"}>检查已保存配置</button></div>
    <h3>2. 补全缺失配置</h3><p class="muted">留空表示保持不变。「当前部署已配置」与「Vercel 已保存」不同；保存后需要重新部署。</p>
    <div class="form-grid">${definitions.map(([key, label, type, help]) => `<div class="form-field span-2"><label for="setup-${key}">${label}</label><small><code>${key}</code> · <span data-setup-state="${key}">${initial.fields[key] ? "当前部署已配置，不回显" : "当前部署未配置"}</span></small>
      <input id="setup-${key}" name="${key}" type="${type}" maxlength="4096" autocomplete="off" aria-describedby="help-${key}" ${initial.fields[key] ? "disabled" : ""}>
      <small id="help-${key}">${help}</small>${key === "ETSY_CONFIG_ENCRYPTION_KEY" ? `<div class="page-actions"><button type="button" id="setupGenerate" class="action-button" ${initial.fields[key] ? "disabled" : ""}>生成随机密钥</button><button type="button" id="setupCopy" class="action-button" ${initial.fields[key] ? "disabled" : ""}>复制密钥备份</button></div>` : ""}</div>`).join("")}</div>
    <label class="check-label"><input type="checkbox" id="setupConfirmed">我已备份填写的加密密钥，并确认将这些配置保存到当前项目的 Production 环境。</label>
    <div class="page-actions"><button type="submit" name="setupAction" value="save" class="action-button primary" ${initial.available ? "" : "disabled"}>保存到 Vercel（需重新部署）</button></div>
    <p class="muted">本页不修改管理员密码，不读取已保存的密钥，不自动部署。若已有配置错误，或需要更换数据库 / 加密密钥，请到 Vercel 进行有备份的迁移，勿删除后盲目重建。</p>
    <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">打开 Vercel 检查配置与重新部署</a>`, null, "", true);
  queueMicrotask(() => {
    const form = w.dialog.querySelector("#workForm");
    const secretInputs = () => form.querySelectorAll('input[type="password"]');
    const clearSecrets = () => secretInputs().forEach((input) => { input.value = ""; });
    // Also clears unsubmitted fields on close/logout. No storage API is used here.
    w.modalCleanup = clearSecrets;
    const summary = form.querySelector("#setupError"), result = form.querySelector("#setupResult");
    let busy = false;
    function error(message, field) {
      summary.replaceChildren(); summary.hidden = false;
      if (field) {
        const link = document.createElement("a"); link.href = `#${field.id}`; link.textContent = message;
        link.addEventListener("click", () => field.focus()); summary.append(link);
        field.setAttribute("aria-invalid", "true");
      } else summary.textContent = message;
      summary.focus();
    }
    form.addEventListener("input", (event) => event.target.removeAttribute("aria-invalid"));
    form.querySelector("#setupGenerate").addEventListener("click", () => {
      if (busy) return;
      const input = form.querySelector("#setup-ETSY_CONFIG_ENCRYPTION_KEY");
      if (input.disabled) return;
      if (input.value) { error("加密密钥已有内容，未覆盖。请先确认备份；如确需生成新密钥，请清空此字段。", input); return; }
      input.value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      result.textContent = "已生成随机密钥，仅暂存在当前表单。请先复制并安全备份，再保存。";
      form.querySelector("#setupConfirmed").checked = false;
    });
    form.querySelector("#setupCopy").addEventListener("click", async () => {
      const input = form.querySelector("#setup-ETSY_CONFIG_ENCRYPTION_KEY");
      if (busy || input.disabled) return;
      if (!input.value) { error("请先填写或生成密钥。", input); return; }
      try { await navigator.clipboard.writeText(input.value); result.textContent = "密钥已复制，请粘贴到安全的密码管理器中备份，不要发到聊天里。"; }
      catch { error("无法访问剪贴板，请在此字段手动选择并复制密钥。", input); }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !initial.available || !w.serverConfigAdmin) return;
      const action = event.submitter?.value;
      if (!["inspect", "save"].includes(action)) return;
      summary.hidden = true;
      const confirmed = form.querySelector("#setupConfirmed");
      if (action === "save" && !confirmed.checked) { error("请确认密钥备份及保存目标。", confirmed); return; }
      const data = Object.fromEntries(new FormData(form));
      const values = Object.fromEntries(definitions.map(([key]) => [key, data[key] || ""]));
      if (action === "save" && !Object.values(values).some(Boolean)) { error("请至少填写一项尚未配置的变量。"); return; }
      const token = form.querySelector("#setupToken");
      if (/\s/.test(data.vercelToken)) { error("Vercel Token 不能包含空格或换行。", token); return; }
      busy = true;
      const buttons = [...form.querySelectorAll("button")];
      const previousDisabled = buttons.map((b) => b.disabled);
      buttons.forEach((b) => { b.disabled = true; });
      const preventClose = (e) => e.preventDefault();
      w.dialog.addEventListener("cancel", preventClose);
      result.textContent = action === "save" ? "正在验证权限并保存，请勿重复提交…" : "正在检查 Vercel 配置…";
      let reply;
      try {
        reply = await w.request("/api/bridge?route=admin-server-config", { method: "POST", body: JSON.stringify({
          userName: w.actor, password: data.password, vercelToken: data.vercelToken, action,
          ...(action === "save" ? { values, confirmed: true } : {}),
        }) });
        if (!w.serverConfigAdmin || !form.isConnected) return;
        result.textContent = reply.message;
        for (const [key] of definitions) {
          const state = reply.fields?.[key]; if (!state) continue;
          form.querySelector(`[data-setup-state="${key}"]`).textContent = state.active ? "当前部署已配置，不回显" : state.saved ? "Vercel 已保存，等待重新部署" : "尚未配置";
          const input = form.querySelector(`#setup-${key}`);
          if (state.active || state.saved) { input.value = ""; input.disabled = true; }
        }
        if (!reply.ok) error(reply.message);
        else result.focus();
      } catch (e) {
        if (w.serverConfigAdmin && form.isConnected) { result.textContent = ""; error(e.message); }
      } finally {
        // Never retain the transient Vercel token or current password, even after a failed request.
        form.querySelector("#setupPassword").value = ""; token.value = "";
        if (action === "save") { clearSecrets(); confirmed.checked = false; }
        data.password = ""; data.vercelToken = "";
        for (const key of Object.keys(values)) values[key] = "";
        w.dialog.removeEventListener("cancel", preventClose);
        buttons.forEach((b, i) => { b.disabled = previousDisabled[i]; });
        if (form.querySelector("#setup-ETSY_CONFIG_ENCRYPTION_KEY").disabled) {
          form.querySelector("#setupGenerate").disabled = true; form.querySelector("#setupCopy").disabled = true;
        }
        busy = false;
      }
    });
  });
}
