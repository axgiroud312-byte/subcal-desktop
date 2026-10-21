# SubCal 正式界面迁移规格

2026-10-21，状态：**本批开发完成，Windows Electron 实机检查通过；用户验收 pending**。基线分支 `feat/real-backend`，提交 `14d3314b616226b2dd299a9efb1267dc6c68c5fd`。任务入口：[SC-000](../issues/subcal-ui/SC-000.md)。实施结果与证据：[验证记录](../evidence/subcal-ui/report.md)。

## 目标与共同依据

在现有 Windows Electron 工程交付新原型的导航与消费等页面，**按用户最新纠正保留现有 Magpie 订阅展示**，完整走通添加账号或手动订阅 → 查看/编辑 → 记录付款 → 统计/日历 → 重启恢复。

以 [新视觉与组件方案](../design/subcal-green.md) 指向的当前原型为外壳和新页面依据；订阅卡片、列表、详情、额度条、账号分组与字号密度以当前工程为准。用户最新要求高于原型文件中冲突的全量重做指令。[消费合同](../domain/spending.md)、[账号规格](account-access.md)、[权益规格](full-service-entitlements.md)、[术语](../../GLOSSARY.md) 决定业务含义。旧 #37 的权益能力和 Magpie 订阅展示均继续复用；#38 的全服务真实账号验收继续独立记录。

## 页面 → 真实数据入口 → 缺口（源码核对）

| 页面/职责 | 已有实际入口 | 本轮结果 |
| --- | --- | --- |
| 首页/外壳 | `App.tsx`；snapshot/subscribe；统一 Notify/Modal | 已迁 232px 侧栏、80px 顶栏和产品首页；七入口、Ctrl/Cmd+K 搜索、页面状态与独立滚动保留 |
| 仪表盘 | OverviewPage、monthlySummary、upcomingSummary | 新仪表盘；月均成本/本月实付/活跃订阅/7 天事项，6 个月 Recharts 实付曲线，“我的订阅”直接复用旧 Magpie 卡片 |
| 订阅/详情 | SubscriptionCard、SubscriptionsPage、DetailDrawer、SubscriptionForm；create/update/archive/remove/undo/reorder | 原展示与 CRUD 保留；补本地分类、最近付款、记录付款入口；表格/详情仍在 `.subcal-magpie` 作用域 |
| 账号 | ConnectionsPage、AddSubscription；discoverAccounts/addAccount/startAccountLogin/... | 已接入新外壳与共享标题；真实发现/登录/Key 流程未改写；真实账号覆盖仍受凭据限制 |
| 消费/预算 | rules.decimal/decimalText；settings_and_assets；price | 新增 `payments` 表、CRUD/撤销/幂等、预算/统计币种/分类/工作区名；月均、计划、实付三口径分币种 |
| 日历 | CalendarPage；events → calendars.events → projectEvents | 续费/到期/试用/重置保留；记录付款标记与已付计划追溯；新增季度（三个日历月）和提前天数 |
| 提醒 | NotificationService、notification_deliveries | 新增全局 `reminderLeadDays` 与订阅级覆盖；通道/勿扰/静音/去重保留；external 仍未接通 |
| 偏好/备份 | Preferences、setPreferences、exportData/importPreview/importCommit | 分区设置页；主题 light/dark/system 即时保存并首屏预取；JSON v3 含账本，v1/v2 兼容，预览列删除付款数 |

现行事实：`database.ts` 每次 upsert 订阅同步一个 schedule_rules，但运行读取以 record_json 为准；billing_occurrences 仍没有运行时写入/读取，也没有金额，其级联删除不适合作付款历史归属。SQLite 已升到 schema v4（新增 `payments` 表），JSON 备份升到 v3。

## 模块协作

React 页面组合共享组件和 selector/ViewModel；ViewModel 保留原 Subscription/Field 引用与状态，不把未知变成裸值。唯一业务数据流为 UI → AppClient → IpcSubCalClient → 已有 IPC/Zod 白名单 → 主进程服务 → SQLite，事务完成后触发现有 subscribe 失效更新。

页面临时筛选/导航/草稿使用 React reducer/context，业务持久数据只由 Client 提供；不从原型 localStorage 迁入演示记录。新外观通过唯一 tokens.css 及显式 variants 更新，订阅展示保留旧角色映射（包括 Portal），避免全局字体/按钮/卡片修改污染旧展示；不复制原型 innerHTML/全局事件代码。保留显式 Mock 开发预览分流，并同步新增接口的预览实现，不让生产回退到 Mock。

已新增 `PaymentRecord`、付款读写/删除撤销方法、预算/统计币种/分类/工作区名以及提前天数字段；签名已贯通 shared/types、schema、bridge、主进程、Client 与显式预览实现。账本随 snapshot 返回，订阅失效统一触发页面更新，各页不维护第二份账本。

## 最小持久扩展

付款独立表保存原始十进制文本、来源/revision、订阅/主体和计划快照，不依赖 billing_occurrences 的级联；已支付的原计划在顺延后仍能追溯，发生项身份由原锚点与期次计算。

