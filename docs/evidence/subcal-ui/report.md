# SubCal 绿色工作台与付款账本：实施与验证记录

日期：2026-10-21。范围：GitHub 总目标 #43（SC-000）及子任务 #44—#52。分支：`feat/subcal-ui-ledger`。用户验收：**pending**。

## 启动与入口

```powershell
npm install
npm run dev
```

- 开发态数据目录：`%APPDATA%\SubCal-Development`（可通过 `SUBCAL_USER_DATA` 指向隔离目录）。
- 默认进入仪表盘；侧栏可到订阅管理、消费管理、订阅日历、账号管理、偏好设置；品牌/辅助导航到产品首页。
- `Ctrl/Cmd+K` 打开全局搜索；顶部切换统计币种与深浅色。

## 实际修改

### 外壳与新页面

- `src/renderer/App.tsx`：232px 侧栏、80px 顶栏、七入口、独立页面滚动、搜索、付款弹层与非秘密页面状态保留；窄窗口折叠为图标栏/抽屉。
- `src/renderer/pages/HomePage.tsx`：产品首页，展示真实记录/空态，不使用演示账单。
- `src/renderer/pages/DashboardPage.tsx`：月均成本、本月实付、活跃订阅、7 天事项、6 个月实付曲线、近期计划、迷你日历；订阅区域直接复用 `SubscriptionCard`。
- `src/renderer/pages/ExpensesPage.tsx`：月份切换、三口径统计、预算双口径进度、分类流向、付款明细筛选/分页/编辑/删除/撤销。
- `src/renderer/pages/SettingsPage.tsx`：分区设置、主题即时保存、密度/额度显示/时区/托盘/勿扰、工作区名、统计币种、月度预算、分类、提前天数、备份导出/预览/恢复。
- `src/renderer/components/PaymentForm.tsx`、`SearchDialog.tsx`、`MiniCalendar.tsx`：付款表单、全局搜索、迷你月历。
- `src/renderer/components/DetailDrawer.tsx`：新增“本地分类与最近付款”分区和记录付款入口，原权益/额度/账号分区保持。
- `src/renderer/components/SubscriptionForm.tsx`：新增本地分类、订阅级提前天数、季度周期选项。
- `src/renderer/pages/CalendarPage.tsx`：付款标记、已付计划追溯（顺延后仍显示原计划付款）、季度按三个日历月。

### Token 与样式隔离

- `src/renderer/styles/tokens.css`：新增 `--sc-*` 原型语义、Nunito `@font-face`、`.sc-ui` 映射与 `.subcal-magpie` 旧订阅角色恢复。
- `src/renderer/styles/shell.css`：外壳与共享页面几何。
- `components/ui/button.tsx`：新增 `tactile` / `tactile-soft` 变体与 `tactile` 尺寸，不改旧 variant。
- 旧订阅卡片、表格、详情和其 Portal 继续使用原字体/字号/颜色/12px 内边距/8px 间距/10px 圆角；新页面才使用 Nunito、16px 圆角与绿色厚底按钮。

### 真实数据能力

- `src/shared/types.ts`、`schema.ts`、`bridge.ts`：`PaymentRecord`、付款 CRUD/撤销 IPC、预算/分类/统计币种/工作区名/提前天数、季度周期、订阅分类与提醒覆盖。
- `src/main/db/database.ts`：SQLite schema v3 → **v4**，新增独立 `payments` 表（无订阅外键）、索引、旧记录分类默认值；迁移沿用 `VACUUM INTO` 一致性备份。
- `src/main/service.ts`：付款创建/修改/删除/撤销、幂等键复用、revision 冲突、未来日期拒绝、付款＋手动顺延同事务、自动来源拒绝顺延、JSON v3 导出与 v1/v2/v3 导入、预览删除付款数。
- `src/shared/spending.ts`：月均、计划、实付、分类、预算、日历付款计数、稳定发生项身份与精确金额展示。
- `src/main/notifications.ts`：全局 `reminderLeadDays` 与订阅级覆盖，保留通道/勿扰/静音/去重。
- `IpcSubCalClient`、`MockSubCalClient`、`client.ts`：完整接入生产 IPC 与显式预览实现。

## 数据库与备份影响

- **SQLite**：启动时自动从 v3 升到 v4；升级前生成一致性备份（`backups/subcal-backup-pre-v4-*.sqlite`）。`payments` 为新增表，不迁移旧 `price` 为历史付款。
- **JSON 备份**：导出 `schemaVersion: 3`，新增 `payments`；继续接受 v1/v2。导入仍为整体替换，预览显示付款数量及将删除的当前付款数；提交校验文件 hash 与资料 revision；失败不半写。
- **凭据**：JSON 备份与页面快照不含 secret/API Key/access token；凭据仍由系统加密保存。
- 旧记录：分类默认“其他”，预算默认未设置，账本为空；不倒推历史。

