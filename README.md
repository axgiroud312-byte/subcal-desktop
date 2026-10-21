# SubCal Desktop

**当前需求更新：** 账号接入将改为自动发现已有登录，或登录/填 Key 后自动建档与查询，见 [项目术语](GLOSSARY.md) 和 [BE-011](docs/issues/BE-011.md)。该重构尚未实施；下面启动说明描述已有版本，不代表新接入需求已完成。

在本机管理订阅、续费日期与额度。桌面默认使用真实 IPC、SQLite 数据库与官方只读查询，不加载演示资料。

## 打开

双击 **`启动 SubCal.cmd`**，或执行 `npm run dev`。新电脑先运行 `npm install`，建议 Node.js 24。关闭窗口默认收起到托盘，托盘菜单可完全退出。

首次启动为空：从“新增订阅”手动记录，或在“连接”页添加服务。API Key 只在桌面连接表单输入；Codex / Copilot 使用本机已登录的官方客户端。查询实际字段后，确认启用自动更新。

开发态数据位于 `%APPDATA%\SubCal-Development`，正式打包使用 `%APPDATA%\SubCal`。SQLite 和加密凭据文件存于应用数据目录，不写安装目录。设置中可导入导出备份；备份不含凭据，恢复后须重新连接。旧前端预览资料不会自动灌入新库。

## 本批范围

- 真实本地订阅 CRUD、版本冲突保护、撤销、排序、偏好与备份恢复。
- safeStorage 加密凭据、独立进程采集、持久化心跳与限流、桌面通知及勿扰。
- DeepSeek、Kimi 国内站、OpenRouter 当前 Key、Codex App Server、Copilot 官方 SDK 五个只读适配器。
- 前端四页去掉模拟入口、演示数据和无关说明，沿用既有视觉。

本机 Codex 已通过官方读取、字段转换和真实桌面绑定流程检查。三个 HTTP 服务尚缺真实 Key 对照，Copilot 缺本机官方运行时；支持目录仍保留“待验证”。Google / iCloud / EventKit 外部同步属于下一批，界面显示“待接入”。

## 检查

```powershell
npm run typecheck
npm run test:rules
npm run test:backend
npm run test:adapters
npm run build:electron
npm run test:desktop
```

真实桌面测试用独立临时资料目录，不访问用户的实际资料库。`scripts/live-codex-desktop.mjs` 是独立的真实 Codex 账号检查，只在需要账号对照时运行。

实现与检查结果见 [验收记录](docs/evidence/backend-v1/acceptance.md)。用户验收仍 pending；macOS、签名安装包、系统通知实际送达、真实休眠恢复及 14 天试点未完成验收。

任务：[Issue #1](https://github.com/axgiroud312-byte/subcal-desktop/issues/1)、[PR #2](https://github.com/axgiroud312-byte/subcal-desktop/pull/2)、[本地任务索引](docs/issues/README.md)。前端预览历史见 `docs/evidence/visual-v2`。
