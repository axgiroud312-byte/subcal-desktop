# Magpie 内置与通用适配器完整能力清单

静态研究日期：2026-10-21。固定仓库 `yetone/magpie@ba319a7587923fc7a4ea3859658244d591261a59`。没有调用真实供应商、读取用户凭据或执行上游测试。覆盖注册入口、订阅/余额分发及相关实现和代表测试；不是宣称全仓库每一行都已审阅。

以下路径相对 [`internal/provider/`](https://github.com/yetone/magpie/tree/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider)。无证据指该固定版本未读取此字段，不代表供应商永久无法提供。

## 活跃账号来源

实际 `Accounts()` 六个来源见 `account.go:832-867`；订阅分发见 `subscription_usage.go:388-506`。

| 服务 | 凭据/查询 | 字段与缺口 | 源文件 |
| --- | --- | --- | --- |
| Claude Code | 独立配置目录/钥匙串；CLI `claude -p /usage` | 会话/周/模型窗口及重置；无会员到期证据。SubCal 保持 CC Switch OAuth HTTP 为主，不以普通模型请求作后备 | `claude_usage_cli.go:3-121`, `subscription_usage.go:619-866` |
| Codex | CODEX_HOME、auth.json/传统钥匙串，workspace；GET chatgpt.com/backend-api/wham/usage | plan_type、动态窗口、credits；ID token `chatgpt_subscription_active_until` 是会员日期，过去值不当当前到期；token exp 不是会员到期 | `subscription_usage.go:889-985`, `plan_term_test.go:10-46` |
| Copilot | 编辑器/CLI/设备码；GET GitHub /copilot_internal/user | plan/SKU、entitlement/remaining/unlimited/overage/reset；小数计量，不能固定“次数”；GHE login@host 隔离；无会员有效期/续费证据 | `subscription_usage.go:1072-1195`, `copilot_accounts.go:3-66` |
| ChatGPT API OAuth | 独立 public client 注册与 clientId、hostId；非 Codex token | 仅 token plan，**没有原生权益查询**，指向 chatgpt.com/settings/usage；Responses 模型端点不是查询 | `chatgpt_api.go:3-108` |
| Gemini CLI | .gemini OAuth、Google 账号、project，应用 client 校验；POST cloudcode-pa.googleapis.com/v1internal:loadCodeAssist / :retrieveUserQuota | tier；buckets modelId/remainingFraction/resetTime；无会员有效期/续费证据 | `google.go:116-245,309-467,919-1080` |
| Antigravity | 独立 OAuth client/project；production loadCodeAssist，daily-cloudcode-pa.googleapis.com 的 :fetchAvailableModels / :retrieveUserQuotaSummary | 模型额度与5小时/周共享池；不重复累计；无会员有效期/现金证据 | `google.go:1158-1274` |

Google `project()` 可能调用 `onboardUser`，迁移应分离首次开通与定时只读查询，不能完整运行调用链冒充只读。

## Key 型套餐

入口 `planquota.go:37-71`。多 Key 不代表多个厂商钱包，不能按 Key 掩码合并身份。

| 服务 | 请求 | 字段/限制 | 源文件 |
| --- | --- | --- | --- |
| OpenCode Go | GET https://opencode.ai/zen/go/v1/usage，Bearer + session header | rolling/weekly/monthly.percent、resetsAt；零用量可能无真实 reset。403成员/工作区与401失效分开；无会员有效期 | `planquota.go:152-189,503-541` |
| OpenCode Zen | 无查询请求，提示控制台 | API key 无余额查询证据；不能套用 Go 端点 | `balance.go:1316-1343`, `opencode_balance_test.go:23-87` |
| Kimi Code 全球/国内 | GET api.kimi.ai 或 api.kimi.com /coding/v1/usages | usage.limit/used/remaining/resetTime、limits.window；原实现主要百分比，绝对量单位须核验；无会员日期 | `planquota.go:397-487` |
| Cline/ClinePass | api.cline.bot /api/v1/users/me/plan/usage-limits；/users/me；/users/{id}/balance | 短/周/月百分比及reset，余额微美元；404无计划不同于403/503；允许局部成功 | `cline_usage.go:24-186` |
| GLM 智谱/Z.ai | GET host /api/monitor/usage/quota/limit；团队?type=2；/api/biz/subscription/list | level、limits、MCP、nextResetTime；VALID nextRenewTime/valid/autoRenew，UTC+8；团队需独立契约 | `planquota.go`, `zcode.go:288-341` |
| MiniMax API 国内/全球 | GET api.minimaxi.com 或 api.minimax.io /v1/token_plan/remains | interval/weekly remaining_percent、status、start/end，视频videos；计数方向须百分比校验。end_time不是会员到期 | `planquota.go:223-367` |
| Command Code Key | api.commandcode.ai /alpha/billing/credits 与 /subscriptions | USD余额及短/周窗口；currentPeriodEnd/cancelAtPeriodEnd有源字段但旧keyed路径丢弃；月总额部分为静态套餐常量 | `commandcode_plan.go:122-240,274-344` |
| Ollama Cloud | GET https://ollama.com/api/balance | included.balance_usd/allowance_usd/period；purchased.balance_usd独立；无最终会员到期/续费证据 | `ollama_usage.go:15-158` |

## 控制面独立身份

| 服务 | 凭据与查询 | 字段及须修正处 | 源文件 |
| --- | --- | --- | --- |
| StepFun 国内/全球 | 平台session/Oasis-Token，不能用模型Key查套餐；POST platform.stepfun.com/.ai /api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit 与 GetStepPlanStatus | subscription.name/expired_at/auto_renew、短周窗口；刷新保持 oasis_id。API钱包身份未确认与session同一账号前不得合并 | `stepfun_plan.go:3-23,388-452,481-586` |
| Volcengine | AK/SK HMAC，POST open.volcengineapi.com，Action GetCodingPlanUsage/GetAFPUsage，Version2024-01-01 | Level/Percent/ResetTimestamp、AFP分窗；去重缓存必须加region，旧实现仅AK+action；无会员到期、未知单位不猜 | `volcengine_usage.go:90-173,232-374` |
| Tencent Cloud企业 | SecretId/Key TC3，POST tokenhub.tencentcloudapi.com，DescribeTokenPlanList/DescribeTokenPlan | region+TeamId隔离，credits/tokens；分页旧版仅100项须补；PackageInfo.ExpireTime有字段未输出，独立于CycleEndTime | `tencent_usage.go:3-22,91-322` |

## 余额专用与通用服务

入口 `balance.go:44-185`；解析 `305-570`；鉴权 `1210-1313`；多Key `1418-1481`。除特别说明，无套餐/会员日期/续费字段。

| 服务 | GET 路径/字段 | 单位和边界 |
| --- | --- | --- |
| DeepSeek | api.deepseek.com/user/balance；balance_infos | 各currency，总/赠送/充值分列 |
| Kimi API全球/国内 | api.moonshot.ai/.cn /v1/users/me/balance；available_balance | USD/CNY隔离；不是Kimi Code |
| OpenRouter | openrouter.ai/api/v1/credits；total_credits-total_usage | USD账户余额，不等于/key预算 |
| SiliconFlow国内/全球 | api.siliconflow.cn/.com /v1/user/info；totalBalance | CNY/USD；接口退休410或20092，不承诺仍可同步 |
| StepFun钱包 | api.stepfun.com/.ai /v1/accounts；balance | CNY/USD，不能重复加历史现金/券 |
| AiHubMix Key | aihubmix.com/dashboard/billing/remain；total_usage | 字段虽叫usage实际剩余USD，负值表示Key未设限额 |
| AiHubMix账号 | aihubmix.com/api/user/self；quota/500000 | 账户访问token，不用模型Key冒充 |
| New API / One API Key | 用户站点/api/usage/token；total_available/500000 | USD key范围 |
| New API账号 | /api/user/self，account token + New-Api-User | USD quota/500000，和Key预算分列 |
| Sub2API账号 | /api/v1/user/profile，JWT；balance | USD，不自带登录/刷新 |
| Sub2API Key | /v1/usage；remaining/rate_limits | USD及5h/1d/7d，reset非会员日期；见sub2api_usage.go:3-60 |
| 旧OpenAI兼容Relay | /dashboard/billing/credit_grants；total_available | 仅Relay兼容，非官方OpenAI余额支持 |
| 通用BalanceURL | GET或POST，BalancePath表达式 | 用户配置能力不等于厂商原生支持；下一批不能要求用户写表达式，需内置模板或明确缺口 |

Command Code、Ollama、Cline 的余额见前表，不重复作为另一账户求和。

## 已退休的13个内置ID

`migrate.go:272-303`：cursor、devin、kiro、factory、grok、commandcode-plan、zcode、qoder、qoder-cn、workbuddy、workbuddy-ai、mimo-app、zed。实际能力转交社区插件，遗留文件是迁移/兼容，不能视作在线实现。参见 [插件清单](magpie-plugins-inventory.md)。Factory `factory_usage.go` 仅供测试。Windsurf 没有独立入口，Devin 的 windsurf_api_key 字段不能证明 Windsurf 会员读取。Trae 是插件服务，不在退休名单；内置 trae_checkin.go 是签到辅助，不是权益同步。

## 没有专用权益查询的全部预设

`presets.go:114-605`：anthropic、openai、google、vertex、xai、xiaomi、baidu-qianfan、huaweicloud、qwen、qwen-cn、qwen-token-plan、bailian-token-plan、mistral、groq、bedrock、bedrock-mantle、azure、nous、kilo、together、fireworks、nvidia、modelscope、pipellm、302ai、cherryin、yylx、typesafe、vercel-jev、cloudflare-jev、bailian-decision、qwen-decision、ollama、lmstudio、omlx、mlx-serve。

这些是模型/路由/本地服务注册，不提供原生权益查询证据。云模型身份不等于云账单权限；本地token计数不是供应商余额。下一批以缺口调查覆盖，不能偷偷要求用户手填到期/额度作为“自动接入完成”。

扩展入口：Remote Magpie GET /v1/magpie/quotas/cards 是远端缓存，隔离远端账号与授权Key；动态 partners 清单是广告/预设，其Until是广告结束非会员日期；旧aliases qianfan-token-plan、tencent-token-plan、tencent-tokenhub-cn、tencent-tokenhub仅映射新preset/region，不重复计服务。

## 测试阅读与限制

阅读代表测试：opencode_balance_test、planquota_test、claude_usage_saved_test、copilot_usage_test、cline_usage_test、plan_term_test；验证设计包括无网络的Zen、GLM局部失败、Claude账号目录隔离、Copilot小数/unlimited/overage、Cline404与拒绝区别、过期Codex claim和MiniMax计数方向。这里只静态阅读，未运行这些测试，不能据此标真实接入成功。