新增偏好复用 settings_and_assets，经 Zod 严格校验；分类是本地元数据，自动账号更新及字段白名单只允许修改该本地属性，不放开自动日期。旧记录分类默认其他，旧预算缺省未设置，旧付款账本空；不倒推历史。
付款＋可选手动顺延同事务；付款 revision、订阅 revision 和幂等结果同时保护。金额精确计算及跨币种边界按消费合同。季度在日历任务中贯穿 Cycle/schema/anchoredDate/月均折算/表单/备份，不能用 90 天代替。

迁移使用已有一致性备份机制。新 JSON 备份包含付款、计划关联/快照、预算及新增偏好；继续接受旧 v1/v2。旧备份恢复到已有账本时，沿用整体替换模式，但预览明确列出将删除的付款数量，不能静默丢账；提交前校验 preview 的资料 revision，事务整体替换。JSON 无凭据，恢复后自动资料仍受保护。

## 实施任务和依赖

| 任务 | 可独立检查的结果 | 真正前置 |
| --- | --- | --- |
| SC-001 | 新 Token/控件双主题与旧订阅展示隔离 | 无 |
| SC-002 | 七入口外壳、首页、导航/搜索和页面状态稳定 | SC-001 |
| SC-003 | 保留 Magpie 订阅展示并接入新外壳/付款 | SC-002、SC-005（分类/最近付款完整验收） |
| SC-004 | 新账号页保留发现、主动登录、查询和状态恢复 | SC-002 |
| SC-005 | 付款/预算/分类持久合同、幂等、备份恢复 | 无，消费合同已定义 |
| SC-006 | 仪表盘与消费页同一账本、准确统计与趋势 | SC-002、SC-005 |
| SC-007 | 本地月历/日程、付款关联、季度和可配置提醒 | SC-002、SC-005 |
| SC-008 | 完整设置页、主题可靠、全部生产偏好及备份入口 | SC-002、SC-005、SC-007 |
| SC-009 | Windows Electron 完整流程和视觉交付证据 | SC-001—SC-008 |

按外壳 → 既有订阅/账号 → 消费闭环 → 日历提醒 → 设置收尾 → 桌面验收连续推进。SC-003 可先迁既有 CRUD，付款分区在 SC-005 后完成；SC-005 与视觉基础可独立开发。父 Issue 是归属，不是子项的前置。共享类型/schema/规则/数据库归 SC-005 统一维护，SC-007 在其合入后扩展周期/提醒；公共 Token/组件归 SC-001。实际并行需隔离分支并遵守这些边界。

## 实施结果（2026-10-21）

- **代码**：新外壳/首页/仪表盘/消费/日历标题/账号标题/设置页已接入；旧订阅卡片、表格与详情保持在 `.subcal-magpie` 作用域，未改为原型价格卡。
- **数据**：SQLite v4 `payments` 表；JSON v3 备份；付款 CRUD、撤销、幂等、revision、付款＋手动顺延同事务；预算/分类/统计币种/工作区名/提前天数持久化。
- **统计**：`src/shared/spending.ts` 统一月均、计划、实付、分类、预算与日历付款标记；按币种分开，金额用 BigInt 定点。
- **检查**：`npm run typecheck`、`npm test`（305 项，1 项既有跳过）、`node scripts/backend-desktop-check.mjs`（6 项）与 `node scripts/subcal-ui-check.mjs`（14 项）通过；后者覆盖添加/编辑/归档外的手动订阅、付款顺延、补付、幂等、删除撤销、跨页一致、日历标记、分币种、预算、搜索/状态/滚动、浅深主题、960×640、备份 v3/v2、重启恢复与账号入口。
- **未完成**：真实供应商账号逐一验收仍受凭据限制；Google OAuth 未配置；Google/iCloud/EventKit 外部日历未接通；system 主题随 Windows 变化的实机切换未人工复核。用户验收 pending。

## 完成证据

运行 `npm run typecheck`；金额/日期/幂等/删除保留/迁移和备份使用 `tests/payments.test.ts`、`tests/backend.test.ts` 等扩展；账号迁移复用 renderer-entitlements/account-access 等适用测试；真实 Electron 使用 `scripts/backend-desktop-check.mjs` 与 `scripts/subcal-ui-check.mjs` 的隔离资料和重启机制。

外壳和新页面以相同逻辑窗口尺寸对照原型；订阅展示以当前旧版同内容截图和实际源码对照，检查字号、密度、额度条、账号分组及详情分区保留。覆盖 1280×820、960×640、当前 Windows DPI、浅/深/system、嵌套弹层、长中文/多额度、未保存输入及失败恢复。至少实际操作一条手动订阅、一笔付款、修改/删除/撤销、一次重启和一次备份恢复；月末、年周期、季度、跨币种和共享付款检查不能只靠截图。

正式数据空间初始空；截图用明确隔离数据。真实账号凭据缺失不阻断手动账本和界面；合成测试与真实授权结果分别记录。Google 登录缺 OAuth 配置，外部 Google/iCloud/EventKit 日历当前未接通，按实际状态呈现。原型未实测、本轮只立项，不复用旧证据声称新界面通过。

交付记录放 `docs/evidence/subcal-ui/`，说明修改/启动、实际接入状态、检查结果、数据迁移及具体外部阻塞。`npm run dev` 是当前入口。仅任务创建/编译/截图不等于验收；用户明确接受前不标 accepted。
