# 视觉重做验证记录

状态：**实现及实施者检查完成（verified），待用户验收**。日期：2026-10-20。全部检查使用真实 Electron；功能检查、视觉核对和用户验收分别记录。

## 功能检查

| 检查 | 实际结果 | 证据 / 范围 |
| --- | --- | --- |
| `npm run typecheck` | 通过，0 错误 | 最后一次界面修正后再次执行 |
| `npm run test:rules` | 17 / 17 通过 | 场景隔离、持久化、revision、日期/金额、刷新、同步及备份；本轮未修改 shared、service 或原规则断言 |
| `npm run test:desktop` | **16 / 16 分组通过** | [完整桌面结果](desktop-check.json)，2026-10-20 10:46 UTC |
| 基础组件针对性检查 | 2 / 2 分组通过 | [foundation-check.json](foundation-check.json)：两主题嵌套 Select、Escape、焦点返回、Recharts Tooltip / Legend / 空数据 / 窄宽度、根 Token 修改传播 |
| 最后局部视觉修正复查 | 4 / 4 分组通过 | [最新截图及局部结果](desktop-check-列表归档-150-双主题.json)：搜索图标留白、列表键盘操作、两尺寸、四页两主题、状态截图 |
| 字段来源配对复查 | 3 / 3 分组通过 | [desktop-check-零值-双主题.json](desktop-check-零值-双主题.json)：未知字段不借用另一窗口的时间；零值/过时/部分成功及两主题状态再次检查 |

完整桌面结果包含：四页与十二场景；键盘新增、字段错误、未保存选择及连续 Escape；编辑与日历联动；删除与 8 秒撤销；revision 冲突保留输入及未改字段来源时间；品牌模板；列表归档恢复与菜单焦点；dnd-kit 指针、键盘、取消、整组排序及重启恢复；Motion 多账号开合与减少动效；未知、明确零值、过时、重置待核实及部分成功；认证向导、限流和离线合并补查；日期跨月及时区边界；三后端同步、写入后失败重试、三种冲突裁决与外部删除抑制；阈值草稿保护；备份损坏/取消/预览后改文件拒绝及恢复暂停；原生文件往返、托盘恢复与退出。

完整通过之后修正了搜索图标留白、未知指标页脚的来源/时间配对，以及截图取景/命名，均只针对复查受影响分组，未重复无关全量回归。历史 `desktop-attempt-*.json` 是排错记录，不是当前失败；独立分组结果也保留。最终以完整通过结果和最新局部结果为准。

### 检查中发现并修正的问题

- 标签页方向状态映射、FieldError 空文本、搜索输入样式层覆盖：分别修复统一组件/工具类，并新增真实可见内容、布局和遮挡断言。
- 通知在模态窗口内改为正常流反馈，预留空间，不覆盖保存或冲突处理；同一事件只显示一处，撤销仍按真实 8 秒到期。
- Vite 在首次渲染后发现新依赖可能混用优化块：预优化完整交互依赖并去重 React；每轮桌面测试的缓存也放入独立临时资料目录。
- 多账号关系按各账号计算，折叠摘要保留过时文字；排序移动整组账号，取消不写入；日期格键盘处理不再吞掉子事件的 Enter。未知指标的来源页脚使用它自己的观察时间，不借用另一个已知窗口的时间。
- 测试等待真实菜单退场、Base UI 焦点保护回到弹层、dnd-kit 目标更新；空场景视觉检查先通过 UI 重置自身，避免把前面故意持久化的测试记录误判成空状态缺陷。未删除业务断言来掩盖失败。

## 视觉核对

### 环境与尺寸

- Windows 实机，Electron **44.7.0**，React / React DOM **19.3.1**，Vite **7.3.7**。`contextIsolation` / `sandbox` 开启，渲染层无 Node 集成。
- 系统缩放 **150%**：`scaleFactor = devicePixelRatio = 1.5`，原生窗口 DPI **144**。
- 请求 1280×820，Electron 实际外框 **1281×821 DIP**，内容区 **1266×784 CSS px**；请求 960×640，实际外框 **961×642 DIP**，内容区 **946×604 CSS px**。少量外框取整来自 Windows 非客户区，不伪称内容区就是目标窗口尺寸。
- [原生窗口截图](native-window-150.png) 为含 Windows 标题栏的 **1921×1231 物理像素** PrintWindow 捕获；其余 PNG 来自同一真实 Electron WebContents，不是浏览器替代图。

### 核对结论

