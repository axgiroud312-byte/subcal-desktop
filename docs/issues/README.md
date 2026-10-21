# SubCal 开发 Issue 索引

## 当前批次：真实后端与前端收尾

本地 Issue 已先于实施建立，沿用本项目本地 Issue 约定。BE-001 汇总目标并交付 IPC 接缝，依次实施 BE-002 → BE-003 → BE-004 → BE-005 → BE-006 → BE-007 / BE-008 → BE-009 → BE-010；前端最后优化单列 FE-019，纳入整体交付与回归。

远端汇总追踪：[GitHub #1：真实后端接入与前端最后优化](https://github.com/axgiroud312-byte/subcal-desktop/issues/1)。BE/FE 编号仍指本地任务，不是远端编号。

入口：[BE-001](BE-001.md)、[BE-002](BE-002.md)、[BE-003](BE-003.md)、[BE-004](BE-004.md)、[BE-005](BE-005.md)、[BE-006](BE-006.md)、[BE-007](BE-007.md)、[BE-008](BE-008.md)、[BE-009](BE-009.md)、[BE-010](BE-010.md)、[FE-019](FE-019.md)。本批代码已实施并通过整合检查，用户验收 pending；真实账号/系统环境验证边界见[验收记录](../evidence/backend-v1/acceptance.md)。交付 [PR #2](https://github.com/axgiroud312-byte/subcal-desktop/pull/2)。

---

这批任务交付可交互的 Electron 桌面前端预览，采用本地 Issue 文件；下列 FE 编号不是 GitHub Issue 编号，也没有发布为远端 Issue。2026-10-21 已建立 [私有代码仓库 axgiroud312-byte/subcal-desktop](https://github.com/axgiroud312-byte/subcal-desktop)，本地 Issue 管理方式保持不变。

当前开发依据：[视觉基础与组件约定](../design/visual-foundation.md)、[前端执行规格](../specs/frontend-first.md)、[完整 PRD](../../SubCal-Desktop-V1-PRD.md)。第一版设计来源：[Gemini 原始方案](../design/gemini-frontend-proposal.md)及[调用回执](../design/gemini-call-receipt.json)。启动整批工作的指令见[前端开发指令](../../前端开发指令.md)。

下一批（已制定、尚未实施）：真实后端 BE-001 至 BE-010，把演示数据替换为本地 SQLite 服务与五个正式适配器的真实查询，启动指令见[后端开发指令](../../后端开发指令.md)。

## 当前批次：视觉重做 FE-011 至 FE-018

用户已明确否定第一版视觉，并确认需要实际采用现成组件。本批使用 shadcn/ui Mira（Base UI 版本）+ Tailwind CSS 4 + Lucide，并实际接入 Motion、dnd-kit、Recharts 3；2026-10-20 已按依赖完成实现与检查。**verified 只代表实施者检查完成，用户验收仍 pending**。见[真实桌面证据](../evidence/visual-v2/checks.md)及[组件版本和使用点](../design/component-adoption.md)。

| Issue | 可观察的交付 | 真正前置 | 当前状态 |
| --- | --- | --- | --- |
| [FE-011](FE-011.md) | 交付统一、主次清楚的桌面前端 | 汇总 FE-012 至 FE-018，不阻塞子任务 | verified，待用户验收 |
| [FE-012](FE-012.md) | 统一 Token 与成熟基础组件 | 无 | verified |
| [FE-013](FE-013.md) | 统一桌面壳、导航和公共反馈 | FE-012 | verified |
| [FE-014](FE-014.md) | 重做概览和三类品牌卡片 | FE-013 | verified |
| [FE-015](FE-015.md) | 统一订阅列表、详情与编辑 | FE-012 | verified |
| [FE-016](FE-016.md) | 统一月历、日程和同步预演 | FE-012 | verified |
| [FE-017](FE-017.md) | 统一连接、设置与预览工具 | FE-012 | verified |
| [FE-018](FE-018.md) | 真实桌面视觉核对、回归及交付 | FE-014、FE-015、FE-016、FE-017 | verified，待用户验收 |

先执行 FE-012，公共组件稳定后推进各页面。FE-013 为概览提供内容区；FE-015、FE-016、FE-017 可以独立推进，最后在 FE-018 整合。

~~~mermaid
flowchart LR
    FE012["FE-012 Tokens 与组件"] --> FE013["FE-013 桌面壳"]
    FE013 --> FE014["FE-014 概览与卡片"]
    FE012 --> FE015["FE-015 订阅操作"]
    FE012 --> FE016["FE-016 日历与预演"]
    FE012 --> FE017["FE-017 连接与设置"]
    FE014 --> FE018["FE-018 视觉与回归交付"]
    FE015 --> FE018
    FE016 --> FE018
    FE017 --> FE018
~~~

## 第一批历史记录：FE-000 至 FE-010

以下“已验证”保留第一轮对应功能检查的事实，不表示视觉获用户认可。第一版视觉需重做，后续视觉要求以 FE-011 及其共同设计为准。

| Issue | 可观察的交付 | 真正前置 | 当前状态 |
| --- | --- | --- | --- |
| [FE-000](FE-000.md) | 完成可试用的桌面前端预览 | 汇总 FE-001 至 FE-010，不作为子任务阻塞项 | needs_revision：功能检查完成，视觉被否定 |
| [FE-001](FE-001.md) | 打开真实桌面窗口，切换导航和主题 | 无 | 已验证 |
| [FE-002](FE-002.md) | 切换十二种演示场景并保存演示资料 | FE-001 | 已验证 |
| [FE-003](FE-003.md) | 在概览看懂行动事项、三类品牌卡及汇总 | FE-002 | needs_revision：由 FE-014 重做视觉 |
| [FE-004](FE-004.md) | 用详情抽屉核对日期、额度和来源 | FE-003 | 已验证 |
| [FE-005](FE-005.md) | 从目录新增、编辑、归档、删除和恢复订阅 | FE-004 | 已验证 |
| [FE-006](FE-006.md) | 在月历与日程列表查看同一份订阅安排 | FE-005 | 已验证 |
| [FE-007](FE-007.md) | 查看连接边界并演示刷新和错误恢复 | FE-004 | 已验证 |
| [FE-008](FE-008.md) | 预演三种日历后端的同步与冲突处理 | FE-006、FE-007 | 已验证 |
| [FE-009](FE-009.md) | 保存偏好、操作托盘并备份恢复演示资料 | FE-005、FE-007 | 已验证 |
| [FE-010](FE-010.md) | 跑通整体前端流程并交付可试用窗口 | FE-008、FE-009 | needs_revision：保留功能证据，转新批次 |

## 第一批原执行顺序（历史）

先完成 FE-001 → FE-002 → FE-003，用户即可看到有示例数据的 Magpie 风格桌面概览。

再完成 FE-004。之后 FE-005 和 FE-007 可以在公共合同稳定时独立推进；FE-006 跟在 FE-005 后。FE-008 等待日历与连接，FE-009 等待订阅编辑与连接；最后 FE-010 整合。

~~~mermaid
flowchart LR
    FE001["FE-001 桌面壳"] --> FE002["FE-002 演示服务"]
    FE002 --> FE003["FE-003 概览"]
    FE003 --> FE004["FE-004 详情"]
    FE004 --> FE005["FE-005 管理"]
    FE004 --> FE007["FE-007 连接"]
    FE005 --> FE006["FE-006 本地日历"]
    FE006 --> FE008["FE-008 日历预演"]
    FE007 --> FE008
    FE005 --> FE009["FE-009 设置与托盘"]
    FE007 --> FE009
    FE008 --> FE010["FE-010 整体验证"]
    FE009 --> FE010
~~~

## 领取与维护

每个 Issue 写有目标、范围、依据、验收和当前进展。开发者完成一项后补充实际改动、验证结果和阻碍，再推进已具备条件的下一项，不逐项询问是否继续。

领域类型、数据服务、日期规则和共享样式分别由明确的实现者维护；若采用并行工作，先约定这些公共文件的修改权。没有隔离和整合收益时直接顺序开发。

初始 Issue 状态为 planned 或 ready。实现过程中可用 in_progress、blocked、dev_complete、verified、accepted、needs_revision；blocked 必须写真实阻碍，needs_revision 写明反馈与承接任务，verified 仅说明相应检查完成，accepted 必须来自用户验收。前置解除依据是代码和检查结果，不能只凭一句“做完了”。功能检查、视觉核对和用户验收分别记录。

本阶段真实账号、API Key、日历权限、数据库和签名证书均不是启动条件。没有远端仓库时本地交付，不虚构 PR 链接，不把发布远端当成阻塞。
