# EtsyShipping 网页版

原 Windows WPF 客户端的浏览器工作台。`dist/` 是静态页面，`api/bridge.js` 是 Vercel Node Function；本地 `server.mjs` 使用同一个转发函数。业务数据仍由原生产服务器保存和授权。

## 本地启动

需要 Node.js 18 或更新版本。双击 `启动 EtsyShipping.command`，或运行 `npm start`，然后打开 <http://127.0.0.1:4188>。

本地演示账号为 `admin` / `admin`，只显示样例数据，不具备生产权限。Vercel 部署自动关闭演示入口；线上登录必须使用原生产系统提供的真实账号。

## 发布到 Vercel

1. 将此文件夹作为项目根目录导入 Vercel，框架选 **Other**。若提交的是包含本文件夹的仓库，将 Root Directory 设为 `EtsyShipping-Mac-Web`。
2. `vercel.json` 已配置构建检查、`dist` 静态输出和 `/api/bridge` Function。无需配置数据库、持久磁盘或额外 NPM 依赖。
3. 默认上游是 `https://shipping.sunfacework.com`。如服务器地址不同，在 Vercel 项目环境变量中设置 `ETSY_SERVER_URL`，值为可从 Vercel 访问的 HTTPS 服务根地址，然后重新部署。请勿在项目或浏览器代码中填写真实账号、密码或 API 密钥。
4. 如需开启 Vercel 站点演示管理员，设置 `SITE_ADMIN_USERNAME` 和 `SITE_ADMIN_PASSWORD`。凭据只在服务端验证，登录后只显示演示数据，不会获得原生产服务器权限。
5. 发布后访问 `/api/bridge?route=meta`，应返回 JSON 且 `demoEnabled` 为 `false`。访问 `/api/bridge?route=runtime` 应返回生产服务状态；如果是 502，需先修复原服务器或网络连通性。
6. 用原生产账号测试登录和只读页面。若网站包含真实订单及客户数据，发布前应按团队要求设置访问权限和域名。

也可以在此目录运行 `npx vercel` 创建预览部署，确认后运行 `npx vercel --prod` 发布生产版本。首次使用需要先登录 Vercel CLI。当前 Mac 上直接输入 `vercel` 会调用同名的 Python 程序，因此请使用 `npx vercel`。

## 安全与运行范围

- 网站只允许已列出的原系统 API 路径，不接受任意转发 URL；上游必须是 HTTPS。
- 密码仅用于登录或改密请求，不写入磁盘。Access Token 仅保存在当前标签页的 `sessionStorage`；刷新令牌不持久化。
- 转发请求与静态文件都不缓存；超时、上游不可用、非 JSON 响应会返回可读错误。
- 当前已接入登录、首次改密、退出、运行状态、仪表盘、订单、物流异常、仓库任务等只读接口。创建、取消、打印以及管理操作仍是界面占位，未接入生产写操作。
- 如果原生产服务器不可用或 API 契约与原客户端不同，Vercel 站点仍可加载，但真实登录与业务数据无法正常使用；需修复上游后再验收。

运行 `npm run check` 可检查 JavaScript 语法。Vercel 构建时也会运行此检查。
# EtsyShipping-Production
