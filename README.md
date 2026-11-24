# EtsyShipping 网页版

参照原 Windows WPF 3.0.2 客户端的浏览器工作台。布局和业务分组来自原安装包 MainWindow、AdminCenterWindow 与 BusinessSettingsCenterWindow 资源；使用原版深蓝公司标题栏、浅灰导航、紧凑表格和列表 / 详情分栏。

`dist/` 是静态页面，`api/bridge.js` 是 Vercel Node Function；本地 `server.mjs` 使用同一个转发函数。网页演练数据保存在当前浏览器；真实生产数据仍由原生产服务器保存和授权。

## 已实现的网页流程

- 订单助手：图片上传、拖放、预览、本机保存，文本规则提取、CSV 批量导入与模板下载。
- 我的订单：新建、编辑、详情、搜索、状态 / 店铺 / 国家筛选、分页、多选、CSV 导出、复核、SKU 绑定、批量复核及错误订单归档。
- 待选择物流：订单摘要、物流方案、发货仓库、重量 / 目的国校验、发货草稿，创建 DEMO 演练单号并生成仓库任务。
- 仓库：任务领取、拣货、称重、打印确认、交运状态流转，输入 / 扫描任务号查找；拣货单和演练标签预览及系统打印。
- 物流：详情、人工轨迹、异常记录、签收、演练取消；已交运包裹不允许直接取消。
- Etsy 人工回填：复制承运商和追踪信息、人工确认记录；不会自动调用 Etsy。
- 业务设置：店铺、仓库发件资料、物流方案、SKU 与申报模板、打印模板、价格版本的创建、编辑、启停、导出，价格 CSV 导入。
- 高级管理：演练成员角色和范围、物流账号配置元数据、真实连接诊断、操作日志、备份导出 / 恢复、Synthetic 数据清理。
- 经营看板、客户统计、响应式手机布局、对话框键盘操作。

以上写入功能属于网页演练工作区，不是生产系统的写接口。AI、真实面单、真实物流下单 / 取消、Etsy OAuth、真实用户权限和密码重置仍需接通生产后端；界面显示其未连接状态，不模拟外部成功。

订单和配置使用 localStorage；图片使用 IndexedDB。刷新保留数据，但不同设备不共享。同源同浏览器的演练使用者共享工作区。JSON 备份不包含图片原件。演练运费以 CNY 记录；订单金额按原币种分别统计，不进行隐式汇率转换。

## 本地启动

需要 Node.js 18 或更新版本。双击 `启动 EtsyShipping.command`，或运行 `npm start`，然后打开 <http://127.0.0.1:4188>。

本地演练账号为 `admin` / `admin`，可以编辑浏览器工作区，不具备生产权限。Vercel 关闭免登录演练入口，站点管理员通过 `SITE_ADMIN_USERNAME` / `SITE_ADMIN_PASSWORD` 验证后进入演练工作区；生产账号使用原服务器登录。

## 发布到 Vercel

1. 将此文件夹作为项目根目录导入 Vercel，框架选 **Other**。若提交的是包含本文件夹的仓库，将 Root Directory 设为 `EtsyShipping-Mac-Web`。
2. `vercel.json` 已配置构建检查、`dist` 静态输出和 `/api/bridge` Function。无需配置数据库、持久磁盘或额外 NPM 依赖。
3. 默认上游是 `https://shipping.sunfacework.com`。如服务器地址不同，在 Vercel 项目环境变量中设置 `ETSY_SERVER_URL`，值为可从 Vercel 访问的 HTTPS 服务根地址，然后重新部署。请勿在项目或浏览器代码中填写真实账号、密码或 API 密钥。
4. 如需开启 Vercel 站点演练管理员，设置 `SITE_ADMIN_USERNAME` 和 `SITE_ADMIN_PASSWORD`。凭据只在服务端验证，登录后可操作浏览器演练工作区，不会获得原生产服务器权限。
5. 发布后访问 `/api/bridge?route=meta`，应返回 JSON 且 `demoEnabled` 为 `false`。访问 `/api/bridge?route=runtime` 应返回生产服务状态；如果是 502，需先修复原服务器或网络连通性。
6. 用原生产账号测试登录和只读页面。若网站包含真实订单及客户数据，发布前应按团队要求设置访问权限和域名。

也可以在此目录运行 `npx vercel` 创建预览部署，确认后运行 `npx vercel --prod` 发布生产版本。首次使用需要先登录 Vercel CLI。当前 Mac 上直接输入 `vercel` 会调用同名的 Python 程序，因此请使用 `npx vercel`。

## 安全与运行范围

- 网站只允许已列出的原系统 API 路径，不接受任意转发 URL；上游必须是 HTTPS。
- 密码仅用于登录或改密请求，不写入磁盘。Access Token 仅保存在当前标签页的 `sessionStorage`；刷新令牌不持久化。
- 转发请求与静态文件都不缓存；超时、上游不可用、非 JSON 响应会返回可读错误。
- 生产模式已接入登录、首次改密、退出、运行状态、仪表盘、订单、物流异常、仓库任务等只读接口。新增业务操作在演练模式运行；生产模式不会把本地记录当作服务器结果。
- 如果原生产服务器不可用或 API 契约与原客户端不同，Vercel 站点仍可加载，但真实登录与业务数据无法正常使用；需修复上游后再验收。

运行 `npm run build` 可检查语法并测试身份转发、完整履约状态机、数据校验、存储回滚、并发冲突和 CSV。Vercel 构建时运行同一检查。

浏览器验收脚本 `test/browser-flow.mjs` 使用已有 Playwright 环境，设置 `PLAYWRIGHT_MODULE`（可选 `CHROMIUM_PATH`）后运行 `node test/browser-flow.mjs`，默认测试地址 `http://127.0.0.1:4190`。截图保存至被 Git 忽略的 `test-output/`。脚本只操作隔离的浏览器测试上下文。