## 执行过的检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 305 项，304 通过、1 项既有跳过、0 失败（含新增 `tests/payments.test.ts`） |
| `node scripts/backend-desktop-check.mjs` | 6 项通过：真实 IPC/空库、手动订阅、版本冲突与撤销、凭据保护、四页/设置/最小窗口、重启恢复 |
| `node scripts/subcal-ui-check.mjs` | 14 项通过：见下 |
| `npx vite build` | 通过（产物不提交） |

`scripts/subcal-ui-check.mjs` 的 14 项：

1. 空库默认仪表盘，七入口可达且无演示账单
2. 手动添加订阅并保留 Magpie 表格展示
3. 记录付款并顺延一期：金额、计划关联与下一期正确
4. 补付、幂等键与版本冲突：一笔请求只落一笔
5. 消费页与仪表盘同一账本，编辑/删除/撤销同步
6. 日历标记付款、季度周期与月末锚点
7. 分币种独立统计，未知不会变成零
8. 预算在设置页保存、跨页生效并重启保留
9. 搜索、页面状态与滚动位置保留
10. 主题切换、system 解析与订阅展示隔离（含 12px/8px/10px/260px、旧字体栈、旧深色卡片底色断言）
11. 960×640 七页无整页横向溢出
12. 删除订阅保留历史付款；备份 v3/v2 往返、预览删除数与无凭据
13. 真实重启后订阅、付款、预算与主题仍在
14. 账号页与添加账号入口显示真实空态与流程

## 视觉核对

- 新页面在 1280×820、960×640 与当前 Windows DPI 下截图；浅色/深色均有记录。
- 旧订阅展示没有修改前的同内容截图可直接引用；本轮以源码角色值与运行时计算的样式断言作为基线：卡片内边距 12px、内容间距 8px、圆角 10px、网格最小列宽 260px、非 Nunito 字体、深色卡片 `#222226`。新侧栏使可用列数自然减少，未放大卡片。
- 订阅页新增“卡片 / 表格”切换；卡片视图重新接入原 `SubscriptionCard` 与 dnd-kit 排序，Alt+方向键排序已实测并写回 `preferences.order`；表格仍为默认视图。
- 已知差异：订阅页工具栏沿用旧 Magpie 样式（在 `.subcal-magpie` 内），与绿色外壳并置会看到按钮颜色不同；这是“保留旧订阅展示”的直接结果。订阅表格在 1280 宽度下需要内部横向滚动。
- 日历页的细部仍沿用既有业务网格样式，只套用了新外壳与绿色语义 Token。

## 截图

`docs/evidence/subcal-ui/`：

- `01-dashboard-empty.png`、`02-detail-magpie.png`、`03-dashboard-payment.png`
- `04-expenses.png`、`05-expenses-after-undo.png`
- `06-calendar.png`、`07-expenses-cny-budget.png`
- `08-settings.png`、`09-search-state.png`、`09b-subscription-cards.png`、`10-dashboard-dark.png`
- `11-仪表盘-960.png`、`11-订阅管理-960.png`、`11-消费管理-960.png`、`11-订阅日历-960.png`、`11-账号管理-960.png`、`11-偏好设置-960.png`、`11-产品首页-960.png`
- `12-restart.png`、`13-accounts.png`
- `backend/`：既有桌面回归截图（1280/960 四页、账号流程、设置）与 `desktop-report.json`
- `desktop-report.json`：本次 UI 检查的机器可读结果（`pageErrors: []`）

## 真实接入 vs 仅界面

- **真实接入**：订阅 CRUD、付款账本、预算/分类/偏好、日历投影、备份导出导入、主题、托盘摘要、账号发现/添加/登录/Key 入口。
- **仅界面/未验证**：真实供应商账号逐一查询（本机已有 Codex/Grok Build 成功历史，本轮未逐个重验）；Google OAuth 未配置；Google/iCloud/EventKit 外部日历同步未实现；系统通知实际送达需人工观察。
- 页面不会把未接通的外部日历显示为成功，也不会为未知日期/金额编造值。

## 剩余阻塞

1. 真实账号凭据缺失与 Google OAuth 部署配置：影响账号页的逐服务真实验收，不影响手动账本和界面。
2. 外部日历同步（Google / iCloud / EventKit）尚未接通，日历页只使用本地投影。
3. system 主题随 Windows 变化的实机切换、系统通知真实送达、休眠恢复需人工复核。
4. 用户尚未确认接受本批界面与交互（状态保持 verified，不标 accepted）。

## 功能状态

实现完成：SC-001—SC-008。实施者验证完成：SC-009（14 项 UI 检查 + 6 项既有桌面回归 + 单元/类型检查）。用户接受：pending。
