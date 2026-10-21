# BE-012 交付与验证记录

2026-10-21，Windows，用户验收 **pending**。关联 [Issue #4](https://github.com/axgiroud312-byte/subcal-desktop/issues/4)、[PR #2](https://github.com/axgiroud312-byte/subcal-desktop/pull/2)。代码接入已交付；缺少真实账号/平台条件的验收不标完成。

## 可以使用的入口

项目根目录双击 **`启动 SubCal.cmd`**，或运行 `npm run dev`。点击“新增订阅”即可自动发现已有登录。选择账号旁的“加入”，或者选择服务登录/填写 Key；卡片和后台任务在保存成功时自动建立。API 查询失败不会删除账号。

试用使用正常开发资料目录。自动验证另建独立临时资料库，不会把测试卡片写入用户资料，不会退出原客户端或修改它的认证文件。

## 逐服务结果

| 服务 | 开发交付 | 真实账号结果 |
| --- | --- | --- |
| Codex | 本机配置/传统凭据发现、设备码登录、托管刷新、直接 wham/usage、套餐/动态窗口/积分 | **真实 Windows Electron 通过已有登录加入→实际权益→五分钟后台更新→退出重启。**本机接口实际返回 pro、7 天额度、积分；未返回的可选窗口不猜值。设备码完成授权、真实到期重登、真实多工作区仍待验证 |
| Claude Code | 两种本机 OAuth 结构、macOS 钥匙串、只读 profile 身份核验、直接 oauth/usage、外部 Token 跟随 | **待验证**：本机未发现真实登录。没有把 CLI 普通模型请求当成查询，也没有启用缺少触发依据的 `/usage` 后备 |
| Copilot | 编辑器/CLI 凭据分流、传统系统凭据读取、GitHub 设备码、直接 copilot_internal/user | **待验证**：本机未发现真实登录；设备码/错误恢复为协议夹具测试，非真实授权。无 SDK 启动前置 |
| DeepSeek API | 支持配置导入/填写 Key，直接 user/balance，按币种保留总/充值/赠送余额 | **待验证**：未提供可用真实 Key |
| Kimi API 国内 | 配置导入/填写 Key，余额接口及业务状态检查，现金/代金券/可用余额分开 | **待验证**：未提供可用真实 Key；不宣称 Kimi Code 会员接入 |
| OpenRouter | 同账号并行查 credits 与 key，账户余额/Key 预算/Key 用量分开，一路失败保留另一路 | **待验证**：未提供可用真实 Key；权限不足不会拿 Key 预算替代账户资金 |

## 实际操作与证据

- `real-desktop-report.json`：最新真实查询为 ready，账号加入、去重、自动查询、资料保护、重启及普通备份检查。
- `background-cycle-report.json`：实际等待五分钟，第二次远端查询自动完成。该次运行在可选空窗口分类修正前，记录 partial；最新运行已修正为 ready，非伪造或抹去旧报告。
- `accounts-real.png`、`accounts-restarted.png`：真实 Electron 卡片与重启后结果，账号显示已遮盖。图中的权益来自供应商响应，不是预览数据。
- `../BE-012-regression/desktop-report.json`：6 组真实 Electron 回归通过，包括四页、两种窗口宽度、手动账单、冲突/撤销/备份、safeStorage、IPC 隔离和重启。
- 首次实际查询因 Node 独立进程未使用 Windows 系统代理而超时，账号仍保留。修正为 Electron 解析系统代理、Node 24 采集进程使用其 HTTP(S) 代理后实际查询成功；OAuth 主进程请求也使用 Electron 网络栈。

检查命令：

```text
npm run typecheck
npx tsx --test tests/*.test.ts
npm run test:account-desktop
node scripts/account-desktop-check.mjs --wait-update
node scripts/backend-desktop-check.mjs
```

类型检查通过，**70 项自动化测试通过**。Electron 构建由真实桌面检查脚本实际执行。协议夹具覆盖 Token 轮换、刷新冲突、同邮箱不同工作区、迟到响应、失效/失败保留、日期精度；这些测试不替代真实账号生命周期验收。

## 尚未满足的真实验收条件与范围边界

- 五个服务的真实账号、Codex/Copilot 设备码完整授权、真实 Token 到期/重登、真实多账号/工作区切换，需要对应登录条件，仍待验证。
- Windows 传统 CredRead 的“已知目标不存在”分支实机通过；**有效系统凭据条目的读取尚待真实条目验证**。macOS/Linux 凭据库未实机验证。
- 上游固定版本未实现的 Codex `secret_auth_storage` 特殊加密存储及内存登录不可读取，明确警告并提供设备码登录；不会冒用旧文件。Copilot 企业主机不在范围。系统代理 SOCKS 类型不支持，HTTP(S) 实机通过。
- 普通 API Key 只能按 Key 指纹去重；接口未返回账户 ID 时不会擅自合并不同 Key。
- 外部 OAuth 每次查询前、30 秒核对与唤醒重读；API 配置导入为 Key 快照，原配置更换 Key 后需重新导入。移除本应用账号不删来源配置。
- 失败保留已知数据及时间、编辑账单不覆盖自动字段已做自动化与真实桌面检查；真实供应商失败后自动恢复、休眠唤醒需进一步实机覆盖。

## 交付与清理

源码、MIT 原文、映射、测试与证据均保存在当前主工作区。没有创建额外工作树。真实检查临时资料库及其中的系统加密凭据已由脚本退出后清理；保留启动所需构建文件。原客户端配置未改写。Issue 不标 accepted，PR 不自动合并。
