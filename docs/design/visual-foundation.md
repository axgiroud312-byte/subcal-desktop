# SubCal 视觉重做：Design Tokens 与组件约定

2026-10-21 真实后端批次补充：用户最新指示以 [FE-019](../issues/FE-019.md) 为准。正式桌面移除预览标记、模拟操作、组件示例与产品自述，保留必要业务状态；原文涉及“模拟/示例”常驻标记的规定仅适用于显式开发预览。布局、Tokens 与成熟组件方案保持沿用。

状态：FE-011 至 FE-018 已实施，并完成真实 Electron 功能及实施者视觉核对；待用户验收，不等于 accepted。日期：2026-10-20。实际版本/入口见 [component-adoption.md](component-adoption.md)，证据见 [visual-v2/checks.md](../evidence/visual-v2/checks.md)。  
任务入口：[FE-011](../issues/FE-011.md)、[Issue 索引](../issues/README.md)。

## 1 目标和依据

用户否定了第一版视觉，并要求实际研究 Magpie 的界面、源码、组件、信息层级及字重；本轮要求统一颜色、字体、间距、圆角等 Design Tokens，使用成熟现代的前端组件。

补充确认：用户需要实际接入并复用选定的组件。交付应包含真实的组件源码或依赖、页面使用点和可操作验收结果。当前选型更新为 Mira 紧凑风格 + Base UI，并落实 Motion、dnd-kit、Recharts 3；取代此前写定的 Radix 基础方案。

第一版具体问题：`styles.css` 的 `.quota-value` 普遍使用 20–22px / 700；`.quota-meter` 在卡片内再次铺底、描边；`SubscriptionCard.tsx` 将多条关系标签放在主要数值前；规则说明和示例后缀反复占据首屏。修正目标是可扫读、主次明确、交互一致。

本文件是 FE-011 至 FE-018 的共同设计依据。与 [frontend-first.md](../specs/frontend-first.md) 中旧的字号、尺寸、卡片展开方式、样式实现冲突时，本文件优先；业务语义、十二场景、桌面流程和模拟边界仍由该规格及 PRD 定义。Magpie 源码事实与本项目选型分别记录，不能把本项目的组件库说成 Magpie 使用的库。

## 2 组件技术方案

| 职责 | 本批采用 | 使用约定 |
| --- | --- | --- |
| UI 基础 | shadcn/ui 的 Mira 紧凑风格，使用 Base UI 版本 | 用当前 CLI / registry 的实际配置导入组件源码，记录风格参数；统一 variants |
| 样式与主题 | Tailwind CSS 4 + CSS 自定义属性 | Vite 接入；语义 Token 为唯一值来源，支持浅色 / 深色 |
| 交互基础 | @base-ui/react，通过对应 shadcn Dialog、AlertDialog、Popover、Select、DropdownMenu、Tooltip、Tabs、Collapsible、Switch 等组件使用 | 焦点、键盘、Portal 交给成熟基础；同一交互不混搭另一套 primitives |
| 交互动画 | motion | 用于多账号展开/收起等布局过渡；共享 Token 的时长、缓动和 reduced-motion，普通 hover 仍可使用 CSS |
| 拖拽排序 | dnd-kit | 实际接入概览卡片的指针与键盘排序，沿用现有顺序持久化与服务合同 |
| 应用图标 | lucide-react | 按需导入，统一 16px / 20px、strokeWidth 1.75；取代操作区 emoji |
| 反馈 | shadcn 对应的 Sonner 集成 | 复用现有通知入口；同一操作只反馈一次，错误仍能在所属区域查看 |
| 品牌资源 | 本地品牌 SVG / PNG + BrandIcon | 与操作图标分开；记录实际来源，缺少资源时使用统一文字后备 |
| 统计图表基础 | shadcn Chart + Recharts 3 | 实际接入 ChartContainer、Tooltip、Legend，提供可操作的组件示例；业务图表只使用有来源的数据，额度条使用 Progress |

React 19、TypeScript、Electron、Vite 是现有基础。实施时核对具体稳定版本的 peer dependencies，将实际版本写入 lockfile，记录 shadcn CLI / registry 来源；不通过 `--force` 或 `--legacy-peer-deps` 掩盖冲突。shadcn/ui 是可维护的组件源码，不是“一次安装就自动完成所有页面设计”。

