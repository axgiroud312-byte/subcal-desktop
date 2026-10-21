# 全服务登录后自动权益（下一批）

2026-10-21 新界面批次：[正式界面规格](subcal-production-ui.md) 承接已有权益能力；用户明确保留旧 Magpie 订阅展示，新原型用于外壳及消费等页面。原 price 保持资料金额合同，逐笔付款、消费分类和预算按 [消费合同](../domain/spending.md) 独立扩展，不放开自动来源日期/额度编辑。本节是待实施衔接，不修改已有真实验证结论。

状态：接续 BE-012 / GitHub #4，已实施共享合同、只读适配器、来源接线与权益展示，正在按服务收口；真实账号范围及未完成项以 [交付记录](../evidence/full-service/acceptance.md) 为准，不把协议夹具通过当成真实账号验收。

## 用户目标

覆盖 Magpie 固定版本及社区插件的全部服务能力。登录或加入已发现账号后，自动展示实际可读取的套餐、会员有效期、续费状态、额度窗口、重置时间和余额。自动接入订阅只允许用户补录实际支付金额及币种；不再要求补录到期日、额度名称、单位、重置规则。供应商未提供的数据明确显示未提供，不推算成事实。

源码基线：Magpie `ba319a7587923fc7a4ea3859658244d591261a59`；社区插件 `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`。以完整清单确定覆盖，不能将代理支持的模型列表当成订阅查询能力。

## 数据与职责

- 账号身份、组织/工作区、凭据代次沿用现有模型。来源定位和秘密只进入系统加密存储；自动发现、授权、读取权益是一个连续流程。
- 扩展采集合同与持久化：会员有效期、是否自动续费、下一账期开始、窗口起止及重置、已用/剩余/总量、限额范围、模型分组、来源和观察时间。日期精度保留，不能用 Token 的 exp 充当会员有效期。
- 金额区分实际支付、供应商标价、账户余额、赠送余额、Key 预算、已用金额；不能互相覆盖。未知不是零。
- 固定协议适配器优先移植；社区插件提取登录与只读 usage 代码，不要求用户安装整套 Magpie，不运行代理、模型探测、签到领取、购买或创建会话来查询权益。
- 复用隔离采集、SQLite、持久调度、系统代理与刷新锁；外部客户端更新只能在同身份且本地代次未变化时接纳。查询失败保留上次值和时间，局部失败不覆盖其他成功项。
- 有用量能力的服务进入实施任务；只有代理/模型路由能力的服务进入明确缺口任务，产出可核验接口或不可读结论，不制造虚假的额度卡片。

## 展示合同

### 应用主动登录（2026-10-21 用户纠正）

用户在 SubCal 点击登录，应用打开供应商授权页；完成后自动保存账号、建卡并排队读取权益。发现已有客户端账号是快捷入口，不能代替应用主动登录；不要求用户在终端执行登录命令。

- 按固定上游协议移植 PKCE、设备码、本地回调或短信表单；Claude/Grok 由主进程后台编排官方 CLI，并使用隔离配置。缺少组件时明确提示安装，不静默安装。
- 令牌交换、回调校验、私钥与 state 位于主进程；Renderer 仅接收公开授权地址/设备码与状态。支持取消、超时、重复轮询幂等及切换服务后的旧响应隔离。
- 需要官方站点会话的流程使用独立、无 preload 的供应商登录窗口；只在固定允许来源执行主进程固定读取代码。关闭或完成后清理隔离会话。
- 仅已注册实现显示登录按钮；API Key 备选保留。静态授权不声称支持自动刷新，到期提示重新登录；凭据到期不作为会员到期。
- 逐服务协议证据与真实账号验收分别记录，见 [交付记录](../evidence/full-service/acceptance.md)。

参照 [权益卡片设计](../design/full-service-entitlements.md)，以服务分组、账号区分。卡片优先展示套餐与会员到期/续费、动态窗口和余额；不强制每项订阅都出现空的账单面板。历史曲线只使用实际观察，无历史时不画虚构趋势。

### 共享合同（#6，本地实现）

- `Field<T>` 保留来源、真实观察时间，并可携带 `evidence`（reported/derived/configured/cached）与 `providerAt`。读取缓存不重写 `observedAt`。未知、拒绝、未支持、缺项及局部失败均不能清空旧成功观察；旧观察按字段时间拒绝覆盖。
- `EntitlementDate` 为 `{precision:'day',value:'YYYY-MM-DD'}` 或 `{precision:'instant',value:'带偏移的 ISO 时间'}`；日期型不补时区。`entitlements.membershipExpiresAt`、`billingPeriodEnd`、`nextBillingStart` 各自独立；`autoRenew` 为 `Field<boolean>`，未提供保持未知。
- `Subscription.price` 只代表实际支付，`currency` 为该支付币种。供应商 `fields.price` 兼容输入被路由到 `entitlements.listPrice`，新适配器应直接提供 listPrice/listPriceCurrency；不得把余额、预算、消费写入 price。自动订阅仅允许编辑 price/currency 及 website/reminder/pinned/notes，断开或备份恢复后通过 `management:'automatic'` 保持保护；独立 archive 操作不受影响。
- `Metric` 保留旧 remaining/total/resetAt，并扩展 used/totalObservation、windowStart/windowEnd/resetObservation、windowMinutes、scope、models、poolId。NormalizedMetricObservation.used 仍接收字符串；落盘转为独立 `Field<string>`。每个真实窗口、模型范围/共享池都有稳定 id，不强制固定五小时或每周。
- `balances[]` 以 id/scope/kind/currency 区分；scope 为 account/key，kind 为 total/cash/grant/credit/budget/usage，amount 为 Field<string>，可附 expiresAt/poolId。不自动加总分项，不把 Key 无预算当账户无限资金。`credentialExpiresAt` 单独保存认证寿命，不进入会员日历。
- 会员截止只生成 expiry、额度重置只生成 reset；账期边界、下一账期、积分失效、认证过期不冒充上述事件或续费。日历事件携带 precision/dateSemantic；日期型无 instant，timezone 仅为用户日历展示设置。自动记录不按旧周期推算未来一年的扣费事件。
- SQLite schema v3 迁移前自动一致备份，旧 record_json 原样保留（已连接记录仅增加 management），指标历史新增完整 observation_json 并保存 used、精度、模型/范围/来源。JSON 备份写 v2，继续读取 v1/v2；恢复断开连接且不携带凭据。旧手动资料保持可编辑。

验证：合成后端/迁移/备份/日期规则测试；不代表新增服务协议或真实账号已验证。积分失效当前保留在余额观察中，不创建独立积分日历事件；扩展事件类型需同步日历 UI 合同，不能复用会员 expiry。

## 验收

每个服务分别记录源码核对、协议夹具、真实账号验证三种证据。真实 Electron 验证登录/加入后自动卡片、重启、自动更新、失效重登、工作区隔离、旧响应、失败保留。没有账号或平台条件写待验证。所有子任务完成不自动等于用户 accepted；总目标不自动关闭。
