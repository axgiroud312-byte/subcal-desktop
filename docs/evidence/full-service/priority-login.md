# 优先服务应用内授权协议移植

来源：本机只读 checkout `subcal-catalog-plugins`，固定 commit
`aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`（MIT；原仓库许可见既有第三方许可记录）。
仅重写授权 HTTP / loopback 协议；不 import 上游插件，不运行模型、runtime 或 hooks。

## 已实现

| 服务 | 固定源码 | 本应用协议 |
| --- | --- | --- |
| Cursor | `packages/cursor/index.mjs:308–360`，版本 fallback :48 | `cursor.com/loginDeepControl`，32-byte PKCE verifier、随机 UUID；`api2.cursor.sh/auth/poll` 单次轮询，404 表示 pending。verifier 不放入浏览器 URL。 |
| Devin | `packages/devin/index.mjs:850–947` | `app.devin.ai/auth/cli/continue` → 随机端口 `127.0.0.1/callback`；48-byte PKCE + 24-byte state；只接收匹配 state 的单次 code；由下一次 poll 调用固定 `ExchangeDevinCLIPKCECode`。 |
| Factory | `packages/factory/index.mjs:289–375, 844–924` | WorkOS `/user_management/authorize/device`、`/authenticate`；pending/slow_down；必要时查询首个 WorkOS org 并 exchange org token，然后 whoami 映射 Factory org ID / EU region。 |

入口：`createPriorityLogin(providerId, {fetch, now, signal}) -> Promise<LoginFlow>`。
`PRIORITY_LOGIN_PROVIDERS` 仅列真实实现的三项。`poll()` 未授权返回 null，不进行睡眠循环；并发 poll 共用一次请求；每轮共享 15 秒 abort deadline。
Devin 回调只收 code，不在浏览器处理或显示凭据。取消与到期关闭监听器，abort 网络请求。HTTP 重定向拒绝，错误不包含服务端原文、token 或 code。

凭据只通过主进程 `poll` 返回，secret 是现有 adapter 接受的 JSON：
`accessToken / subject / alias / accountId / source / management: static`，Factory 另含 `organizationId / region`。
有 JWT exp（或 Factory expires_in）才设置真实 expiresAt，不把登录窗口误作 token 有效期。
不保留 refresh token，不标记 managed；说明到期须在本应用重新登录。没有 exp 时不编造有效期，查询 401 应要求重新登录。

## 固定来源的真实边界

- Grok Build：`packages/grok/index.mjs` 使用 child-process 执行 `grok login` 并读取自建 home；虽然注释出现 `/oauth2/device/code`，它不是完整独立 HTTP 授权实现。模块不伪造 scope/client/grant，不把“请在 CLI 登录”当成功能。
- Kimi Code：此 community checkout 没有 `kimi-code` 包；不把 Code API key 当 Work token。
- Kimi Work：`packages/kimi-work/index.mjs:15–35, 89–100` 只读取本机桌面 credentials；没有浏览器登录和回传协议。
- OpenCode Go：此 community checkout 未提供 Go 授权包。现有 Go usage adapter 需要订阅成员在原工作区创建的 API Key；没有源码支持把网页登录当作可回传凭据的 OAuth。

这些项目明确返回 `UNSUPPORTED`，不返回一个只能打开主页而永远 pending 的虚假 LoginFlow。

## 验证

`npx tsx --test tests/priority-login.test.ts`：5/5。
测试模拟实际协议 request，分别断言 Cursor PKCE 配对、Devin 本机 HTTP callback/state/重复回调/交换、Factory device form/pending/slow_down/组织与区域、取消/过期和不支持边界。
只访问测试自己的 loopback listener；没有调用真实账户或供应商网络。
