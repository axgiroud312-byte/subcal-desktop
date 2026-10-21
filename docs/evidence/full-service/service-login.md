# 应用内服务登录：协议证据与边界

固定来源：`C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`，已用 `git rev-parse HEAD` 核对为 `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`。以下行号均指该提交的 `packages/<name>/index.mjs`。协议来自 magpie-community contributors，Copyright (c) 2026，MIT；项目现有 third_party 保留许可。实现只移植登录所需 HTTP 和本地回调，不 import、执行或评估社区插件，不加载模型/runtime hooks。

## 已实现的真实浏览器授权

| Provider ID | 协议与证据 | 本应用保存/使用 |
|---|---|---|
| `cline` | `cline:235–319`：WorkOS `authorize/device` → `authenticate` 单次轮询 → Cline `/api/v1/auth/register`；生产 client ID 为 `client_01K3A541FN8TA3EPPHTD2325AR` | Cline 注册后的 `workos:` bearer、userId；丢弃 WorkOS token/refresh，未使用模型接口 |
| `opendesign` | `opendesign:122–174`：创建 `/api/v1/cli/device-authorizations`，使用 deviceSecret 轮询 `/{deviceId}/token` | 仅 controlKey；runtimeKey 不进入凭据。deviceSecret 不出 flow closure |
| `commandcode` | `commandcode:649–739`：Studio `/studio/auth/cli?callback=...&state=...&mode=redirect`，本机 POST 接收 JSON/表单 apiKey | 主进程回调保存 apiKey；回调页面只显示完成提示，支持官方来源 CORS/private-network preflight |
| `raccoon` | `raccoon:716–815`：`/code/authorize`，64 位十六进制 state，`desktop_callback=loopback`、`redirect=http://127.0.0.1:<port>/auth/callback`，再交换 authorization_code | 主进程保存 access_token；不要求终端、原客户端或复制回调 |
| `zcode-gift` | `zcode:918–974`：`/api/v1/oauth/cli/init` 与 `/poll/{flow}`；浏览器走 Z.ai，结果内 `token` 是 ZCode JWT | JWT + 本次 device ID，供现有赠送权益 adapter；不领取奖励，不创建模型 Key。浏览器供应商回跳仍为上游规定的 `zcode://oauth/callback`，应用实际上靠服务器 flow 轮询完成，不依赖安装 ZCode |
| `zcode-team-cn`, `zcode-team-global` | 同一 ZCode flow；国内 BigModel、国际 Z.ai；`zcode:769–781,809–841` 的业务 token 交换、组织项目列表和席位判定 | 每次 poll 最多检查一个团队，选择首个 EFFECTIVE/VALID 席位。保存业务 token + org/project；**不 mint API Key**，因此现有 adapter 可读 subscription/reset，缺少 key 的 quota 仍明确缺失 |
| `mimo-app-sgp`, `mimo-app-ru`, `mimo-app-in` | `mimo:274–355,109–160`：获取小米网页登录票据，`account.xiaomi.com/longPolling`，用授权结果 passToken 完成服务 STS/cookie 跳转 | 每个 poll 只推进一次网络请求/跳转，最多十跳。cookie 按 host/domain/path 隔离；最终只保存选定 MiMo 站点会话 cookie，不存 Xiaomi passToken。账号返回地区不匹配时明确失败，不静默切换 |
| `mimo-token-plan` | 同一小米浏览器票据；`mimo:163–225`：平台 `/api/v1/tokenPlan/detail` 的 401 loginUrl → Xiaomi → platform STS | 只保存平台 cookie；不创建/读取模型 key。与 MiMo App 区分服务身份 |
| `autoclaw` | `autoclaw:873–1098,1105–1220`：官方注册端口 18432/19654/19723/53699，本地引导页承载 Aliyun captcha；`oauth-captcha-config`、`google-oauth-url`、`google-oauth-login` | Google 只是 AutoClaw 登录方式，**不是 Gemini/Antigravity 授权**。实现 Google 默认方式；未实现供应商选择 UI。SDK URL 与上游一致，captcha receipt 必须真实完成，不伪造 |
| `zed` | `zed:427–522`：临时 RSA-2048 公钥（PKCS#1 DER、带 padding 的 base64url）、native_app_port/system_id；回调 user_id 与 RSA 加密 access_token | 仅接受本次私钥可解密的 OAEP-SHA256 或上游 legacy PKCS#1 v1.5；严格验证密文长度/填充，拒绝另一 flow 密钥与回放。再用 `/client/users/me` 校验账号，保存 userId/systemId/access。没有模型请求、原客户端或终端依赖 |
| `autoclaw-cn` | `autoclaw:797–845`：`agent-send-code` → `agent-login/` | 应用创建精确登记的 loopback 表单，输入手机号和短信验证码；随机 session nonce + 严格同源 POST，短信重发一分钟间隔；错误验证码可重试，页面响应不含 token，成功凭据只经主进程 poll 交付 |

