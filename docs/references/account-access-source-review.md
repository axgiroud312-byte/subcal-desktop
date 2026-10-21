# 账号凭据与余额/额度：源码核对

2026-10-21 实际读取并复核以下固定快照；这是参考实现事实，不代表 SubCal 已接入或真实账号验证通过。未读取用户本机的秘密。

- Magpie：`yetone/magpie@ba319a7587923fc7a4ea3859658244d591261a59`
- CC Switch：`farion1231/cc-switch@c776fd0ebfe35d769b5909b86bdfa1ccdf089988`

## 1. 凭据来源和查询路径

| 服务 | 已核实的凭据来源 | 已核实的查询路径与含义 |
| --- | --- | --- |
| Codex | Magpie 从 Codex 配置目录读取登录，结构含 access_token、refresh_token、id_token、account_id；按实际存储设置处理 auth.json/钥匙串。CC Switch 也读取本机登录，并支持设备码授权与自有账号存储。 | GET `https://chatgpt.com/backend-api/wham/usage`，Bearer Access Token，账号/工作区用 ChatGPT-Account-Id；套餐、额度窗口与积分按返回值识别。CC Switch 另查 `/backend-api/wham/rate-limit-reset-credits`，是查询，不是消费重置次数。 |
| Claude Code | CC Switch 读取 Claude 配置目录 `.credentials.json` 或 macOS Claude Code-credentials 钥匙串，兼容 claudeAiOauth / claude.ai_oauth。 | CC Switch：GET `https://api.anthropic.com/api/oauth/usage`，Bearer Token 与 `anthropic-beta: oauth-2025-04-20`。当前 Magpie 不直接调用该接口，而运行 `claude -p /usage` 并解析。两者不能混称同一种接入。 |
| Copilot | Magpie 读取编辑器 github-copilot 的 apps.json/hosts.json；CLI 读取 `.copilot/config.json` 的身份，并从系统凭据库取得 Token（或源配置已使用的文件存储）。CC Switch 支持 GitHub 设备码授权，管理自己的账号集合。 | GET `https://api.github.com/copilot_internal/user`，套餐、quota_snapshots、重置日期。CC Switch 用 GitHub Token 和对应编辑器请求头；Magpie CLI 凭据使用自己的 integration 请求头。不能把 CLI Token 当编辑器 Token 随意交换。 |
| DeepSeek API | 供应商配置中的 API Key，或新增 Key。 | GET `https://api.deepseek.com/user/balance`，Bearer Key，按币种解析 total_balance/granted_balance/topped_up_balance。 |
| Kimi API 国内站 | 供应商配置中的 Moonshot API Key，或新增 Key。 | Magpie：GET `https://api.moonshot.cn/v1/users/me/balance`；检查业务状态，读取 available_balance/cash_balance/voucher_balance。不适用于 Kimi Code 会员。 |
| OpenRouter | 供应商配置中的 API Key，具体权限以真实响应为准。 | 两项目余额查询用 GET `https://openrouter.ai/api/v1/credits`，按 total_credits 与 total_usage 计算账户余额；`/api/v1/key` 查询 Key 预算/用量，必须另列。权限不足不能用预算冒充余额。 |

客户端内部端点与公开稳定 API 分别记录；源码存在不代表任意 Token、版本或账号都可用。

## 2. 登录与刷新

- CC Switch Codex 设备码流程：`https://auth.openai.com/api/accounts/deviceauth/usercode` → `/api/accounts/deviceauth/token` → `https://auth.openai.com/oauth/token`；最后一步也用于刷新。授权成功后管理账号与 Token，不要求用户操作额度探测。
- CC Switch GitHub：`https://github.com/login/device/code` → `https://github.com/login/oauth/access_token`；Copilot 会话令牌交换使用 `https://api.github.com/copilot_internal/v2/token`，额度查询使用 `/copilot_internal/user`，两者用途不同。
- CC Switch Codex 的刷新代码有账号锁、凭据代次检查和读取 live 凭据的恢复逻辑，处理 refresh_token_reused，不能简单复制 Refresh Token 后让两个应用无协调地刷新。
- 参考项目自身凭据文件不应原样照搬存储策略；SubCal 继续使用系统保护的加密存储。

## 3. “监听”不是单一接口

1. 本地登录变化：发现配置、重新读取凭据，按账号和代次判断变化。计划采用文件变化监听加低频校验；这是 SubCal 设计，不宣称两项目都采用同样实现。
2. 远端余额/额度：HTTP 查询、缓存与退避。Magpie 余额及订阅缓存中存在一分钟新鲜度判断，不代表供应商允许所有账号每分钟轮询。
3. Magpie 还会从其代理请求的 Codex 响应头/额度事件补充窗口数据。SubCal 本任务不需要代理推理流量；不能为了取得额度而发送模型请求。

## 4. 平台及未决边界

- 尊重 CODEX_HOME、COPILOT_HOME 等实际配置根目录；不能只硬编码默认路径。
- CC Switch 源码明确区分 macOS 钥匙串可读与 Windows/Linux 对应凭据库不可读，不能直接宣称跨平台读取已完成。Windows 文件型登录、系统凭据库分别实测。
- 第三方配置导入只实现已核实的版本/结构；不遍历用户所有文件寻找密钥。
- Claude 路径须在实现时按当前客户端版本对照验证；不把 CLI 的普通提示词执行误认为本地 `/usage` 命令，也不强制退回手填额度。
- 六类服务是本轮核对和实现范围；其他服务另列能力缺口，不据此宣称全平台自动支持。

## 源码定位

- [Magpie account.go：Codex 登录读取/刷新与 Copilot 编辑器配置](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/account.go#L956)
- [Magpie copilot_cli.go：CLI 身份与凭据来源](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/copilot_cli.go#L3)
- [Magpie subscription_usage.go：额度模型与 Codex 查询](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/subscription_usage.go#L910)
- [Magpie claude_usage_cli.go：实际采用 CLI /usage](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/claude_usage_cli.go#L3)
- [Magpie balance.go：余额端点与解析](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/balance.go#L59)
- [Magpie codex_limits.go：代理响应补充额度](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/codex_limits.go#L8)
- [CC Switch subscription.rs：本机凭据、Claude/Codex 查询及平台边界](https://github.com/farion1231/cc-switch/blob/c776fd0ebfe35d769b5909b86bdfa1ccdf089988/src-tauri/src/services/subscription.rs)
- [CC Switch codex_oauth_auth.rs：设备码、持久账号与刷新竞争处理](https://github.com/farion1231/cc-switch/blob/c776fd0ebfe35d769b5909b86bdfa1ccdf089988/src-tauri/src/proxy/providers/codex_oauth_auth.rs)
- [CC Switch copilot_auth.rs：GitHub 授权及额度请求](https://github.com/farion1231/cc-switch/blob/c776fd0ebfe35d769b5909b86bdfa1ccdf089988/src-tauri/src/proxy/providers/copilot_auth.rs#L1087)
- [CC Switch balance.rs：OpenRouter 账户余额](https://github.com/farion1231/cc-switch/blob/c776fd0ebfe35d769b5909b86bdfa1ccdf089988/src-tauri/src/services/balance.rs#L295)
