# SubCal 绿色原型迁移：当前生效的界面依据

2026-10-21，状态：选型与实施设计已整理，代码待迁移。**用户最新纠正：保留旧界面的订阅展示。** 新原型用于应用外壳、首页、消费/统计、日历与设置；现有 Magpie 订阅卡片、列表及详情的外观、字号密度、额度条、账号分组、信息层级和交互继续保留。本文件不表示原型已实测。

用户最新纠正高于原型开发指令中“全部页面统一重做”的表述。保留是直接复用现有展示组件，不是只留下业务字段后重画成原型的大金额卡片。

## 原型依据

原型根目录：`C:/Users/niilo/AppData/Roaming/Open Design/namespaces/release-stable-win/data/projects/2516960e-a403-4d19-a0c8-425efa9c4cac`。

已核读 `开发指令.md`、`DESIGN-TOKENS.md`、`theme.css`、`styles.css`、`index.html`、`views.js`、`dialogs.js`、`theme.js`、`controller.js`、`app.js`；`data.js` 仅核对演示统计意图。数值以原型 theme.css 为准，布局/断点以 styles.css 最终声明为准。实施者开始时重新读取，避免原型变化后仍照抄本次快照。

## 开源组件选型

以下是当前 lockfile 实际版本，不为迁移盲目升级：

| 能力 | 采用与使用入口 | 实施方式 |
| --- | --- | --- |
| React 页面 | React/React DOM 19.3.1、TypeScript、Vite 7.3.7 | 复用 App、pages 和业务组件，拆页面级 React 组件 |
| 按钮、表单、菜单、弹层 | 已纳入源码的 shadcn/ui `base-mira` + `@base-ui/react` 1.9.0 | `components/ui/` 同源组件增加新原型 variants；订阅展示继续现有 variant，保留焦点、键盘、Portal |
| 主题样式 | Tailwind CSS 4.3.3 | `styles/tokens.css` 唯一数值源，`base.css` 只映射；不保留另一份运行时 theme.css |
| 图表 | Recharts 3.8.0 + 现有 shadcn Chart | AreaChart 消费趋势、PieChart 环形预算进度、Progress 分类；真实账本 selector 提供数据 |
| 功能图标 | Lucide React 1.60.0 | 常用 20px/stroke 2，紧凑处按原型；品牌图另用本地资源 |
| 动效 | Motion 14.4.0 + 现有 motion helpers | 新页面 150/230ms；旧订阅展开沿现有反馈；都尊重减少动效 |
| 通知 | Sonner 2.0.8 | 复用 Notify/NotificationContext；单次反馈和现有撤销入口 |
| 原有排序 | dnd-kit core 6.3.1/sortable 10.0.0 | 原有自定义顺序/键盘排序保留在相应卡片视图，调用 reorder |
| 校验和存储 | Zod 4.6.7、Electron 44.7.0、现有 SQLite 服务 | 复用严格 schema、IPC 白名单、事务、revision、迁移备份 |

组件 registry 沿用 `components.json` 的官方 shadcn `base-mira`；历史 CLI 接入版本见 component-adoption.md。新页面外观依原型，订阅展示依当前工程。已有 SQLite 使用 node:sqlite 的生产实现；不能因为安装了 Drizzle 就重写整个持久层。

本轮初始选型无需新增运行时 npm 依赖。全局搜索组合现有 Dialog/Input 和可聚焦结果；月历继续组合现有 CalendarPage 业务网格及日期规则；日期输入保留日期字符串。UI 临时状态用 React reducer/context，持久业务状态通过 client.snapshot/subscribe；不另设第二份缓存/业务库。

上述主要依赖为 MIT，Lucide 为 ISC；Nunito 为 SIL OFL。本地字体/品牌图随对应许可进入资源目录并更新 docs/assets.md，品牌图保留真实图形和独立衬底，深色不全局 invert。

## Token 和几何基准

以下原型数值适用于新外壳和新页面。订阅区域保持当前 `SubscriptionCard.tsx`、`SubscriptionsPage.tsx`、`DetailDrawer.tsx`、`EntitlementDetails.tsx`、`ui.tsx` 的展示；基线 `tokens.css` 为卡片内边距 12px、间隔 8px、圆角 10px、最小列宽 260px，字体/颜色/额度条等以当前源码及同内容基线截图为准。新侧栏占用宽度后允许自然减少列数，不拉伸或放大卡片来凑原型三列。

