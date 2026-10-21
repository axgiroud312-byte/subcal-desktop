# 全服务权益：整合交付与验收边界

2026-10-21，接续中断会话 `ses_ea2a3b61bffe7mb5gdUSIgxdto`。工作分支 `feat/real-backend`，总目标 [#5](https://github.com/axgiroud312-byte/subcal-desktop/issues/5)，整体交付 [PR #2](https://github.com/axgiroud312-byte/subcal-desktop/pull/2)。用户验收 pending。

## 已有实现与验证入口

| Issue | 实现与协议检查 | 真实账号/剩余范围 |
| --- | --- | --- |
| #6 | schema v3、日期精度、金额/余额/额度分离、失败保留、迁移和备份；`backend.test.ts` | 合成后端验证，不代表各供应商真实字段都可获取 |
| #7、#35 | `provider-catalog.ts`、`provider-catalog.test.ts`，固定上游 registry/预设/退休项/别名完整比对 | 静态目录不等于运行时支持；无接口服务见 `catalog.md`，新管理端成本路径仍待实施 |
| #8 | Codex 专用会员 claim 与动态窗口；`full-service-priority.test.ts` | 真实查询、会员日期、重复加入、支付编辑、重启通过；旧报告另有五分钟更新记录 |
| #9、#10 | Claude OAuth、Copilot 编辑器/CLI/企业主机、凭据代次；`account-access.test.ts`、`credential-adapters.test.ts` | 本机无可用账号；失效重登、企业主机与多账号真实流程待验证 |
| #11、#13、#14 | Cursor/Grok Bot、OpenCode Go、Devin；`priority-adapters.test.ts` | 无真实账号；Zen/Zen Free 明确无可读钱包，不注册虚假余额服务 |
| #12 | Grok Build；`extended-adapters.test.ts` | 真实查询通过；完整生命周期待验证，与 Grok Bot/xAI 钱包分开 |
| #15、#32、#36 | Google、StepFun、远端缓存；`control-adapters.test.ts`、`upstream-regressions.test.ts` | 已有凭据来源/显式远端站点路径；真实账号待验证，缓存保留原观察时间 |
| #16、#17、#23、#24、#26、#28、#30 | Kimi Code/Work、Factory、Cline、Command Code、Zed、Open Design、AutoClaw；`extended-adapters.test.ts` | 除 Kimi 外已接入主动登录协议；各项真实账号授权仍待验证 |
| #18、#19、#20、#25、#29 | Kiro、GLM/ZCode、Qoder、MiMo、小浣熊；`regional-adapters.test.ts`、`zcode-adapter.test.ts` | 地区/组织隔离按协议测试；真实账号及未覆盖登录来源仍待验证 |
| #21、#22、#27 | WorkBuddy、MiniMax、Trae；`desktop-service-adapters.test.ts`、`desktop-account-sources.test.ts` | 已有登录导入及主动登录协议；真实授权、macOS/Linux、受保护存储仍待实机验证 |
| #31、#33 | CodeArts、火山、腾讯签名只读控制面；`signed-adapters.test.ts` | 合成签名与分页检查；真实权限、临时凭据、团队枚举待真实账号验证 |
| #34 | 固定钱包、Ollama、通用面板协议；`wallet-adapters.test.ts`、`relay-account.test.ts` | 真实账号待验证；SiliconFlow 退休接口明确报不支持，不伪造余额 |
| #37 | 权益日期、多窗口、模型共享池、余额分项、仅实际支付可编辑；`renderer-entitlements.test.ts` | 真实 Electron 卡片与支付编辑见 `handoff/`；数值历史未暴露给 Renderer，曲线尚未实现 |
| #38 | 全仓测试、真实桌面回归、来源证据与报告汇总 | **部分完成**：不能将缺真实账号的服务标成 verified/accepted |

上述表的协议检查使用合成凭据或固定公开样例。查询成功也不代表已验证授权、续期、失效重登、多组织切换、休眠恢复的全部生命周期。

## 应用主动登录纠正（2026-10-21）

用户明确拒绝“自己在终端登录”。本轮将登录入口改为：应用按钮 → 官方授权 → 自动保存账号/建卡/排队查询；已有账号发现保留为快捷入口。

最终自动检查：`npm run typecheck` 通过；固定源码目录核对开启后自动测试 **296/296 通过，0 跳过**。新增主进程注册的登录服务/地区 ID 共 35 项，另保留原 Codex/Copilot 设备授权。真实 Electron 登录交互检查 3 项通过，供应商响应为合成值；没有新增真实账号授权完成记录。

按用户要求删除 Google OAuth 硬编码配置，并从待推送提交历史移除。Google 两项登录需要部署端提供自己的 OAuth 应用配置，默认未配置时明确提示暂不可用；测试使用虚构配置。其他登录路径不受影响。

- 新增 `src/main/login/`：主进程会话管理、真实 PKCE/device/loopback 协议、隔离官方 CLI 编排；支持取消、过期、重复轮询幂等、切换服务丢弃旧授权。Renderer 不接收令牌。
- Cursor、Devin、Factory 见 [优先服务协议](priority-login.md)；Kiro/Qoder/WorkBuddy/MiniMax/Trae/CodeArts 见 [地区协议](desktop-login.md)。
- Claude/Grok 由应用后台调用已安装官方组件，不让用户操作终端；缺组件时提示安装，详见 [CLI 登录](cli-login.md)。本机已核对二者实际可执行文件及 `login --help`，尚未用真实账号完成本轮授权。
- Cline、OpenDesign、CommandCode、Raccoon、ZCode、MiMo、AutoClaw、Zed 见 [服务协议](service-login.md)。Zed 使用本次 RSA 私钥绑定回调，AutoClaw 国内提供应用生成的手机号/验证码页面。
- Gemini CLI/Antigravity 使用 Google PKCE/state，仅查询已有项目；StepFun 国内/国际通过隔离官方窗口登录，主进程自动确认会话，不要求书签或复制令牌。详见 [内置服务协议](builtin-login.md)。
- 修复登录与权益衔接：ZCode 身份不再二次哈希，业务 token 不误作席位 Key；MiMo 按实际权益接口 cookie 路径保存；Qoder 保存设备令牌有效期；静态凭据过期提示重登。
- `browser-login-integration.test.ts` 覆盖真实 IPC、加密保存、自动建卡、自动排队、重复轮询、取消与导出不含秘密，凭据为合成值。
- `scripts/login-desktop-check.mjs` 使用真实 Electron 窗口和 IPC，拦截供应商网络/浏览器打开；报告与截图在 `login-ui/`。这是桌面交互及隔离窗口检查，不是真实账号授权完成。

仍需供应商真实账号逐一完成授权与权益读取，不能把协议测试通过当成全部服务已线上打通。未实现主动登录的入口明确显示尚未完成；历史曲线等原有缺口不由本次登录修复覆盖。

## 前次接手续做（ec6bbef）

最终检查：`npm run typecheck` 通过；设置 `SUBCAL_MAGPIE_SOURCE` / `SUBCAL_PLUGINS_SOURCE` 指向固定源码后执行 `npm test`，**243/243 通过、0 跳过**。真实 Electron 基础回归 **6/6 通过**，报告见 `backend-regression/desktop-report.json`，包括中转站协议表单与腾讯团队 ID 可选入口。`handoff/real-desktop-report.json` 覆盖全部 62 个应用服务入口：Codex/Grok Build 实际查询成功，其余 60 个没有本机可用真实凭据，仍待验证。

- 修复卡片漏掉 `windowMinutes` 与共享池说明的问题，既有卡片回归由失败转为通过。
- 桌面回归适配新服务选择下拉框，替代已经移除的服务按钮定位。
- 增强真实桌面检查：逐服务列出待验证状态；存在订阅时必须出现卡片，并检查卡片内部横向溢出，避免空卡片列表被当成布局验证。
- 通用中转入口显式选择站点与面板协议，主进程批准后存入加密凭据，后台只执行固定 GET；New API 账号令牌和用户 ID 与 Key 预算分开。不扫描模型、不猜协议，不要求配置额度字段。
- ZCode 国内/国际团队与赠送适配器完成注册及 OpenCode OAuth 来源接线，来源身份绑定组织/项目/地区/设备；AiHubMix 账号独立读取 Magpie `balanceToken`，不把模型 Key 当账号令牌。
- 腾讯 TeamId 改为可选：留空通过隔离采集枚举真实团队，各团队独立保存和建卡；外部来源先核验原账号，再应用团队绑定，不能把原客户端切号后的数据写入旧团队。协议与来源测试通过，未有真实腾讯账号验证。

## 真实桌面证据

`real-desktop-report.json` 是前一会话的记录，其中布局 `cards: []` 不足以证明卡片几何；本次 `handoff/real-desktop-report.json` 与截图用于当前布局证据。前一报告的 Codex 五分钟自动更新检查独立保留，不重写为本次执行。

`handoff/accounts-960.png` 与 `accounts-1280.png`：真实 Codex/Grok Build 卡片，账号别名遮罩。当前观察 12px 内边距、10px 圆角，窗口/余额/实际支付分区显示。它们不代表所有服务、多窗口长文本的真实账号验证。

## 使用与未完成项

双击根目录 `启动 SubCal.cmd`，或 `npm run dev`。新增订阅选择服务，点击“登录”并在打开的页面授权；完成后自动建卡并查询。已有账号也可直接加入，API 服务保留 Key 入口；自动字段不要求手填。

缺少真实凭据的服务保持待验证；尚未支持的主动登录、部分受保护客户端来源、历史曲线、无现成权益接口的后续管理端适配仍有工作。固定版上游的全部服务已纳入研究目录，但不能据此称“所有服务均可自动登录并读到权益”。没有合并 PR 或关闭总目标。

验证使用独立临时资料库，成功后脚本清理该资料库，不改变原客户端登录；主工作区及先前源码研究目录保留。没有创建本次临时工作树。
