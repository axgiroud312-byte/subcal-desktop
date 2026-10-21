# SubCal Desktop

**当前状态：** BE-012 已交付自动发现、加入后建卡和后台查询，真实验证范围见 [交付记录](docs/evidence/BE-012/acceptance.md)。下一批 [总目标 #5](https://github.com/axgiroud312-byte/subcal-desktop/issues/5) 覆盖 Magpie 全服务权益及前端展示，共 33 个子任务，尚未实施。规格见 [全服务计划](docs/specs/full-service-entitlements.md)。

在本机管理订阅、续费日期与额度。桌面默认使用真实 IPC、SQLite 数据库与官方只读查询，不加载演示资料。

## 打开

双击 **`启动 SubCal.cmd`**，或执行 `npm run dev`。新电脑先运行 `npm install`，建议 Node.js 24。关闭窗口默认收起到托盘，托盘菜单可完全退出。

首次启动为空：“新增订阅”自动发现支持来源中的账号；选择加入、登录或填写 Key 后自动建卡并更新，也可手动记录其他订阅。查询暂时失败保留账号，无需另行读取、绑定或启用更新。

开发态数据位于 `%APPDATA%\SubCal-Development`，正式打包使用 `%APPDATA%\SubCal`。SQLite 和加密凭据文件存于应用数据目录，不写安装目录。设置中可导入导出备份；备份不含凭据，恢复后须重新连接。旧前端预览资料不会自动灌入新库。

## 本批范围

- 真实本地订阅 CRUD、版本冲突保护、撤销、排序、偏好与备份恢复。
- safeStorage 加密凭据、独立进程采集、持久化心跳与限流、桌面通知及勿扰。
- Codex、Claude Code、Copilot 直接权益查询；DeepSeek、Kimi API 国内站、OpenRouter 账户余额与 Key 预算。
- 前端四页去掉模拟入口、演示数据和无关说明，沿用既有视觉。

本机 Codex 已通过真实 Electron 加入、实际权益、五分钟更新及重启检查；其他五项缺真实凭据，仍待验证。新计划中的 Grok Bot、OpenCode、Devin 等不能视作已经接入。Google / iCloud / EventKit 外部日历同步仍待接入。

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