官方依据：[Vite 接入](https://ui.shadcn.com/docs/installation/vite)、[主题 Token](https://ui.shadcn.com/docs/theming)、[Tailwind 4 / React 19](https://ui.shadcn.com/docs/tailwind-v4)、[Mira 紧凑风格](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)、[Base UI 成为新项目默认基础](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)、[Base UI 发布记录](https://base-ui.com/react/overview/releases)、[Recharts 图表](https://ui.shadcn.com/docs/components/base/chart)、[Lucide React](https://lucide.dev/guide/packages/lucide-react)。本轮核实时 Base UI 最新稳定版为 1.9.0（2026-10-09），实施时记录实际兼容版本。

实读 ZCode `3c5b227649371507ddc4eb46ac5133afe6db1cab` 的 [components.json](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/ui/components.json) 和 [package.json](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/ui/package.json)：其采用 radix-mira / Lucide，并声明 Motion、dnd-kit、Recharts 等依赖。本项目选择同类紧凑组件风格，并使用 Base UI 基础；不声称 ZCode 已采用 Base UI，也不照搬其全部依赖。

### 组件的实际使用与验收归属

| 组件能力 | 实际使用点 | 验收任务 |
| --- | --- | --- |
| Mira + Base UI 控件 | 四页工具栏、按钮、字段、菜单、Sheet、Dialog | FE-012 建立，FE-013 至 FE-017 迁移 |
| Motion | 概览多账号展开/收起的布局过渡 | FE-014，包含减少动效和焦点稳定 |
| dnd-kit | 概览订阅卡片的拖拽和键盘排序 | FE-014，包含取消、保存、刷新和重启恢复 |
| Recharts 3 | 共用图表组件，以及现有预览工具内的明确标记示例 | FE-012 接入，FE-018 核对主题、Tooltip、Legend、窄宽度及空数据 |
| Lucide | 导航、刷新、设置、菜单与状态的应用图标 | FE-012 定义，页面迁移实际采用 |

Recharts 的组件示例使用固定、标记为“组件示例”的数据，不能呈现为实际消费记录。后续业务图表使用已定义的数据合同；本次组件接入不推导不存在的 Token 或消费历史。无需为组件示例新建独立站点。

### 2.1 代码组织和迁移约束

- 建议新增 `src/renderer/styles/tokens.css`、`src/renderer/styles/base.css`、`src/renderer/components/ui/`、`src/renderer/lib/utils.ts`；配置 `components.json` 和指向 renderer 的导入别名。
- 当前 `components/ui.tsx` 是业务辅助组件。先保留明确的文件导入路径，逐步迁入领域组件位置；避免与新 `components/ui/` 目录的入口解析混淆。
- 主题最终作用于 `document.documentElement`，由现有偏好驱动，同步 `.dark` 与主题属性。Portal 到 body 的 Sheet、Dialog、Select、Tooltip 和 Toast 必须继承同一套变量。
- 旧 `.app` 变量只在迁移期映射到新 Token；旧全局 `button`、`input`、`[aria-pressed]` 样式要收敛作用域。处理 Tailwind layers 与未分层旧样式的优先级，不能用大量 `!important` 掩盖冲突。
- 页面只组合统一组件和业务组件；不各写一套按钮、弹窗、表单和颜色。保留必要的业务 CSS，例如月历布局，值仍引用 Token。
- 输入校验沿用现有 `service/validation.ts` 和服务错误，避免组件库引入第二套业务规则。日期选择仍以已有日期型字符串为合同，不额外进行时区转换。

## 3 Design Tokens 基线

以下是 SubCal 本批的实施初值，允许根据真实桌面检查在这一处统一校正，并记录理由。页面内不得各自调出第二套值。

### 3.1 语义颜色

| Token / 用途 | 浅色 | 深色 |
| --- | --- | --- |
| background | #F5F5F7 | #18181B |
| foreground | #202025 | #F4F4F5 |
| card / popover | #FFFFFF | #222226 |
| card-foreground / popover-foreground | 跟随 foreground | 跟随 foreground |
| secondary / muted / accent（控件底色、hover） | #F0F0F3 | #2C2C31 |
| secondary-foreground / accent-foreground | #52525B | #D4D4D8 |
| muted-foreground（辅助文字） | #686873 | #A1A1AA |
| border | #E4E4E7 | #3F3F46 |
| input（输入边界） | #8A8A94 | #71717A |
| primary / primary-foreground | #4F46E5 / #FFFFFF | #818CF8 / #18181B |
| ring（键盘焦点） | #4F46E5 | #A5B4FC |
| success-soft / success | #F0FDF4 / #166534 | #173124 / #86EFAC |
| warning-soft / warning | #FFF7ED / #9A3412 | #382718 / #FDBA74 |
| destructive-soft / destructive | #FEF2F2 / #B91C1C | #3A1D23 / #FCA5A5 |
| destructive-foreground（实底危险按钮文字） | #FFFFFF | #18181B |

状态名是语义用途，不能拿 success 代表“已连接真实服务”。普通信息和正常状态以中性样式为主；异常才提升颜色强度。低额度、过时、连接失败仍有文字说明，不能只依赖红绿差异。渐变和大面积彩色告警底不作为默认装饰。

接入图表时定义 `chart-1` 至 `chart-5` 与主题对应的序列颜色；图例、Tooltip 和空状态共用这一套映射。配额条继续使用 primary / warning / destructive / muted 语义。

### 3.2 字体、字重、数字

根字号采用 16px，下面字号转换为 rem；正文独立使用 14px 等值，不通过改根字号意外缩放组件库全部间距。Windows 优先 `Segoe UI Variable Text`、`Segoe UI`、`Microsoft YaHei UI`，macOS 回退系统字体 / `PingFang SC`；字体本地可用，不依赖在线字体加载。

| 角色 | 字号 / 行高 | 字重 | 应用 |
| --- | --- | --- | --- |
| 辅助信息 | 12 / 18px | 400 | 账号说明、来源、更新时间 |
| 标签 / 控件 | 13 / 18px | 500 | 字段标签、按钮、筛选 |
| 正文 | 14 / 20px | 400 | 说明、输入内容、表格 |
| 卡片标题 | 14 / 20px | 600 | 产品名、分组标题 |
| 窗口额度数值 | 14 / 20px | 600 | 额度行右侧，与标签同基线 |
| 主要余额 / 页面标题 | 18 / 26px | 600 | 钱包余额、当前页面标题 |
| 页面汇总 | 24 / 30px | 600 | 少数真正需要优先看到的总量 |

- 常规字重只有 400 / 500 / 600；业务 UI 不默认使用 700，不把全部数值放大成汇总指标。
- 金额、百分比、日期采用 `tabular-nums`，按语义对齐；不是强制全界面换等宽字体。单位、币种和“预计”保持可读，不能消失。
- 辅助信息不低于 12px；借鉴 Magpie 的层级关系，不照搬其 10px 小字。正常文字实际对比度目标至少 4.5:1，焦点和必要控件边界至少 3:1。

### 3.3 间距、圆角、尺寸和动效

| 类别 | Token 基线 | 使用约定 |
| --- | --- | --- |
| 间距 | 2 / 4 / 8 / 12 / 16 / 20 / 24 / 32px | 4px 为主节奏，2px 仅用于图标与细小对齐 |
| 圆角 | sm 6 / md 8 / lg 12 / xl 16px | 控件 md、卡片 lg、弹窗 xl；只对合适的徽标使用 full |
| 常规 / 宽松控件高度 | 32 / 36px | 图标 16 / 20px；独立图标按钮的点击区至少 32px |
| 卡片内边距 | 默认 16 / 紧凑 12px | 卡片内部用行、留白与必要分隔组织 |
| 卡片间隔 | 默认 12 / 紧凑 8px | 默认最小卡宽 300，紧凑 260；按实际内容区自适应 |
| 页面内边距 | 默认 24 / 窄窗口 16px | 表格溢出在自身容器处理 |
| 边框 | 1px | 普通卡片一层边界；额度行不另套背景卡 |
| 阴影 | card 为 none；popover 一档；dialog 一档 | 浮层阴影值集中定义，页面不逐项自造 |
| 层级 | 内容 / sticky / overlay / dialog / popover / toast | 集中管理；嵌套 Select 不被 Dialog 遮挡 |
| 动效 | fast 120ms / normal 180ms | hover、开合与状态切换；响应 reduced-motion |

圆角、字号与 Tailwind 默认 scale 的映射显式定义，不能仅修改 `--radius` 却保留其他不一致值。弹窗与抽屉以约 560 / 460px 为初始参考，宽度受可用窗口约束；重要操作不能掉出视口。

### 3.4 校正记录：2026-10-21 信息层级与文字密度

依据用户反馈（文字过多、呼吸感过重、字重与层级不清）并对照 Magpie 固定版本 `2374ffe1` 的 `app.css` 与用量页参考图实施，类型检查与规则/服务测试（17 项）通过，桌面 shell 检查通过：

- 新增第三级文字灰 `--faint`（浅色 #8A8A94 / 深色 #71717A），只用于时间戳等可牺牲辅助行；关键状态仍用 `--muted-foreground`。Magpie 用四级灰拉开层级，本项目此前只有两级，是"靠字重硬撑"的根因。
- 卡片 padding 16→14px、卡距 12→10px；概览行动区与汇总/筛选工具栏去白盒，改页面底色加一条下发丝线。
- 卡片产品名 600→500，600 保留给数值与每卡主角。Magpie 事实：产品名 12.5/600、窗口数值 10.5/600、主余额 15/600、汇总 20/600；本项目保留 12px 下限，不照搬其小字号。
- 卡片移除：每窗口"来源：…"行、页脚双字段来源行（合并为一行"X 前更新"）、"（非续费日）"后缀、卡内"示例"徽标（顶部"本地预览"全局标识仍在）、"周期费用与续费安排"标签、分项预告文字、共用付款/共享额度池关系徽章（详情抽屉已有完整表达）。
- 保留并就地可见：未知且不等于 0%、已过时、预计已重置待核实、低额度、待核对、疑似共享余额、连接异常。刷新按钮保留"模拟"文字但改为 hover/键盘聚焦显现（Magpie quota-refresh 模式），拖拽手柄同样处理。
- 汇总条修复"USD US$50.00"币种重复；长口径说明改为徽标 tooltip；行动区副标题与排序说明文字移除。
- 偏离既有规格的点：`frontend-first.md` 中"卡片页脚按字段展示来源"与"每卡示例徽标"按用户新指示收敛，完整来源仍在详情抽屉"来源与历史"分组。若用户复核要求恢复，以用户为准。

**术语统一（同日，用户指示）**：界面只保留两个计量词——订阅/编程套餐讲"额度"，API 钱包讲"余额/预算"。移除"代金券"（Kimi 改"充值余额/赠送余额"，与 DeepSeek 一致）、"共享积分"（改"会员额度"）、"窗口额度/额度窗口"（类型名改"订阅额度"，指标名按窗口实义命名如"5 小时额度/每周额度"）、"当前 Key 剩余预算"（改"剩余预算"）；wallet 类型名改"API 余额/预算"，按量续费说明改"按量余额/预算"。类型三分不变：订阅额度 / API 余额与预算 / 手动会员。

## 4 信息层级与组件应用

### 4.1 桌面壳

四项顶部导航：概览 / 订阅 / 日历 / 连接。导航用统一控件样式；预览标记短而常驻，新增操作是主要按钮。设置、场景等低频入口收拢。约 52–56px 导航区、1280×820 目标窗口、960×640 窄窗口按实际可用逻辑尺寸检查。

Magpie 同时支持顶部和侧栏；本批沿用本产品已确定的四项顶部导航，不把切换侧栏当作视觉改善的必要条件。

### 4.2 概览与卡片

阅读顺序：简短的近期事项 → 轻量汇总 / 筛选 → 产品卡片。事项最多三条紧凑行，正常状态不铺满横幅。金额按币种分列，共用付款去重规则照常生效。

卡片顺序：品牌与产品 → 账号 / 套餐 → 核心额度或余额 → 明确的续费 / 到期 → 来源与更新时间。额度用细 Progress 和紧凑数值；钱包突出主要余额；手动会员突出日期和金额，不补无意义的“额度无法读取”大块占位。

多账号默认完整展开一个，其他账号保留账号名、关键数值与必要日期摘要，点击再展开。同品牌不同产品仍分卡。付款与额度共享关系用克制的说明或详情入口表达，异常需要处理时就地提示。重置日期和续费日期始终明确区分。

每张卡保留可见的“示例”身份；同一作用域内不必每个数字重复“（示例）”。过时、未知、未提供、零值和已过重置点必须在对应字段附近可见，不能为简洁全部藏进 Tooltip。连接、刷新、同步按钮和成功反馈继续明确写“模拟”。

### 4.3 详情、表单、列表与日历

- 详情采用 Sheet；编辑采用 Dialog；未保存修改用受控 AlertDialog。父弹层不能因为连续 Escape 绕过未保存选择。
- 普通说明用 Field / description / Accordion；菜单用 DropdownMenu；状态用统一 Badge variants；局部错误关联字段，保存后回到可理解的位置。
- 订阅管理先采用 shadcn Table + 现有筛选和排序；现有规模无需额外引入复杂表格引擎。
- 月历是带订阅事件的业务视图，继续使用现有 MonthGrid / Agenda 规则；日期输入需要弹出选择器时可采用 shadcn Calendar（React DayPicker）。不能用日期选择器替换业务月历而丢失事件和同步操作。
- 同步预演采用结构化差异列表、阶段和局部失败反馈；Google / EventKit / CalDAV 的确认语义保留。
- 加载、空状态、错误、禁用、焦点均通过共享组件和 Token 表达，不为每个页面另造视觉语言。

## 5 验收与交付

1. 必须在真实 Electron 窗口评审正常、多账号、未知/零、过时、错误、空场景；深浅色切换时页面和 Portal 同步。
2. 明确回答：首屏先看到什么？每张卡最重要的信息是什么？哪些辅助信息按需展开？相同角色的字重和间距是否一致？
3. 检查 1280×820 与 960×640，记录实际可用逻辑尺寸和 DPI；当前 Windows 150% 缩放必须实测。布局允许滚动，但不允许整个页面横向溢出、关键日期被截断、浮层操作不可达。
4. 使用现有类型检查、规则/服务测试和桌面流程。完整回归在 FE-018 集中执行一次，子任务按受影响范围检查；修复后只重跑相关检查。不建立 Storybook、CI、安装包或大规模截图测试体系。
5. 旧截图保留作基线；新证据放 `docs/evidence/visual-v2/`。代表截图覆盖四页、两主题及窄窗口抽屉/表单/月历，检查记录说明场景、尺寸、DPI和实际结果。
6. 功能通过、视觉核对和用户验收分别记录。只有用户明确接受后才将父任务标记 accepted。

## 6 Magpie 研究锚点

固定版本 `2374ffe161439b02a8e7f23b793461b39a635bf8`：

- [卡片、账号渐进展开](https://github.com/yetone/magpie/blob/2374ffe161439b02a8e7f23b793461b39a635bf8/internal/gui/assets/app.js#L15236)：参考信息取舍。
- [卡片样式与字重](https://github.com/yetone/magpie/blob/2374ffe161439b02a8e7f23b793461b39a635bf8/internal/gui/assets/app.css#L813)、[汇总字重](https://github.com/yetone/magpie/blob/2374ffe161439b02a8e7f23b793461b39a635bf8/internal/gui/assets/app.css#L1062)：原项目产品名 12.5/600、主要余额 15/600、汇总 20/600；本项目采用第 3 节可读性基线。
- [导航形态](https://github.com/yetone/magpie/blob/2374ffe161439b02a8e7f23b793461b39a635bf8/internal/gui/assets/app.js#L23118)：支持顶部 / 侧栏，默认按宽度与用户偏好处理。
- [GUI 架构](https://github.com/yetone/magpie/blob/2374ffe161439b02a8e7f23b793461b39a635bf8/docs/subsystems/gui-shell.md#L18)：原生 HTML/CSS/JS 自研 GUI；不是 shadcn/ui。参考其信息组织，在本项目用成熟 React 组件落实。