- 首屏先读最多三条近期行动，再读分币种汇总/筛选和品牌卡。窗口额度、钱包、手动会员分别突出可用量、余额、价格/日期；额度行不再嵌套背景卡。多账号一个完整、其余摘要，辅助能力/历史/说明按需展开。
- 根字号 16px，正文 14px，控件 **13px / 500、32px 点击高度**；窗口数值 14px / 600、主要余额 18px / 600。实际 DOM 抽查未残留 700/800 字重。中文实际使用本机 Microsoft YaHei UI，不加载远程字体。
- 实测采样组合中，普通文字最低对比度浅色 **5.05:1**、深色 **5.94:1**；输入/焦点必要边界组合最低浅色 **3.42:1**、深色 **3.28:1**。另有实际 DOM 合成背景样本和根 Token 修改传播记录，详见 JSON；不是声称穷举每一个像素。
- 四页、详情 Sheet、编辑 Dialog、未保存 AlertDialog、设置和 Select Portal 两主题一致。两个窗口尺寸无整页横向溢出；宽表格只在自身容器横滚。窄表单可滚动、保存固定可达，日历可切换日程；关键日期可读。
- 正常、多账号、未知/不适用、明确零值、过时/重置待核实、认证失败和空状态已在两主题实际打开并核对。未知未显示为 0，过时值仍保留旧观察时间，模拟连接/刷新/同步及图表示例身份未被抹去。

### 代表截图索引

除另注外均为 `normal_mixed`；完整取景、主题和尺寸在[最新局部结果](desktop-check-列表归档-150-双主题.json)中。旧版 `docs/evidence/` 根目录 PNG / JSON 保持不变。

| 内容 | 文件 | 主题 / 请求外框 |
| --- | --- | --- |
| 概览，三类轻量卡片 | [desktop-light.png](desktop-light.png) | 浅 / 1280×820 |
| 概览另一主题 | [desktop-dark.png](desktop-dark.png) | 深 / 1280×820 |
| 订阅表格 | [desktop-subscriptions.png](desktop-subscriptions.png) | 浅 / 1280×820 |
| 月历与日程 | [desktop-calendar.png](desktop-calendar.png) | 浅 / 1280×820 |
| 连接恢复入口 | [desktop-connections.png](desktop-connections.png) | 浅 / 1280×820 |
| 窄窗口详情 | [desktop-narrow-detail.png](desktop-narrow-detail.png) | 深 / 960×640 |
| 窄窗口编辑 | [desktop-narrow-form.png](desktop-narrow-form.png) | 深 / 960×640 |
| 窄窗口月历 | [desktop-narrow-calendar.png](desktop-narrow-calendar.png) | 深 / 960×640 |

补充核对图：[多账号摘要](desktop-multi-account.png)、[未知与不适用](state-unknown_and_na.png)、[明确零值](state-zero_vs_unfetched.png)、[过时与重置](state-stale_and_past_reset.png)、[错误恢复](desktop-connections-error-dark.png)、[空状态](state-empty_first_run.png)、[未保存确认](desktop-unsaved-dark.png)、[同步预演](desktop-sync.png)、[基础组件 Portal](foundation-narrow-dark.png)。状态与多账号图在[最后来源配对复查](desktop-check-零值-双主题.json)刷新；订阅、日历、连接的另一主题另存为 `desktop-*-dark.png`。

## 组件使用、交付和保留

- [组件实际版本、源码导入和可操作入口](../../design/component-adoption.md)；[品牌来源与许可](../../assets.md)。Mira/Base UI 控件在四页实际使用；Motion 与 dnd-kit 在概览卡片实际使用；Recharts 在底部预览工具内显式标记示例，不冒充消费历史。
- 本地文件交付，无 Git 仓库、无远端 Issue / PR、未创建临时工作树。保留源码、锁文件、运行所需依赖、`dist-electron`、旧资料、旧证据及原 `work/argon-design`。
- 每轮测试停止自己的 Electron/Vite，并移除自身独立临时资料/缓存；不覆盖 `%APPDATA%\SubCal-Preview` 的用户资料。真实试用入口仍为 `启动 SubCal.cmd` / `npm run dev`。
- 最后实际执行 `npm run dev`，复用原先运行的 5173 预览服务并从托盘恢复现有窗口。该旧窗口最初停留在迁移过程中“组件尚未创建”时的 Vite 错误页；服务器当前模块返回 200，刷新后已正常显示新概览，未重置已有资料。[交付时原生窗口](delivery-window.png) 已保存。保留这个可试用窗口及其原有服务；5174 测试服务已停止，`subcal-desktop-*` 测试临时资料和临时失败截图/JSON 已清理，排错记录已在本目录保留。

## 剩余边界

无已知阻塞本轮本地试用的问题。**macOS 未实测**；文件选择器的路径选择由自动化指定，实际文件写读、提交前重读与校验已执行；托盘重开经 Windows UI Automation，退出执行真实菜单回调。真实供应商查询、OAuth/密钥、数据库、后台心跳、系统定时提醒、真实 Google/EventKit/CalDAV 写入、`.ics`、签名与安装包仍不在本轮范围。EventKit 只演示本机读回，不证明 iCloud 云端确认。

## 用户验收

**待用户验收**。第一版视觉被否定的历史结论保留；本轮实施者不能自行标记 accepted。
