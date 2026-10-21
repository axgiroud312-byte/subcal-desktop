# 账号发现与添加（BE-012）

依据：[账号接入规格](../specs/account-access.md)。本页替代 FE-020 的“读取后确认”历史设计。

## 入口与交互

- 全局新增、空状态、品牌预设与连接页复用 `AddSubscription`，打开立即调用 `discoverAccounts()`。
- 完整列出发现的账号、服务、组织及来源；点“加入”调用 `addAccount({candidateId})`，后端自动建立连接、订阅并查询权益。保留弹窗以继续加入其他账号，已加入按钮禁用。
- 没有账号时，Codex / Copilot 提供设备码登录；展示登录码与浏览器入口，按服务给出的间隔串行轮询。完成直接刷新卡片，无读取、探测、绑定确认步骤。
- Claude Code 显示终端 `claude` → `/login` 的具体步骤；每五秒及窗口重新获得焦点时自动发现，显示新账号后可直接加入。
- DeepSeek API、Kimi API、OpenRouter 可填写 Key 后直接加入。切换服务、关闭或成功加入后不保留输入。
- 缺少 optional 方法时明确提示在桌面应用操作，不调用 Mock 的旧探测/绑定流程假装真实加入。
- 连接页保留刷新、暂停、断开、订阅详情及诊断；删除旧向导、内部字段清单和未接入日历介绍。

## 编辑边界

BE-012 当前自动采集订阅使用独立账单补录表单，可补录未提供的金额/日期。用户最新要求已收紧：下一批只补录实际支付金额及币种，移除自动订阅日期编辑；保留历史手动事实及来源，不把历史值当自动值。此差距由 FE-021 实施，设计见 [完整权益卡片](full-service-entitlements.md)。账号、套餐、指标与自动来源始终只读；保存使用原 revision，冲突不覆盖新采集结果。

手动订阅继续使用原表单。沿用既有 Modal、Field、Button、Input、panel/stack/row 和设计 tokens，没有增加独立视觉体系。

## 集成约定与验证边界

`IpcSubCalClient` 调用：`accounts.discover {}`、`accounts.add {candidateId?,providerId?,secret?}`、`accounts.loginStart {providerId}`、`accounts.loginPoll {id}`。add 成功及 poll complete 发布状态更新；发现结果不含秘密。设备码 `expiresAt` 按毫秒时间戳处理。

服务 ID：`codex-local`、`claude-local`、`copilot-local`、`deepseek-balance`、`kimi-platform-cn`、`openrouter-key`。账号去重、加入后自动查询、已有账号重连及查询失败保留卡片由主进程实现。

前端类型检查与真实账号接入是独立验证项；不将浏览器预览、模拟数据或类型检查记为真实接入成功。

本次前端验证：`npm run typecheck` 通过。Edge 无头浏览器检查预览环境不可用提示、Claude 登录说明、模拟候选加入、设备码自动完成及关闭；检查自动订阅的服务价格不可编辑，补录开始日期仅提交该字段。IPC 调用参数通过共享 `paramSchemas` 校验。截图：`C:\Users\niilo\AppData\Local\Temp\opencode\be012-add-preview.png`。真实账号登录和权益查询仍由整体集成验证。
