# Google / StepFun 应用内登录

来源：`yetone/magpie`（MIT，Copyright (c) 2026 yetone），本机
`magpie-onboarding-review` 固定 commit `ba319a7587923fc7a4ea3859658244d591261a59`。
仅移植授权及只读账号查询协议；不加载上游 runtime，不调用模型。

## 合同与主进程集成

- `BUILTIN_LOGIN_PROVIDERS`: `gemini-cli`, `antigravity`, `stepfun-plan-com`, `stepfun-plan-ai`。
- `createBuiltinLogin(providerId, LoginOptions): Promise<LoginFlow>`。
- Google `flow.url` 为本次精确 nonce loopback URL，由 manager 批准打开。
- StepFun `flow.url` 为对应官方平台 `/step-plan`，必须由 manager 调用 `flow.open()`；使用共享 `openWindow(url, {allowedOrigins,title})` 打开隔离登录窗口。没有窗口能力明确报错，不要求终端或书签粘贴。
- `poll()` 返回的 `AccountCredential` 仅供主进程保存，不能返回应用 Renderer；flow 公共属性不含 token。
- Google 一次 poll 最多一个 HTTP 步骤；StepFun 轮询固定脚本及验证共享 15 秒 deadline。取消、到期、窗口关闭清理 listener/window/request；并发 poll/open 去重。

## Google

源映射：`internal/provider/google.go:70–89` 的公开 installed-app client ID/secret、scopes、callback；`:1481–1548` 的 OAuth、PKCE、state、token exchange/userinfo；`:600–715` 的项目读取协议。

仓库不包含上游 OAuth client ID/client secret。部署端通过 `SUBCAL_GEMINI_OAUTH_CLIENT_ID` / `SUBCAL_GEMINI_OAUTH_CLIENT_SECRET` 或 `SUBCAL_ANTIGRAVITY_OAUTH_CLIENT_ID` / `SUBCAL_ANTIGRAVITY_OAUTH_CLIENT_SECRET` 提供自己的应用配置；不得提交实际值。未配置时明确提示 Google 登录暂不可用，不发起网络请求。协议测试仅注入虚构配置。

本地页面链接到 Google 官方授权页。使用随机 verifier/state，S256，校验一次性 callback 与 state。Gemini 回调 `127.0.0.1/oauth2callback`，Antigravity 回调 `localhost/oauth-callback`，随机端口、IPv4 loopback listener；callback 中不显示 code/token。

token exchange → Google userinfo → **只读** `cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`。
Gemini 需要已开通 currentTier 及项目；Antigravity 接受已返回的 companion project。没有项目时保留 pending，用户可刷新本地页面，在 nonce/Origin 保护的表单填写已有 project ID，然后再调用 loadCodeAssist 验证。

**不调用 `onboardUser`、不创建 Cloud project、不启用服务。** 页面明确说明缺少已开通项目，需要用户自行到 Google 控制台确认套餐、项目和服务设置；这不是一个默默替用户开通云资源的授权步骤。

secret：`accessToken / project / accountId / subject / alias / source / provider / expiresAt / management:'static'`。身份包含 Google user ID（无 ID 时 email）和 project，匹配现有 control adapter 的 subject；只保留 access token，到期在应用重新登录。

## StepFun

固定源码没有 SMS 登录 API，也没有 OAuth callback。`internal/provider/stepfun_plan.go:3–23, 77–96` 通过平台页同源的 `PassportService/RefreshToken` 取得 HttpOnly 会话的 access/refresh；`:248–315` 验证 `activated/oasis_id`，优先使用 refresh JWT 的 `device_id` 作 webId，并只读查询 `QueryStepPlanRateLimit`。

本实现把上游书签的**同源会话提取协议**置于隔离登录窗口，由主进程调用固定 `evaluate` 脚本：

1. 打开所选 `https://platform.stepfun.com/step-plan` 或 `.ai`；用户在官方页面完成短信/其他官方登录交互。
2. 脚本严格检查当前 `location.origin`，仅调用本站固定 RefreshToken RPC，匿名 `activated !== true` 返回 null；脚本输入不是 Renderer 提供的任意字符串。
3. 结果经窗口桥直接到 main，主进程再次验证 site、activated、oasis_id、expiry、refresh JWT 和 device_id；不经剪贴板或应用 Renderer。
4. 使用所选官方 host、Oasis-Appid（com=10300/ai=20700）、Oasis-Webid 和 Oasis-Token cookie 调用只读 QueryStepPlanRateLimit 验证，然后关闭窗口。

RefreshToken 是上游授权会话获取所需的**一次登录续签行为**，并非只读 RPC；它仅在当前登录窗口中执行。保存后不进行后台续签，management 仍为 static。
secret 保留 `access / refresh / webId`（这是 adapter 拼装 Oasis-Token 所必需的会话对），另有 accessToken、subject、site、expiresAt 等通用字段；不把 API Key 当 Step Plan 会话。

## 验证

`tests/builtin-login.test.ts` 使用 mock fetch、自己的本机 callback listener 和 VM 执行固定窗口脚本。
覆盖两种 Google OAuth PKCE/state/重复回调/项目读取与表单保护、两个 StepFun 地区真实脚本请求/错误 origin/设备 ID 绑定、晚到窗口取消、无窗口能力、到期，以及将最终 secret 交给**现有 control adapters**确认实际查询 header/body/subject 匹配。
没有调用用户账户、真实供应商网络或真实浏览器授权。
