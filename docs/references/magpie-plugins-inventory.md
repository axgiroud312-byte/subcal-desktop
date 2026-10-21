# Magpie 社区插件：账号、套餐与用量静态清单

研究日期：2026-10-21。来源：`magpie-community/plugins`，固定提交 **`aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`**。本地核对目录：`C:/Users/niilo/AppData/Local/Temp/opencode/subcal-plugins-review`，已核对 HEAD。

**这是源码静态研究，不是 SubCal 已实现能力，也不是供应商真实账号验证结果。** 本次没有调用供应商接口、执行登录/刷新/签到、读取用户真实凭据或发送模型请求。下文 URL、字段和副作用描述的是参考实现。源码中的历史实测注释不等于本次验证。

## 范围、索引和解释规则

[registry.json L4–67](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/registry.json#L4-L67) 共 **33 项 = 20 个 provider 包（25 个 provider ID）+ 13 个非 provider 包**。另有 `packages/block-patterns`，没有注册。一个包不必等于一个服务账号；CN/Global、团队/个人、不同额度池不能合并余额。

20 包索引：[kimi-work](#kimi-work)、[zen-free](#zen-free)、[zcode](#zcode)、[qoder](#qoder)、[devin](#devin)、[zed](#zed)、[factory](#factory)、[grok](#grok)、[commandcode](#commandcode)、[mimo](#mimo)、[cursor](#cursor)、[kiro](#kiro)、[minimax](#minimax)、[workbuddy](#workbuddy)、[cline](#cline)、[trae](#trae)、[opendesign](#opendesign)、[raccoon](#raccoon)、[autoclaw](#autoclaw)、[codearts](#codearts)。另见 [Grok Bot](#grok-bot) 和 [非 provider](#non-providers)。

- 包名均为 `@magpie-community/opencode-<目录名>-auth`，provider ID 在各节列出。
- `until` 是参考输出的套餐有效期/当前付费周期结束；不自动等于下次扣款。`renew=auto/off` 只在有明确证据时记录。
- `resetsAt` 是参考输出的窗口时间；部分实现把试用、赠送桶的**失效日期**也放在这里，不能直接生成“额度补回”日历事件。`runsOutAt/runsOut` 才明确表示将失效的额度与数量。
- `used` 通常是百分比；`amount/limit` 才是数量。美元、credits、tokens、ACU 不可互换。源码的缺省零不是供应商确认零；失败、无字段、无套餐分别保留。
- `aside` 表示参考代理不拿该窗口阻断模型调用，不表示该额度无价值。SubCal 只需读取，不应为获得字段而复用推理、签到或领奖路径。
- 登录 token 的 `expires` 与订阅到期不同。各节“未知”指此提交没有可靠输出，不能从 token 到期或窗口长度推导。

## kimi-work

- **ID / 账号**：`kimi-work`；普通 Kimi 桌面版 Work，独立于 Kimi Code 和 Moonshot API。
- **凭据**：每次只读 `kimi-desktop/daimon-share/daimon/config.json`；Windows 根目录 `%APPDATA%`，macOS `~/Library/Application Support`，Linux `~/.config`。要求 `credentials.kimiCode.apiKey` 的 baseUrl 为 Work 网关，同时有 `credentials.kimiWeb.accessToken/userId`。名字叫 kimiCode 的内部字段不能据此归类为 Kimi Code。宿主只保存账号引用，不复制 token，不消费桌面 refresh token。
- **查询**：POST `https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`，Bearer **webToken**，空 JSON，Connect 头。模型 `/coding/v1/models` 是另一条 Work token 路径。
- **字段**：`subscriptionBalance.amountUsedRatio × 100` → 会员共享额度已用百分比；固定标题 `Kimi Work · 会员共享额度`。没有总量、余额单位数量、真实套餐档位、有效期、renew 或 reset 输出。
- **未知/副作用**：只读本机登录与远端统计；桌面应用切换账号会按 uid 校验拒绝原引用。缺少 ratio 时窗口为空，不能显示为零用量。
- **源码**：[packages/kimi-work/index.mjs L6–35、L128–135](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/kimi-work/index.mjs#L128-L135)。

## zen-free

- **ID**：`opencode-zen-free`。
- **凭据**：内置公共字符串 `public`，不是用户私密 API Key。
- **查询**：**没有账号用量请求**。`usage()` 直接返回 `{plan: "OpenCode Zen Free", windows: []}`。`https://opencode.ai/inference/v1` 是模型入口，`https://models.opencode.ai/api.json` 是目录，不是余额接口。
- **字段/未知**：无额度数量、余额、有效期、renew/reset。不能因为免费就填“无限额度”。
- **副作用**：单独 usage 无网络副作用；加载模型目录或调用模型是另外流程。
- **源码**：[packages/zen-free/provider.mjs L18–24、L63–68、L362–364](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zen-free/provider.mjs#L362-L364)；`index.mjs L1–3` 仅导出该实现。

## zcode

- **ID**：`zcode`；一个 ID 内有 Z.ai/BigModel 个人 Coding Plan、团队席位、ZCode Start/gift 多种路径。
- **凭据**：浏览器登录 Z.ai/BigModel、团队登录（org/project、账户 token 与席位 key）、导入 ZCode app 登录，或手填 GLM Coding Plan key。赠送计划需 ZCode JWT 与 device；只有 Coding key 不等于已获得赠送计划凭据。
- **查询**：个人 GET `<root>/api/monitor/usage/quota/limit`、`/api/biz/subscription/list`、`/api/biz/customer-package-reset/list?targetType=PERSONAL`；root 是配置 base 的 origin（默认 Z.ai `https://api.z.ai`；BigModel 默认模型 base 的 origin 为 `https://open.bigmodel.cn`）。团队 quota 加 `?type=2`，另 GET `/api/biz/team/subscribe/product/querySubscribeDetail`、reset list `targetType=TEAM`；团队 BigModel business root 改为 `https://bigmodel.cn`，含团队头。赠送 GET `https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=…`，待领取提示 GET 同目录 `/preview?app_version=…&platform=…`。
- **Coding 字段**：`level` → GLM Coding 档位；`limits[].percentage` 或 `usage - remaining` / `currentValue` → 已用数量和比例；`unit/number` → 窗口长度；`nextResetTime` 按毫秒。`TIME_LIMIT` 是 MCP 月工具调用，`aside`；`usage=0` 视为无 cap，不应推成耗尽。订阅仅取 `status=VALID`；`nextRenewTime` 按北京时区，`autoRenew` 判 auto/off；无自动续费时才从 `valid` 文本末日期补到期。
- **团队字段**：有效条件 `hasSubscription`、`status=EFFECTIVE`、`memberGrantStatus=VALID`；`productName` 与 `subscribeEndTime` → plan/until，参考输出 renew=off。个人/团队另列**可用重置次数及各自到期**，不是自动 reset 时间，也不自动消费重置券。
- **赠送字段**：`plans` 可同时多个 active；`ends_at`（秒）最早结束的活跃计划决定卡片标题/until，renew=off。各余额桶 `total_units/used_units/remaining_units`、`expires_at`（秒）、`entitlements.period` 或 period_start/end；桶 expiration 被放入 resetsAt，移植时应按**失效**保留。过期计划和桶过滤；模型范围独立，不能重复汇总 Coding 与 gift。
- **未知/副作用**：原代码读取后更新进程内路由缓存；领取预览只提示去 ZCode app，未自动领取。部分子请求失败被吞掉，只有部分字段不代表无订阅。credits 与 MCP 调用数量分开。
- **源码**：[packages/zcode/index.mjs L350–759（全部用量分支）](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zcode/index.mjs#L350-L759)；同文件 L26–30、94–100、333–340、1753–1789 为域名/登录。

## qoder

- **ID**：`qoder`、`qoder-cn`，不同站点订阅；另支持企业 VPC。
- **凭据**：Qoder 自有设备登录得到 device token/refresh token；也支持 PAT。普通设备登录的账户页使用 device token；**PAT 分支没有 device token 时，明确改用 PAT 交换所得 job/access token**，不是直接发送原始 PAT。VPC 使用账号对应实例地址。
- **查询**：GET `https://openapi.qoder.sh/sash/api/v2/me/usage`；CN 为 `https://openapi.qoder.com.cn/sash/api/v2/me/usage`。Bearer 为上述对应分支的 token，`Cosy-ClientType: 10`。VPC 会替换为实例 openapi 主机。
- **字段**：`displayMode=enterprise` 仅返回 Enterprise；`qoder` 解析 `qoderUsage.userType`、`expiresAt`（兼容 snake_case，RFC3339/秒/毫秒）。四类 `userQuota/addOnQuota/orgResourcePackage/dedicatedResourcePackages` 独立读取 `total/cap/used/remaining/name/unit`，默认 credits；百分比和文本数量输出。
- **未知**：没有 renew，也没有每个桶的 reset 输出。expiresAt 是账户页给出的套餐有效期，不能当每个池 reset。enterprise 无窗口不表示不限额。
- **副作用**：过期可 POST `/api/v1/deviceToken/refresh`，旋转并保存 token。另有 campaigns 查询和 `POST /sash/api/v1/me/campaigns/{id}/claim` 签到；签到会运行 Qoder 原生 runtime-info 身份程序，不能把这当纯用量读取的必要步骤。
- **源码**：[packages/qoder/index.mjs L1279–1506](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/qoder/index.mjs#L1279-L1506)；L1510–1525（CN）、L1660–1686（凭据选择）、L1890–1930（登录）。

## devin

- **ID**：`devin`。
- **凭据**：浏览器登录或 Devin CLI `credentials.toml` 的 `windsurf_api_key`；CLI 来源每次重新读取，读取失败保留存储值。server 可由 `WINDSURF_API_SERVER_URL` 或凭据配置改变。
- **查询**：POST `https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus`，key 在 JSON `metadata.apiKey`，不是通用 Bearer 请求；返回 `userStatus.planStatus`。还可能查询模型配置识别免费模型。
- **字段**：`planEnd` → until；`dailyQuotaRemainingPercent/weeklyQuotaRemainingPercent` → `100 - left`，reset 为 `dailyQuotaResetAtUnix/weeklyQuotaResetAtUnix`；`hideDailyQuota/hideWeeklyQuota` 遵从服务端。只有 quota billing 且 reset 存在时，省略的 share 才按 proto 零值“已用完”处理。`acuConsumed/acuLimit` → ACU 辅助窗口，planEnd 作为周期结束；`overageBalanceMicros / 1e6` → USD。
- **未知/副作用**：usage 不输出新 plan 名称，卡片沿用登录保存值；无 renew。免费模型以 notModels 排除。usage 保持 signIn 标记，即使拒绝也不自动清凭据；没有签到/消费步骤。
- **源码**：[packages/devin/index.mjs L1739–1830、L1861–1872](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/devin/index.mjs#L1739-L1830)。

## zed

- **ID**：`zed`。
- **凭据**：Zed 浏览器登录，`userId` 与 access token；账户请求头是 `Authorization: <userId> <accessToken>`，不应替换成模型用的 Bearer token。
- **查询**：GET `https://cloud.zed.dev/client/users/me`。
- **字段**：按当前有效组织选择 plan；`me.plan.subscription_period.ended_at`（RFC3339）→ until；`has_overdue_invoices` → 欠费暂停错误；free/空计划显示 No plan。
- **未知/副作用**：**不返回已用额度或窗口**，也没有 renew。组织失去套餐时可重新选择组织并保存 auth 中 org/plan；这是读用量伴随的本地状态变化。401 标记 expired，不能将欠费误判登录过期。
- **源码**：[packages/zed/index.mjs L1059–1108](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zed/index.mjs#L1059-L1108)；L158、L1164 登录/认证。

## factory

- **ID**：`factory`。
- **凭据**：Factory/WorkOS 设备码登录的 access/refresh 与组织，或 `fk-…` API key。API key 不刷新。
- **查询**：GET `https://api.factory.ai/api/billing/limits`；EU 为 `https://api.eu.factory.ai`，私有部署可按账号 premBaseHost 改 host，带 Factory 账号/组织头。
- **字段**：`limits.standard` 与 `limits.core` 各自 fiveHour/weekly/monthly：`usedPercent`、`windowEnd`（ISO 或 epoch **毫秒**）；5 小时/7 天/30 天是显示 span，不等于精确日历月。`extraUsageBalanceCents / 100` → USD；仅 `extraUsageAllowed=true` 且余额>0 时，将订阅窗口设 aside。
- **未知/副作用**：usage 没有 plan/until/renew 输出。standard/core 绑定不同模型，不能相加成统一额度。获取 fresh token 会刷新并持久化，组织被拒绝时可修复组织再请求；没有 standard 时报告不可读，不填零。
- **源码**：[packages/factory/index.mjs L927–1015](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/factory/index.mjs#L927-L1015)、[L1846–1870](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/factory/index.mjs#L1846-L1870)；L1912–1919 登录。

## grok

- **ID**：`grok`，这里是 **Grok Build CLI 账户**（registry 描述 SuperGrok/X Premium+），不是 Grok Bot，也不是 xAI 公开 API key 余额。
- **凭据**：Grok Build 设备码登录、复用当前 CLI 登录，或导入 CPA Grok JSON；读取 `GROK_HOME`（默认 `~/.grok`）下 `auth.json`，使用里面的 access token。
- **查询**：GET `https://cli-chat-proxy.grok.com/v1/billing?format=credits`，Bearer access token。
- **字段**：`config.creditUsagePercent`；优先 `config.currentPeriod.type/end` 决定窗口及 reset，无 currentPeriod 时用 `billingPeriodEnd`；end 仅接受 RFC3339。`onDemandUsed.val/onDemandCap.val` → on-demand 百分比（aside）。未输出美元余额或实际 credits 总量。
- **未知/副作用**：没有套餐有效期和 renew；billingPeriodEnd 是额度周期边界。可能出现 credits 0% 但请求 429，不能推导账号可调用。参考额外 rate-limit 窗口来自进程捕获的旧 429，没指定 reset 时使用 5 分钟本地 hold，这不是供应商订阅字段。刷新会运行 `grok models`，由 CLI 刷新并写自己的 auth.json；导入也写文件。SubCal 需明确选择自有授权或受控 CLI 刷新，不能宣称全程纯读取。
- **源码**：[packages/grok/index.mjs L710–792](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/grok/index.mjs#L710-L792)；L124、L168–187、L642、L898–937 为凭据和刷新。

## commandcode

- **ID**：`commandcode-plan`。
- **凭据**：Command Code 浏览器登录所得 key、只读 `~/.commandcode/auth.json`，或 Studio key。
- **查询**：GET `https://api.commandcode.ai/alpha/billing/subscriptions` 与 `/alpha/billing/credits`，账号 key。
- **字段**：subscription `planId/status/currentPeriodEnd/cancelAtPeriodEnd` → plan/until/renew；canceled、incomplete_expired 不视有效套餐。credits `windowLimits.fiveHour/weekly.used/cap/resetAt` → 百分比/reset。`credits.monthlyCredits/purchasedCredits/freeCredits` 是剩余美元 credits；参考按内置档位月额度估计池大小（`max(planMonthly, monthly) + purchased + free`），生成 Credits used/total；无订阅且无窗口时给 USD 余额。
- **未知/副作用**：固定档位月额度是实现估算，不是响应直接报告的 total，移植需保留来源。套餐查询缓存 10 分钟；慢/失败可用旧订阅或登录 plan，不能把缓存时间当最新确认时间。usage 可更新缓存和保存套餐元数据；没有自动续费扣款调用。
- **源码**：[packages/commandcode/index.mjs L412–428、L476–599](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/commandcode/index.mjs#L412-L599)；L1–6、L1308–1325 凭据及 usage 入口。

## mimo

- **ID**：`mimo-app`；小米 MiMo app 与同账号开放平台 Token Plan 分开。
- **凭据**：小米账号网页登录，保存小米凭据以签入 app，使用服务 session cookies；平台另建 cookies 缓存，不是把 app token 当开放平台 API key。
- **查询**：app base 为 `https://mimo-server-sgp.xiaomimimo.com/api`（另 RU/IN 对应 `mimo-server-ru`、`mimo-server-in`），GET `/user/xiaomi/subscription/self` 与 `/user/usage`。平台 GET `https://platform.xiaomimimo.com/api/v1/tokenPlan/detail` 和 `/tokenPlan/usage`。
- **app 字段**：`current.title/planTier/planCode` → plan，`endTime` → until；`renewalMode=MONTHLY/YEARLY` 为 auto，ONE_TIME 为 off。`usage.percent` 是**剩余**百分比，输出 100-percent；`resetDate` → 7 天窗口 reset。app 无时区时间按 UTC+8。
- **Token Plan 字段**：仅 `expired=false` 且 planName 有值才有计划；`currentPeriodEnd` 无时区文本按 **UTC**；`enableAutoRenew || hasAutoRenewSubscribed` 判 auto/off。合并 monthUsage.items 和 usage.items，优先 `month_total_token`，再 `plan_total_token`，读取 used/limit，参考显示单位为 **credits**（不能仅凭字段名写 tokens）。若有 app plan，该窗口 aside；app 请求不消费 tp-key 池。
- **未知/副作用**：读取失败可能只保留 plan 或省略 Token Plan；不能断言没有。会重建 app/platform session 并缓存/保存刷新状态，不涉及签到扣费。
- **源码**：[packages/mimo/index.mjs L534–626](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/mimo/index.mjs#L534-L626)；L14–20、169–176、406–416 为 host/time。

## cursor

- **ID**：`cursor`。
- **凭据**：自有浏览器登录、Cursor CLI 登录文件，或 Cursor API key 兑换 access token。CLI 文件 Windows `%APPDATA%/Cursor/auth.json`、macOS `~/.cursor/auth.json`、Linux `${XDG_CONFIG_HOME:-~/.config}/cursor/auth.json`；外部文件每次只读。API key 通过 POST `https://api2.cursor.sh/auth/exchange_user_api_key` 兑换，不是直接当 Dashboard JWT。
- **查询**：POST `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`、`GetHardLimit`、`GetPlanInfo`，Bearer JWT、Connect JSON。planName 缓存一小时。
- **字段**：`planInfo.planName`；`billingCycleEnd` 数字字符串按毫秒 → reset。`planUsage.autoPercentUsed/apiPercentUsed/totalPercentUsed` → Cursor Models、Other Models、Total；autoBucketModels 限定模型范围。On-demand 解析个人上限、成员上限和团队 pooledLimit/pooledUsed 等，部分字段以美分转 USD；支持 disabled/fixed/unlimited/unavailable，不能把无上限误显示零额度。
- **未知/副作用**：billingCycleEnd 仅窗口周期，不输出订阅 until/renew；enterprise 可能无 planUsage。token 兑换/刷新和缓存有状态；用量 POST 本身为读请求。Grok Bot 是此账号的附加查询，见下节。
- **源码**：[packages/cursor/index.mjs L254–292、L400–566](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/cursor/index.mjs#L400-L566)；L115–117（本机路径）、L2815–2833（合并读取）。

### grok-bot

**Grok Bot 关联 Cursor 账号，不新增 `grok` provider ID。** 可给它独立服务 Issue，但应注明复用 Cursor 身份和属于 Cursor 插件的证据。

- POST **`https://cursor.com/api/dashboard/get-sand-usage-status`**，JSON `{}`，Origin 为 cursor.com；从 Cursor JWT `sub` 提取用户 id，构造 `WorkosCursorSessionToken` cookie。不要收集用户真实 cookie 写入文档/日志。
- `includedLimitZero` 为 boolean 时 paid=`!includedLimitZero`，否则看 `hasNonZeroIncludedLimit===true`。
- 付费或有效 trial 且 `usagePercent` 为有限数值，才输出窗口；usagePercent clamp 0–100，单位百分比，**没有 credits/token 总量**。
- 付费 `nextResetTimestampUtc` → resetsAt，span=604800（周）。trial 由 `sandTrialExpiresAt` 是未来时间决定。
- **原实现只用 `sandTrialExpiresAt` 判断 trial，有效试用到期没有输出到窗口或 until**。未来 SubCal 若提取可保存为 trialEndsAt/失效事件，不能说原插件已经展示试用到期；付费也没有 renew。
- 窗口 aside，不影响 Cursor 模型额度。失败/无权限/未知权益返回空数组，不能声称 Bot 无额度。此请求是读状态，没有调用 Bot。
- **源码**：[packages/cursor/index.mjs L531–566](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/cursor/index.mjs#L531-L566)。

## kiro

- **ID**：`kiro`。
- **凭据**：Google/GitHub/AWS Builder ID/IAM Identity Center 自有登录；或读取 Kiro CLI/IDE 当前登录；或 `ksk_…` API key。保留 region/profileArn 与登录方式；外部来源不能笼统称为全程只读，见下项刷新副作用。
- **查询**：GET `https://management.<region>.kiro.dev/Get-Usage-Limits?origin=KIRO_CLI&profileArn=…&resourceType=CREDIT&isEmailRequired=true`，按账号方式生成 authHeaders；缺 profile 可能先列 profiles。
- **字段**：`subscriptionInfo.subscriptionTitle` → plan；每个 `usageBreakdownList` 的 `currentUsageWithPrecision/usageLimitWithPrecision` → credits 数量/比例；`nextDateReset` 优先条目，后根节点，单位 Unix 秒。active freeTrialInfo 单独读同名 precision 数量及 `freeTrialExpiry` 秒。
- **未知/副作用**：月窗口标 30 天，但实际 reset 取服务端。试用 expiry 被放 resetsAt，语义为失效而非补给。无套餐 until/renew。自有登录可刷新并保存 token；**外部 CLI 到期优先执行 `kiro-cli debug refresh-auth-token`，仍可后备自行 refresh 并 `saveBack` 写回来源**（L229–269）。所以完整 usage 链可能改外部登录文件/数据库，不能作为只读导入直接照搬。usage 不直接签到。
- **源码**：[packages/kiro/index.mjs L305–397](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/kiro/index.mjs#L305-L397)；L401–445、L1493–1505。

## minimax

- **ID**：`minimax-code`、`minimax-code-global`。
- **凭据**：MiniMax Code 自有设备登录，access/refresh；账号请求使用客户端签名，不能只复制一个 Bearer 头。保留 realUserID、个人 workspace、opGroupId。
- **查询**：账号 POST `/matrix/api/v1/user/get_user_extra_info` 和 `/matrix/api/v1/commerce/get_membership_info`：CN host `https://agent.minimaxi.com`，Global `https://agent.minimax.io`。quota GET `https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains` 或 `https://platform.minimax.io/v1/api/openplatform/coding_plan/remains`，Bearer + X-Group-Id。
- **字段**：只选 workspace_type=0；`has_token_plan/token_plan_tier/token_plan_expires_at` → M Plan/档位/until（秒或毫秒），否则 Free。`op_credit_summary.total_remaining_amount` 或 `opcredit_balance` → credits 余额。`model_remains` 中 interval/weekly remaining_percent → 已用，status=2 已耗尽、3 跳过；start/end 或 weekly_start/end 算 span/reset；general 主池，其余模型池 aside。
- **未知/副作用**：无 renew；M Plan 与签到 credits 并存，不能相加。token 自动刷新会保存；签到是独立 `checkin`（status/claim 接口），不是 usage 的一部分。
- **源码**：[packages/minimax/index.mjs L379–495](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/minimax/index.mjs#L379-L495)；L33–50（两站）、L755–801（usage/checkin 分离）。

## workbuddy

- **ID**：`workbuddy`（国内，CodeBuddy 套餐）、`workbuddy-ai`（国际）。
- **凭据**：浏览器登录或 WorkBuddy desktop 实时登录；token、uid、domain、企业上下文都参与认证。
- **查询**：POST `<endpoint>/billing/meter/get-user-resource-summary`；无窗口时补 `/get-enterprise-user-usage`；个人详情 `/get-user-resource-paid-packages` 和 `/get-user-resource-free-packages`（同 `/billing/meter/` 前缀）。endpoint CN=`https://copilot.tencent.com`，Global=`https://www.workbuddy.ai`，**没有 /v2 前缀**。详情传 PackageCodes、分页和日期过滤。
- **字段**：summary Packages 的 `CycleTotalCapacity/CycleUsedCapacity` 汇总 credits；plan 优先已存 plan，否则 IsPaidUser 判 Pro/Free。企业 `limitNum/credit` 为 limit/used，`cycleResetTime/cycleStartTime` 按 UTC+8 → reset/span。
- **失效**：详情 `DeductionEndTime` 毫秒，后备 ExpiredTime/CycleEndTime；以 `CycleCapacityRemainPrecise` 或 CycleCapacityRemain 找最早剩余额度失效，输出 runsOutAt/runsOut；排除 daily slice 和摘要未统计包。
- **未知/副作用**：不输出套餐 until/renew（即使详情请求 NeedRenewInfo=true）。最早积分失效不是订阅到期或全部积分 reset。可刷新并保存自有 token；补读实时模型以排除 x0 免费模型。详情最多每类 10 页×200，失败使失效时间未知，不清空已知 credits。
- **源码**：[packages/workbuddy/index.mjs L1144–1152、L1232–1351](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/workbuddy/index.mjs#L1232-L1351)、L1651–1694。

## cline

- **ID**：`cline`。
- **凭据**：Cline/WorkOS 设备码登录或 Cline API key；OAuth 单次 refresh token 需要串行刷新并持久化。
- **查询**：GET `https://api.cline.bot/api/v1/users/me`、`/users/me/plan/usage-limits`、`/users/{id}/balance`；Bearer。id 依次从 clineUserId/subject/id/登录 uid 选择，不可随意认定一个字段。
- **字段**：me 的 plan/planType/planName/membership/tier；ClinePass `limits[].type` 为 five_hour/weekly/monthly，`percentUsed/resetsAt` → 三窗口。余额优先 `{balance}` 数字/数字字符串，单位为**百万分之一美元，除以 1e6**（L678–685），再尝试 credits 的 total/used/remaining 等兼容字段；有总量才算比例，没有总量仅显示余额/已用。
- **未知/副作用**：无套餐 until/renew；credit parser 的 resetAt/resetTime/nextResetAt/renewsAt/**expiresAt** 兼容读取不能证明都是补给时间。404 limits 表示没有 ClinePass，其他失败显示错误且保留可读的另一部分。读取可能刷新、保存 token；不自动充值或签到。
- **源码**：[packages/cline/index.mjs L695–773](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/cline/index.mjs#L695-L773)、[L939–975](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/cline/index.mjs#L939-L975)；L847–920（刷新）。

## trae

- **ID**：`trae-cn`、`trae-global`，实验性；不同部署/区域独立。
- **凭据**：Trae 自有浏览器登录，token/refresh、uid、region；有设备绑定/企业上下文，使用 ideHeaders，不是任意网页登录 cookie。
- **查询**：CN POST `https://api.trae.cn/trae/api/v2/pay/ide_user_ent_usage`，`{require_usage:true, req_source:0}`。Global POST `https://api-sg-central.trae.ai/trae/api/v1/pay/user_current_entitlement_list` 或 US `https://api-us-east.trae.ai/...`，空 JSON。国际 auth host 的旧 pay 路径不是这条用量路径。
- **CN 字段**：所有 `user_entitlement_pack_list` 中 quota.credits_limit、usage.credits_amount 汇总；limit=-1 为 unlimited；最早 end_time/expire_time 作为窗口 resetsAt。plan 仅 is_credits_billing ? Credits : Free。
- **Global 字段**：取第一个有 usage/quota 的 entitlement pack；basic_usage_limit+bonus_usage_limit 为总 USD、basic_usage_amount+bonus_usage_amount 为 used；display_desc 为 plan；end_time → reset。
- **未知/副作用**：未输出套餐 until/renew；CN 聚合池最早 expiry 与 Global 首包 end 都不能概括为所有权益续费。token 可旋转并保存；CN 原生签到 status/claim 是独立动作，usage 仅 POST 查询。静态代码无法证明国际所有区域、企业租户和多包聚合完整。
- **源码**：[packages/trae/index.mjs L116–238](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/trae/index.mjs#L116-L238)、[L2461–2498](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/trae/index.mjs#L2461-L2498)；L2673–2690（入口）。

## opendesign

- **ID**：`opendesign`，Open Design Cloud。
- **凭据**：自有设备登录同时获得 runtime key 与 **control key**；运行时 API key 不足以读套餐。control 可在 auth.control/metadata.control，或明确 `vela_ctrl_` key。
- **查询**：GET `https://amr-api.open-design.ai/api/v1/workspaces/current` → activeWorkspaceId/workspaceId；GET `/api/v1/workspaces/{id}/billing/preflight`、`/api/v1/billing/summary`，control key。模型 host amr-link 不负责账户统计。
- **字段**：summary.membershipTier → Design Plan；subscriptionCurrentPeriodEnd → until；有 subscriptionStatus 时，subscriptionCancelAtPeriodEnd 判 off/auto。preflight.balanceUsd（后备 summary.balanceUsd）为 USD；codingPlan.windows 的 usedCredits/limitCredits/durationSeconds/resetsAt → credits、窗口 span/reset（常见 5 小时/7 天）。
- **未知/副作用**：eligible=false 表示请求改消费钱包，不能把无套餐额度解释为无余额。workspace 缓存 10 分钟；key 不自动旋转，读取没有领奖。summary 不可读时 expiry/renew 未知；API key 登录返回明确“需要 account sign-in”错误。
- **源码**：[packages/opendesign/index.mjs L180–247](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/opendesign/index.mjs#L180-L247)、[L379–420](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/opendesign/index.mjs#L379-L420)；L60–66（key 区分）。

## raccoon

- **ID**：`raccoon`，商汤小浣熊。
- **凭据**：浏览器登录或只读桌面 `~/.box-agent/config/auth.json`（支持源码配置目录覆盖）；desktop 来源不消费其 refresh token，浏览器来源可自有刷新。
- **查询**：GET `https://xiaohuanxiong.com/api/web/points/v1/balance`、`/api/web/auth/v1/entitlement_info`、`/api/web/points/v1/bills?paging.limit=1000&paging.offset=0`，必要时 limit=5000；mainOrigin 可配置。bills 的 offset 不被参考上游有效支持，不能声称全量无限分页。
- **字段**：`available_points` → credits；entitlement.office（后备 code）的 pro_enable、active_plan.type/plan_type → plan；pro_expired_time 或 active_plan.subscription_expired_at → until。仅未过期正积分账单求 granted；granted>=当前余额时才推 used/limit，否则只展示余额。最早 expire_at 的正积分和与余额取 min，输出 runsOutAt/runsOut。
- **未知/副作用**：无 renew/自动 reset。账单推算总授予额和将失效量不是服务端直接提供的精确未消费批次，尤其截断到 5000 条时要标估算/不完整。usage 可刷新浏览器登录但不领奖；独立 checkin 路径可触发 desktop onboarding grant 与每日签到，应与读取拆开。
- **源码**：[packages/raccoon/index.mjs L483–573](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/raccoon/index.mjs#L483-L573)、L613、L983–1028。

## autoclaw

- **ID**：`autoclaw`、`autoclaw-cn`（智谱 AutoClaw/澳龙/OpenClaw 云账号）。
- **凭据**：国际 Google/z.ai 网页登录，CN 手机验证码，得到 access/refresh；业务请求使用 bizHeaders（含 X-Authorization）。
- **查询**：GET `https://autoglm-api.autoglm.ai/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw`；CN 首选 `https://autoglm-api.zhipuai.cn` 同路径。失败可回退另一 host。另 GET `/autoclaw-proxy/proxy/autoclaw-task-list` 读取 daily_signin 状态。
- **字段**：total_balance → 四舍五入积分余额；wallets 的 balance/display_name/public_wallet_type → 最多三个可见非总额子钱包，均 aside；签到 status/reward 是状态展示，不是已用百分比。
- **未知/副作用**：无套餐 plan、until、renew、reset 或真实 used/limit。**`signinOnUsage=true` 且 signin 开启时，usage 会触发 POST `/autoclaw-proxy/proxy/autoclaw-task-complete`，body task_id=daily_signin/source_id=autoclaw，再重读状态；默认 signinOnUsage=false。** refresh 也进入 maybeSignin。另有宿主原生 checkin。不能无条件移植原 usage 并宣称只读。
- **源码**：[packages/autoclaw/index.mjs L329–388](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/autoclaw/index.mjs#L329-L388)、[L692–745](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/autoclaw/index.mjs#L692-L745)；L430–455（开关默认）、L593–595（refresh）。

## codearts

- **ID**：`codearts`，华为云码道；非官方适配。
- **凭据**：华为云 OAuth → STS 临时 AK/SK/security-token 与 refresh token；请求用 SDK-HMAC-SHA256 签名，不是 Bearer API key。自有凭据刷新必须保留轮换代次。
- **查询**：GET `https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/statistics/plugin`；免费池 GET `https://opengw.developer.huaweicloud.com/api/v1/user/tokens/balance`。批次 POST SNAP host `/snap-manager/v1/package/credit/page`（查询语义），GET `/v1/ops/credit/overview`，以及 `/v1/ops/credit/campaign/{id}?pageNum=1&pageSize=100`；批次缓存 10 分钟。
- **字段**：package.package_name_cn/package_name_en/spec_code → plan；metrics 中 usageTotalPackageCredit/usageBasicPackageCredit/usageOnDemandPackageCredit/usageBonusPackageCredit 的 package_credit_amount/remain → credits limit/used。仅总额参与主额度，分桶 aside，不能重复求和。
- **reset/失效**：基础套餐批次 packageType=basic 的 expiredTime 最早未来时间作为月 reset，后备 statistics.end_date；只总额/基础桶用此 reset。其余批次 creditAmount-creditUsed、活动 claimedAmount-consumedAmount-expiredAmount、expireAt → 最早 runsOutAt/runsOut。批次读不到时可用本地签到 ledger（30 天 grant）后备，必须标明推算来源。免费池 daily_token_limit/daily_tokens_used 单位是 **tokens**，reset 是代码计算的下一个北京时间零点，span=86400，aside，按 benefit 模型分组。
- **未知/副作用**：没有套餐 until/renew；end_date 是参考额度 reset，不可直接作为订阅终止。usage 本身读取统计/批次/本地 ledger，没有签到；独立 checkin 会领取并写 ledger，推理流程还有免费 benefit 领取路径，不能为了用量去加载完整推理链。usage 钩子拿当前凭据，刷新由宿主/其他钩子协调，不能宣称它自己处理全部到期重试。
- **源码**：[packages/codearts/index.mjs L1433–1467](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/codearts/index.mjs#L1433-L1467)、[L1801–1934](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/codearts/index.mjs#L1801-L1934)、[L2123–2167](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/codearts/index.mjs#L2123-L2167)。

## non-providers

以下 13 项均在 registry L43–67，不应创建成“供应商余额接口”。包名统一前缀 `@magpie-community/`：

| registry 包名（省略前缀） | kind | 源目录 | 用途 |
| --- | --- | --- | --- |
| middleware-param-override | middleware | packages/param-override | 请求字段设置、删除、移动、改写 |
| middleware-model-map | middleware | packages/model-map | 模型名称映射 |
| middleware-system-prompt | middleware | packages/system-prompt | 注入系统提示词 |
| middleware-word-guard | middleware | packages/word-guard | 词/模式拒绝与替换 |
| middleware-think-tags | middleware | packages/think-tags | 思考标签和正文转换 |
| middleware-antigravity-cloak | middleware | packages/antigravity-cloak | Antigravity 请求提示词适配 |
| middleware-codex-history | middleware | packages/codex-history | 切换上游后的 Codex Responses 历史过滤 |
| agent-aider | agent | packages/aider | 配置 Aider 使用 Magpie 模型 |
| agent-type4me | agent | packages/type4me | 配置 macOS Type4Me 后处理模型 |
| middleware-reserve | middleware | packages/reserve | 额度保留与订阅优先路由策略 |
| tools-calc | tools | packages/calc | 本地算术、单位和日历计算 |
| page-usage | page | packages/usage | 读取 Magpie 自己的调用/错误/token/费用摘要，不是远端供应商余额 |
| agent-kimi-desktop | agent | packages/kimi-desktop | 普通 Kimi desktop Work 的模型接入与恢复；不是 kimi-work provider 本身 |

另有 [packages/block-patterns](https://github.com/magpie-community/plugins/tree/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/block-patterns)，**不在本次 registry**；不能把它算作第 34 个已注册项。目录里的测试、模型转换、SDK 适配也不是新增服务。

## 给后续服务 Issue 的证据边界

各服务 Issue 可直接链接本文件对应英文标题锚点，固定上游代码链接不要改成 main。验收至少区分：凭据来源/账号区域、查询成功但字段缺失、登录失败、部分子查询失败、缓存或估算字段、额度 reset 与余额失效、试用到期与续费状态。尚无真实响应验证的字段保持“静态确认/待账号验证”，不要标记生产可用。

特别关注：Grok Bot 的试用到期尚未输出；Kimi Work 只有百分比；Zen Free 没有远端用量；Zed 只有套餐期；AutoClaw 开关可使读取签到；Raccoon/Command Code 存在额度推算；CodeArts credits 与免费 tokens 两种单位；Mimo app UTC+8 与 Token Plan UTC 不同。

## 许可证与来源记录

上游 [LICENSE L1–21](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/LICENSE#L1-L21) 为 **MIT**：`Copyright (c) 2026 magpie-community contributors`。本文件是研究记录，未引入插件运行时。后续移植代码须沿用项目既有 third_party/来源映射流程，保留此版权及完整 MIT 许可/免责文字；现有 `Magpie-LICENSE.txt` 不能自动替代社区插件的权利人声明。Qoder 还带 [packages/qoder/LICENSE-CLIProxyAPI](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/qoder/LICENSE-CLIProxyAPI)，移植相关部分一并保留。

本次唯一写入文件：`docs/references/magpie-plugins-inventory.md`。没有修改凭据、运行时代码、第三方许可证文件或发布 Issues。
