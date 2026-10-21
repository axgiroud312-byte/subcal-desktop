# SubCal Desktop

**绿色工作台与付款账本：** 用户选定的原型已接入导航外壳、首页、仪表盘、消费、日历与设置，**保留当前 Magpie 订阅卡片、列表和详情**。真实付款账本、预算、分类、季度周期与可配置提醒已落地，并完成 Windows Electron 实机检查。见 [SC-000 总目标](docs/issues/subcal-ui/SC-000.md)、[任务索引](docs/issues/subcal-ui/README.md)、[正式界面规格](docs/specs/subcal-production-ui.md) 和 [验证记录](docs/evidence/subcal-ui/report.md)。

开发 Agent 执行入口：[正式开发指令.md](正式开发指令.md)。

**当前状态：** [总目标 #5](https://github.com/axgiroud312-byte/subcal-desktop/issues/5) 的共享权益合同、多服务只读适配器、账号入口与权益卡片已进入整合交付；不等于所有服务均通过真实账号验收。当前进度、接入限制与检查证据见 [全服务交付记录](docs/evidence/full-service/acceptance.md)，规格见 [全服务计划](docs/specs/full-service-entitlements.md)。

在本机管理订阅、续费日期与额度。桌面默认使用真实 IPC、SQLite 数据库与官方只读查询，不加载演示资料。

## 打开

双击 **`启动 SubCal.cmd`**，或执行 `npm run dev`。新电脑先运行 `npm install`，建议 Node.js 24。关闭窗口默认收起到托盘，托盘菜单可完全退出。

首次启动为空：“新增订阅”自动发现支持来源中的账号；选择加入、登录或填写 Key 后自动建卡并更新，也可手动记录其他订阅。查询暂时失败保留账号，无需另行读取、绑定或启用更新。

开发态数据位于 `%APPDATA%\SubCal-Development`，正式打包使用 `%APPDATA%\SubCal`。SQLite 和加密凭据文件存于应用数据目录，不写安装目录。设置中可导入导出备份；备份不含凭据，恢复后须重新连接。旧前端预览资料不会自动灌入新库。

## 本批范围

- 真实本地订阅 CRUD、版本冲突保护、撤销、排序、偏好与备份恢复。
- safeStorage 加密凭据、独立进程采集、持久化心跳与限流、桌面通知及勿扰。
- Codex、Claude Code、Copilot 直接权益查询；DeepSeek、Kimi API 国内站、OpenRouter 账户余额与 Key 预算。
- 绿色工作台：首页、仪表盘、订阅管理、消费管理、订阅日历、账号管理、偏好设置七入口，默认进入仪表盘。
- 逐笔付款账本、分币种月均/计划/实付统计、月度预算、本地分类、季度周期、提前提醒天数。
- 原有 Magpie 订阅卡片、列表、详情、额度条与账号分组保持原样式，只接入新外壳。

本机 Codex 与 Grok Build 已读到真实权益；Codex 另有五分钟更新与实际支付编辑验证。其他服务的协议测试不替代真实账号验证，缺凭据或接口的部分仍待验证，详见交付记录。Google / iCloud / EventKit 外部日历同步仍待接入。

## 检查

```powershell
npm run typecheck
npm test
npm run test:rules
npm run test:backend
npm run test:adapters
npm run build:electron
npm run test:desktop
npm run test:subcal-ui
```

真实桌面测试用独立临时资料目录，不访问用户的实际资料库。`scripts/live-codex-desktop.mjs` 是独立的真实 Codex 账号检查，只在需要账号对照时运行。

实现与检查结果见 [验收记录](docs/evidence/backend-v1/acceptance.md)。用户验收仍 pending；macOS、签名安装包、系统通知实际送达、真实休眠恢复及 14 天试点未完成验收。

任务：[Issue #1](https://github.com/axgiroud312-byte/subcal-desktop/issues/1)、[PR #2](https://github.com/axgiroud312-byte/subcal-desktop/pull/2)、[本地任务索引](docs/issues/README.md)。前端预览历史见 `docs/evidence/visual-v2`。