同一 tokens.css 保存新页面 `--sc-*` 和订阅角色值。以明确的订阅展示 variant/context 选择映射，保持旧字号、字重、色彩和控件密度；不得直接全局修改 bold/text-base/Card/Button 导致旧订阅一起变粗变大。复用组件而非复制整套 UI 库。订阅 Sheet/Dialog/Select/Tooltip 的 Portal 携带同样的展示标识，两套呈现仍由同一个 light/dark/system 偏好驱动。

原型 `--accent` 表示绿色主操作，shadcn 同名变量表示轻量选中底色。导入原型语义统一加 `--sc-` 前缀：`--primary → --sc-accent`，`--primary-foreground → --sc-accent-on`，`--accent → --sc-accent-soft`，`--accent-foreground → --sc-accent-ink`；其余遵循原型 DESIGN-TOKENS.md 映射。

| 角色 | 基准 |
| --- | --- |
| 浅色画布/面板/正文 | #f7f9fa / #ffffff / #26343b |
| 浅色主按钮/文字/厚底 | #58cc02 / #173800 / #429b00 |
| 深色画布/面板/正文 | #131f24 / #1d2d35 / #eef5f8 |
| 深色主按钮/文字/厚底 | #79d926 / #193000 / #4a9810 |
| 主字体 | 本地 Nunito；中文 Microsoft YaHei UI、PingFang SC、Segoe UI 回退 |
| 字号字重 | 新页面正文 16px，标题/控件按角色 700–900；base.css 按展示角色映射，订阅保留现有字重 |
| 按钮/卡片 | 新页面主按钮高至少 48px、16px 圆角、2px 描边、4px 厚底；新统计面板 20px 圆角；订阅展示沿旧版 |
| 外壳 | 232px 侧栏、80px 顶栏、32px 主留白；1199px 下侧栏 208px，1023px 下 80px 图标栏，767px 下菜单抽屉 |
| 页面 | 仪表盘主次双列约 1.75:1；订阅区域沿现有自适应网格/列表；日历＋288px 侧栏；设置 220px 分区导航＋最多 680px 内容 |
| 详情/首页 | 订阅详情沿现有 Sheet 尺寸与分区；新独立面板可参考 464px；首页 1160px 内容容器，双列主视觉 |

标题、卡片及真实数据允许增高/换行；长额度列表可渐进展开。不得缩小整页掩盖溢出。普通正文目标对比度至少 4.5:1，关键边界/焦点至少 3:1；必要修正集中在 Token，并记录相对原型的差异。首次实测前不声称已达标。

## 页面结构和状态

首页、仪表盘、订阅管理、消费管理、订阅日历、账号管理、偏好设置七入口，默认仪表盘，首页由品牌/辅助导航到达。侧栏和顶栏按原型保留，全局搜索支持 Ctrl/Cmd+K。页面筛选、月份、滚动和非秘密输入草稿按路由保存；主题不作为 React key。

账号页以生产 discover/add/login/refresh 等流程代替原型统一“未连接”。任何页面出现订阅展示都复用旧 Magpie 组件，尤其仪表盘“我的订阅”区域，不能用原型简化价格表替换。详情维持现有套餐、会员日期、全部额度窗口、余额/Key 预算、多账号、共享关系和来源/观察时间分区；最近付款在现有详情后渐进补充或链接到消费页。分类是独立本地属性；未知状态不变成零、取消或待手填。

业务状态覆盖加载、空数据、未知、过时、离线、部分成功、登录失效、保存错误及版本冲突。已有 Notify/Modal 规则继续有效，输入错误定位字段，服务失败保留填写内容。

主题读写仍用 Preferences.theme/setPreferences；html 同步 data-theme、.dark 和 color-scheme；system 跟随系统，顶栏切换到相反显式主题。旧订阅展示继续其对应浅/深主题角色，新页面使用原型配色，不新增用户侧的新旧界面切换。设置普通草稿与主题即时保存分开，避免后台 snapshot 刷新重置草稿。保存失败须可重试且不能假称持久成功。

## 明确的必要差异

订阅展示按用户最新要求保留当前 Magpie 实现，是对原型的明确偏离。首页示意卡使用当前真实记录/空态；示例数字只在显式开发预览出现。移除原型的“浏览器存储”“不提供登录”等演示说明，改为实际桌面能力。原型 forecast 的混合口径按 [消费合同](../domain/spending.md) 校正标签；自动续费保留 unknown；季度按日历月处理；提醒通道与提前天数分开。

验证入口与交付边界见 [迁移规格](../specs/subcal-production-ui.md)，不另建组件站、安装包或 CI。