## 内置服务由独立模块接入

- **StepFun 国内/国际、Gemini、Antigravity**：固定社区提交不包含登录 provider；内置源码 `internal/provider/google.go` 和 `stepfun_plan.go` 的协议由 `builtin-login.ts` 接入，详见 [独立证据](builtin-login.md)。

Zed 不伪造供应商不存在的 OAuth state：按其实际 RSA 临时密钥协议关联回调，之后查询官方账号接口验证令牌。AutoClaw 国内使用本应用表单，不再因无初始 phone 参数而阻止登录。

## 生命周期、安全及集成合同

- 导出 `SERVICE_LOGIN_PROVIDERS` 与 `createServiceLogin(providerId, options)`，当前共 14 项：`cline`, `opendesign`, `commandcode`, `raccoon`, `zcode-gift`, `zcode-team-cn`, `zcode-team-global`, `mimo-app-sgp`, `mimo-app-ru`, `mimo-app-in`, `mimo-token-plan`, `autoclaw`, `zed`, `autoclaw-cn`。共享 `types.ts` 由主代理提供；本次同时修正 ZCode/MiMo 对应 adapter。
- 所有凭据封装 `management: 'static'`，供已有 adapter 消费；不借用不支持这些服务的原 refresh 实现。过期后在本应用重新登录。凭据仅由 main-process `poll()` 返回给 vault；IPC/UI 必须只投影 url/userCode/instructions/expiresAt/intervalSeconds，不能序列化 AccountCredential 给 Renderer。
- `poll()` 不等待用户：未授权返回 null；本地回调数据未到时立即返回 null。网络单请求上限 15 秒；ZCode 初次团队完成会进行有限的 poll/交换/组织读取，最多三次请求，无等待授权循环。MiMo 的每次跳转单独 poll。网络临时异常返回 null；明确拒绝、过期或取消结束 flow。
- 同一 flow 并发 poll 合并；按 interval 节流，Cline slow_down 增长后续 interval。最长十分钟，使用供应商期限缩短。取消/过期清理计时器、监听器、HTTP server 和所有连接，中止在途 fetch；晚到响应不能提交凭据。
- 所有 callback server 仅监听 127.0.0.1，校验 Host、方法及供应商实际关联协议；OAuth 协议校验 state 并拒绝缺失/重复与回放；Zed 的上游回调允许任意 path，用临时 RSA 解密关联及账号验证。AutoClaw 本地操作要求随机 session nonce 和同源 Origin；国际供应商回调 state 必须与获取的授权 URL 一致。
- 供应商错误正文、token、cookie、授权 code 不进入错误提示、成功页或日志。用户访问的远程授权页仍由供应商自行呈现。
- MiMo 跨站跳转只能到 account.xiaomi.com、选定地区主机及（Token Plan 时）platform.xiaomimimo.com，credential cookie 不跨 host 盲转发。
- MiMo 用 `cookiesByPath` 保存两个真实权益 endpoint 各自匹配的 cookie header，不再以平台根路径筛选而丢弃 `Path=/api` cookie，也不把 detail-only cookie 发给 usage；App 同步采用 endpoint scope。adapter 兼容历史 cookie 字段，但新 scope 存在时绝不退回宽泛 cookie。
- ZCode 登录与 adapter 共用 `zcodeAccountSubject`，原身份种子存 `identitySubject`，规范 subject 不再二次 hash；每次仍重新绑定 site/org/project，因此项目被替换会触发 ACCOUNT_MISMATCH。解析业务 token/JWT 时不从 accessToken 推断模型 key，明确提供的 key 仍保留。

## 验证

`npx tsx --test tests/service-login.test.ts tests/zcode-adapter.test.ts tests/regional-adapters.test.ts`：使用假响应与真实本地回调 HTTP server，完全不用真实用户账号。除已有授权测试，还覆盖 Zed 两种 RSA padding/错误密钥/回放、国内短信错误重试/nonce/origin/敏感信息边界、ZCode 登录后连续 adapter collect 身份一致/变更项目拒绝/不误发 quota、MiMo Path=/api 及 endpoint-specific cookie 从登录到 adapter 的回归。

这些是协议夹具测试，不宣称已通过真实供应商账号端到端验证。真实上游协议变化应报错而不是假成功。
