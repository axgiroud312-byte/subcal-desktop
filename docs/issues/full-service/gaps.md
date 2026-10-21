## 目标与范围

覆盖内置清单“没有专用权益查询”全部ID，重点Windsurf、xAI API、OpenAI/Anthropic API、ChatGPT API OAuth、OpenCode Zen、SiliconFlow替代、中国云个人套餐。每项产出官方/当前实现证据、凭据条件、只读端点与字段或不可读结论；本地/路由类标不适用。

## 本任务可观察验收

清单每项有结论和出处；找到路径则补可实施任务、固定版本与测试输入；找不到不能要求用户填到期/重置来冒充完成。不得猜API或发模型请求验证。此任务是调查，不能提前承诺全服务全部字段。

## 关联与进展

父目标 #5；接续 #4（BE-012），不重复声称已有真实验证覆盖新增能力。实施依赖 #7 的共享合同/目录交付。

状态：计划，未实施；真实账号验证 pending。

## 共同依据

- [总体规格](https://github.com/axgiroud312-byte/subcal-desktop/blob/feat/real-backend/docs/specs/full-service-entitlements.md)、[领域定义](https://github.com/axgiroud312-byte/subcal-desktop/blob/feat/real-backend/GLOSSARY.md)、[卡片设计](https://github.com/axgiroud312-byte/subcal-desktop/blob/feat/real-backend/docs/design/full-service-entitlements.md)。GitHub 阅读对应文件请使用仓库 feat/real-backend 分支。
- Magpie：yetone/magpie@ba319a7587923fc7a4ea3859658244d591261a59；社区插件：magpie-community/plugins@aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6。来源逐项见 docs/references/magpie-builtins-inventory.md 与 magpie-plugins-inventory.md。
- 优先移植登录、来源识别、刷新、只读查询、解析及对应测试，保留 MIT/版权/固定源文件映射；不把模型代理入口或旧迁移代码当成权益接口。
- 只需选择已登录账号、登录或填写必要凭据，自动保存账号、建卡、查询并持续更新。不得再要求配置字段、单位、重置或绑定步骤；只允许补录实际支付金额及币种。供应商未给日期保持未知。
- 复用 SQLite、safeStorage、隔离采集、持久调度、系统代理与账号代次。凭据不进入 Renderer、日志、备份。外部来源只读，不抢占其轮换链；自有授权刷新串行并先持久化。
- 查询不触发模型、签到、领取、购买、创建Key或账号迁移；需要首次开通的协议步骤单独识别，不能藏在定时查询里。

## 通用验收

- 真实 Electron：加入后自动出现该服务真实权益，自动再次更新，退出重启仍保留；多账号/工作区/地区隔离。
- 凭据更新、失效重登、401/403/429/网络和部分失败分别检查；保留上次值与观察时间，未知不归零，旧响应不能污染新账号。
- 编辑支付金额不改变自动套餐/日期/额度。单位、共享池与资金范围不混算。
- 每项分别记录静态源码、合成协议测试、真实账号结果；没有真实账号/平台写待验证，不以构建或mock当接入成功。未经用户确认不标 accepted，不自动合并/关闭总目标。
