# #11 / #13 / #14 只读适配器来源与接入合同

## 导出与调用

文件 `src/main/adapters/priority-adapters.ts`。类均实现 `ProviderAdapter`，构造函数接收可选 `PriorityFetchFn`（支持 GET/POST、显式禁止重定向）；`probe/collect/normalize/describeRecovery/disconnect`。

| 类 | manifest 导出 | id |
|---|---|---|
| CursorAdapter | CURSOR_MANIFEST | cursor |
| DevinAdapter | DEVIN_MANIFEST | devin |
| OpenCodeGoAdapter | OPENCODE_GO_MANIFEST | opencode-go |
| OpenCodeZenAdapter | OPENCODE_ZEN_MANIFEST | opencode-zen |
| OpenCodeZenFreeAdapter | OPENCODE_ZEN_FREE_MANIFEST | opencode-zen-free |

集合 `PRIORITY_ADAPTER_MANIFESTS`。暂对 id cast，以兼容并行扩展前的联合类型。没有修改注册入口/共享类型/account-access/UI。

`secret` 支持原始 token/key 或 `{accessToken,subject?,alias?,accountId?,source?,management:'external',locator?...}` JSON。source 必须分别是 cursor/devin/opencode-go；management/locator 只由调用方管理，适配器不访问路径、不写外部登录、不刷新凭据。subject 原样保留；无 subject 使用 accountId 或 token 的 SHA256 截断作为本机隔离标识。定时刷新 subject 不同报 ACCOUNT_MISMATCH。没有把 JWT 解码当作签名验证。

**Zen/Free 是无网络能力描述，不是凭据探测成功**：返回 availability=unsupported、remaining/total/reset=null，说明未验证登录；集成方不得据此设置 verification=verified。不请求模型清单、不发试探推理、不捏造免费总额/无限额度。

## 固定来源（实际读文件）

- 社区 `magpie-community/plugins@aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`，本机 `C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`，已 git rev-parse 核对。
- 内置 `yetone/magpie@ba319a7587923fc7a4ea3859658244d591261a59`，本机 `C:/Users/niilo/AppData/Local/Temp/opencode/subcal-priority-magpie`，克隆后已 detached checkout 固定提交。

| 映射 | 固定源码 | 本实现 |
|---|---|---|
| Cursor Dashboard | 社区 packages/cursor/index.mjs:421–528；usage.test.mjs | 仅 POST GetCurrentPeriodUsage/GetPlanInfo/GetHardLimit（body={}、Connect-Protocol-Version=1）。百分比、billingCycleEnd（毫秒）及 on-demand 的 cents/dollars 区别。账期结束不假装下一次扣费日；不请求模型、历史用量或 native session |
| Cursor Grok Bot（不是 grok.com） | 同文件:531–565；usage.test.mjs:165–215 | 从 JWT sub 的末段构造 WorkosCursorSessionToken Cookie，仅 POST cursor.com/api/dashboard/get-sand-usage-status。paid/legacy flags、试用过期、paid reset。独立桶，失败只追加 partialFailures，不抹去 Dashboard 成功项 |
| Devin | 社区 packages/devin/index.mjs:1739–1799；usage.test.mjs:15–105 | 仅 POST server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus，key 放 metadata.apiKey、CLI version=3000.11.3。planEnd→membershipExpiresAt；日/周百分比、reset 秒；quota billing 有 reset 但缺失 share 才允许推断耗尽；隐藏桶不展示；ACU、精确 micros USD。不会请求 freeIDs/model configs，不执行推理链。quota 不代表免费模型也被禁用 |
| Go | 内置 internal/provider/planquota.go:152–188,503–541；opencode_client.go:74–91 | GET opencode.ai/zen/go/v1/usage，Bearer+session 两个头。rolling/weekly/monthly 动态实际返回。零用量不接受虚构未来 reset。401 Key 无效；403 订阅成员/工作区不匹配，不建议盲目刷新登录 |
| Zen / Zen Free | 内置 internal/provider/balance.go:1322 起；社区 packages/zen-free/provider.mjs | 没有可采纳余额权益接口；只显示不支持。模型免费标记与路由不是个人可用免费额度 |

## 外部凭据位置建议（给 account-access；本文件不扫描）

- Cursor：Windows `%APPDATA%/Cursor/auth.json`、macOS `~/.cursor/auth.json`、Linux `$XDG_CONFIG_HOME/cursor/auth.json`（默认 `~/.config/cursor/auth.json`）的 accessToken（社区 index.mjs:112–164）；原始 JWT 也可显式传入。macOS 优先 Keychain `cursor-access-token` / `cursor-user`，受保护存储由专门登录层读取，不能把 SQLite 编辑器缓存盲当稳定授权。Bot 需要 JWT 内有效 sub；缺失时仅 Bot 部分失败。
- Devin：Windows `%APPDATA%/devin/credentials.toml`、其他 `$XDG_DATA_HOME/devin/credentials.toml`（默认 `~/.local/share/devin/credentials.toml`，社区 index.mjs:600–618）的 `windsurf_api_key` 映射到 accessToken（注意 windsurf 拼写），或显式 key。默认只允许 server.codeium.com；不采用未审计的任意 server override，防止凭据外泄。
- OpenCode Go/Zen：`%USERPROFILE%/.local/share/opencode/auth.json`（Linux/macOS 同为 `~/.local/share/opencode/auth.json`；遵从实际客户端的 XDG_DATA_HOME）。provider 条目 `opencode-go` / `opencode` 的 `{type:'api',key}` 映射 accessToken；不可把另一工作区、另一成员的 Key 当同一订阅。Free 不需要为了额度查询索取 key。

## 验证边界

`npx tsx --test tests/priority-adapters.test.ts`：12/12 通过，全部是合成协议 fixture。检查请求目标/方法/headers/body、零与缺失、部分失败、401/403、无网络分支及账号隔离。没有读取用户真实凭据、请求真实账号或声称真实账号已验证。首次完整 typecheck 通过；交付前重跑被并行新增的 `tests/control-adapters.test.ts:70,98` 错误阻塞，priority 文件无报错，完整项目由主 agent 整合复核。

## MIT attribution

Protocol/field mapping adapted from Magpie, Copyright (c) 2026 yetone, and community plugins, Copyright (c) 2026 magpie-community contributors. Both are MIT licensed.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
