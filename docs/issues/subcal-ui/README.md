# 绿色 SubCal 正式界面任务

2026-10-21：源码核对、组件选型、功能开发与 Windows Electron 实机检查已完成。**用户已明确：保留旧 Magpie 订阅展示，新原型用于导航外壳及消费等页面。** 总目标 [SC-000](SC-000.md)。共同依据：[规格](../../specs/subcal-production-ui.md)、[设计与组件](../../design/subcal-green.md)、[消费领域](../../domain/spending.md)。实施证据：[验证记录](../../evidence/subcal-ui/report.md)。用户验收仍为 pending。

已发布：[GitHub 总目标 #43](https://github.com/axgiroud312-byte/subcal-desktop/issues/43)，子任务 #44—#52；交付 [PR #53](https://github.com/axgiroud312-byte/subcal-desktop/pull/53)。各本地任务正文顶部包含对应远端链接，编号及依赖登记在 `registry.json`。

可直接交给开发 Agent 的执行入口：[正式开发指令](../../../正式开发指令.md)。

发布检查：已读回核对 10 个 Issue 的标题/正文、9 个原生父子关系、19 条原生阻塞关系，依赖无环；本地文档链接与 diff 格式检查通过。本轮修改仅为规格、领域和任务文档，没有修改业务源码、执行数据库迁移或运行新功能验收。

| 本地任务 | 内容 | 真正前置 | 状态 |
| --- | --- | --- | --- |
| [SC-001](SC-001.md) | 新控件/Token 与旧订阅样式隔离 | 无 | implemented |
| [SC-002](SC-002.md) | 侧栏外壳/首页/导航搜索/状态 | SC-001 | implemented |
| [SC-003](SC-003.md) | 保留 Magpie 订阅展示并接入付款 | SC-002、SC-005 | implemented |
| [SC-004](SC-004.md) | 账号/登录/真实状态 | SC-002 | implemented（真实账号覆盖待 #38） |
| [SC-005](SC-005.md) | 付款/预算/分类/迁移备份 | 无 | implemented |
| [SC-006](SC-006.md) | 仪表盘/消费/精确统计 | SC-002、SC-005 | implemented |
| [SC-007](SC-007.md) | 日历/季度/可配置提醒 | SC-002、SC-005 | implemented（external 未接通） |
| [SC-008](SC-008.md) | 主题与完整偏好 | SC-002、SC-005、SC-007 | implemented |
| [SC-009](SC-009.md) | 实机验收/交付/阻塞记录 | SC-001—SC-008 | verified（用户验收 pending） |

SC-003 可先迁旧 CRUD，完整验收等待账本。SC-005 与视觉基础独立；共享数据库/schema 修改先集中到 SC-005，再由 SC-007 扩展周期/提醒。前置完成以代码和证据为准，不以口头完成或关闭 Issue 为准。

旧 #37 的权益能力和现有 Magpie 订阅展示一起保留；#38 的全服务真实账号验证继续保留。新批次不重复开供应商适配器 Issue。
