# SubCal Desktop · 前端预览

用本地演示资料管理订阅、额度与日历安排。当前是可交互的 Electron 桌面预览，全部外部连接与同步均为**模拟**。

**视觉重做已交付，待你验收。** [FE-011 至 FE-018](docs/issues/README.md) 已完成实现、功能检查及实施者视觉核对；采用统一 Token、shadcn/ui Mira（Base UI）、Tailwind 4、Motion、dnd-kit、Recharts 3 与本地真实品牌 Logo。第一版视觉被否定的历史记录保留，本轮不自动视为用户接受。

## 打开

在本目录执行：

```powershell
npm run dev
```

也可以双击 **`启动 SubCal.cmd`**。当前工作区已安装所需依赖；复制到另一台开发电脑时先执行 `npm install`。Node.js 需支持 Vite 7（20.19+ 或 22.12+）。主进程修改后重新启动，界面修改由 Vite 自动更新。

若原先一直打开的窗口仍停留在本轮迁移期间的旧错误页，可按 **Ctrl+R** 重新载入，不需要重置演示资料。本次交付已实际打开入口并确认显示新界面。

关闭窗口默认收起到系统托盘；点击托盘图标可重新打开。重复运行启动命令会打开已有窗口。托盘菜单 **“退出 SubCal 预览”** 完全退出，同时停止开发服务器。可在设置中关闭“关闭窗口后保留在系统托盘”。

## 怎么试

打开概览底部的 **“预览工具”**，可切换十二种场景。场景各自保存，切换不会清空其他场景的编辑；“重置当前场景”会明确询问。默认演示时间固定在 **2026-10-20 09:00（上海）**，不是系统实时采集。日期边界场景使用自己的时钟。

卡片左上角手柄支持鼠标拖动；键盘聚焦手柄后按 **空格 → 方向键 → 空格** 排序，**Esc** 取消。同产品多账号默认完整显示一个，其余保留摘要。预览工具中的 **“组件示例 · 非实际消费”** 可试 Dialog 内下拉、深浅色图表 Tooltip、图例和空数据，不是真实消费统计。

从“首次空白”开始，新增一个只有名称的订阅，再补齐价格和续费日期；在概览、详情和日历中查看同一条记录。删除后可在 8 秒内撤销。设置中的 JSON 备份可以保存为实际文件，导入先预览，确认后恢复；恢复后的模拟连接和日历目标暂停待核对。

演示资料保存在 `%APPDATA%\SubCal-Preview` 内的 Electron localStorage；窗口偏好保存在同目录 `preview-shell.json`。测试使用独立目录，不覆盖试用资料。默认保留已有本地演示编辑。

## 实现范围

React + TypeScript、Electron 原生窗口与托盘，统一异步 `MockSubCalClient`。业务规则在 `src/shared`，演示存储和场景在 `src/renderer/service`，界面不直接读取 fixture 或写 localStorage。

真实供应商采集、OAuth/API Key/CLI 登录、SQLite、真实后台心跳、系统定时通知、开机启动、Google/EventKit/CalDAV 写入及安装包均属于下一阶段。`.ics` 当前未实现。EventKit 仅演示**本机**读回，不声称 iCloud 云端已确认。

## 验证与进度

```powershell
npm run typecheck
npm run test:rules
npm run test:desktop
```

本轮通过：类型检查、**17 项规则/服务检查、16 组完整真实 Electron 检查**；最后视觉留白修正后，另跑受影响分组。检查覆盖 1280×820、960×640、Windows 150% 缩放、四页深浅色及主要弹层。测试使用独立临时资料与 5174 端口，不覆盖试用资料；不生成安装包。**功能检查、实施者视觉核对、用户验收是三件事，用户验收仍待确认。**

- [新截图、检查结论与剩余边界](docs/evidence/visual-v2/checks.md)
- [实际组件版本、导入位置与操作入口](docs/design/component-adoption.md)
- 第一轮历史检查见 [FE-010](docs/issues/FE-010.md)，不与本轮结果混记。

资源来源及文字后备说明见 [docs/assets.md](docs/assets.md)。
