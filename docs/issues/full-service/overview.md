## 用户目标

登录或选择已有账号后，自动展示套餐、可获取的会员有效期/续费、余额、动态额度及重置，前端信息结构接近 Magpie。只补录实际支付金额及币种。所有服务都纳入覆盖清单；没有接口字段的保持未知，不用手填代替自动接入。

## 已核实重点

- Grok Bot 实现在 Cursor 插件，使用关联Cursor账号；Grok Build及xAI API另分。
- OpenCode Go有usage，Zen无余额读取，Zen Free仅公共免费接入。
- Codex已有会员有效期claim尚需贯通；Devin可读planEnd、日周额度和ACU。
- 固定版13个旧内置已迁往插件，不能照残留代码当现役。
- 33项社区registry全部分类：20供应商包25个provider ID，13非供应商插件不冒充服务。

## 任务清单

- [ ] #6 BE-013 建立完整权益与日期合同，保留自动字段和真实来源
- [ ] #7 BE-014 建立全服务能力目录与源码覆盖检查
- [ ] #8 BE-015 补齐 Codex 会员有效期与完整额度字段
- [ ] #9 BE-016 补齐 Claude Code 多账号权益与可靠重登恢复
- [ ] #10 BE-017 补齐 Copilot 来源、企业主机与额度语义
- [ ] #11 BE-018 优先接入 Cursor 与关联 Grok Bot 的独立权益
- [ ] #12 BE-019 接入 Grok Build 订阅配额，与 Grok Bot 分开
- [ ] #13 BE-020 接入 OpenCode Go 并正确区分 Zen 与 Zen Free
- [ ] #14 BE-021 接入 Devin 订阅到期、日周额度及 ACU
- [ ] #15 BE-022 接入 Gemini CLI 与 Antigravity 的独立模型和共享额度
- [ ] #16 BE-023 接入 Kimi Code 与 Kimi Work，区分 API 钱包
- [ ] #17 BE-024 接入 Factory Standard/Core 多窗口与额外余额
- [ ] #18 BE-025 接入 Kiro Credits、试用有效期及独立登录
- [ ] #19 BE-026 接入 GLM/ZCode 个人、团队与赠送权益
- [ ] #20 BE-027 接入 Qoder 国际、国内及 VPC 权益
- [ ] #21 BE-028 接入 WorkBuddy 国内/国际及企业积分
- [ ] #22 BE-029 接入 MiniMax Code 与 API Token Plan 的地区权益
- [ ] #23 BE-030 接入 Cline/ClinePass 余额与多窗口套餐
- [ ] #24 BE-031 接入 Command Code 套餐、续费状态和余额
- [ ] #25 BE-032 接入 MiMo App 与 Token Plan 双池权益
- [ ] #26 BE-033 接入 Zed 账号和组织套餐账期
- [ ] #27 BE-034 接入 Trae 国内 Credits 与国际额度包
- [ ] #28 BE-035 接入 Open Design 套餐、续费与钱包
- [ ] #29 BE-036 接入小浣熊套餐、积分与批次失效
- [ ] #30 BE-037 接入 AutoClaw 国内/国际钱包并隔离签到
- [ ] #31 BE-038 接入 CodeArts 积分、免费 Token 和批次到期
- [ ] #32 BE-039 接入 StepFun 套餐有效期、续费与独立钱包
- [ ] #33 BE-040 接入火山与腾讯企业控制面套餐
- [ ] #34 BE-041 扩展 API 钱包、Ollama Cloud 与 Relay 模板
- [ ] #35 BE-042 调查尚无权益接口的全部服务并输出明确能力结论
- [ ] #36 BE-043 接入已有 Magpie 远端只读权益快照
- [ ] #37 FE-021 按 Magpie 信息结构展示全服务权益，只补录实际支付
- [ ] #38 QA-001 全服务真实账号验收与覆盖清单收口

## 依赖与执行顺序

共享权益合同与目录先行；各服务可在合同稳定后独立实施，不必串行等待其他服务。优先Codex字段补全、Cursor/Grok Bot、OpenCode、Claude、Devin；前端依赖共享合同，可与服务接入并行。最终逐服务真实验收收口；接口缺口调查独立推进并按证据追加实施任务。

## 研究边界

实际阅读注册入口、全部权益能力分支、供应商核心查询及代表测试、Magpie前端卡片源码。不是全仓库每行安全审计，没有调用真实账号或运行上游测试。用户附件未作为图片成功读取，前端参考仓库截图与样式。

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
