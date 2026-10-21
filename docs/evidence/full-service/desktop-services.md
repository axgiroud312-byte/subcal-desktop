# WorkBuddy / Trae / MiniMax Code 只读协议证据

2026-10-21。对应 #21、#27、#22 的 Code 登录路径；API Token Plan 仍由已有 regional adapter 负责。

## 状态和交付边界

- 静态源码：已实际读取固定社区 checkout，`git rev-parse HEAD` = `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`。
- 已读取 `GLOSSARY.md`、`docs/specs/full-service-entitlements.md`、本地 issues registry，以及 `gh issue view 21/22/27 --json body,title` 的实际验收要求。
- 协议：新增 `src/main/adapters/desktop-service-adapters.ts`，导出 `desktopServiceAdapters` / `createDesktopServiceAdapters(fetchFn?)`，不是失败占位。
- 导出 ID：`workbuddy`、`workbuddy-ai`、`trae-cn`、`trae-global-sg`、`trae-global-us`、`minimax-code`、`minimax-code-global`。Trae 国际按地区分开注册，避免 SG/US 回退或混池。
- 本任务只新增指定三个文件；**没有改 registry / index / discovery / UI**。主 agent 需将上述列表接入 registry，并替换相同 ID 的旧 unavailable 占位，不能重复注册。
- 真实账号、真实 Electron 加卡/重启/自动更新：**pending**。未寻找或使用任何真实账户 token；合成协议测试不能代替真实接入成功。
- WorkBuddy 5.6+ 加密来源由来源发现层报告不可读，不当成未登录；正式登录入口/解密授权不在本次三个文件内，仍由主 agent 交付。Trae 企业和 SG/US、MiniMax 个人 workspace 的真实结果均 pending。

## 来源及源码映射

checkout：`C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`，仅阅读，不导入/执行插件。

| 固定源文件 / 行 | 本次提取 |
| --- | --- |
| `packages/workbuddy/index.mjs:62-83,269-295,1037-1082` | 两站、uid/domain/enterpriseId、桌面文件与加密边界 |
| `packages/workbuddy/index.mjs:1144-1153,1202-1263` | billing POST 头、信封状态、个人积分、企业 cycle UTC+8 |
| `packages/workbuddy/index.mjs:1284-1351,1651-1679` | paid/free commodity codes、分页、NeedRenewInfo、批次失效、summary/enterprise 查询分流 |
| `packages/trae/index.mjs:33-238,376-420,739-763` | CN/SG/US 计费端点、Cloud-IDE-JWT、原设备和企业元数据 |
| `packages/trae/index.mjs:803-900` | CN storage.json 位置、账号键/设备键和编码说明；本适配器不自行读/解码文件 |
| `packages/trae/index.mjs:2463-2499,2585-2589,2673-2690` | CN credit pack、国际 USD basic/bonus、只读 POST 及状态检查 |
| `packages/minimax/index.mjs:23,31-51,314-428` | 双 MD5 签名、realUserID、个人 workspace、membership/credits |
| `packages/minimax/index.mjs:430-477,755-783` | membership 后按 op_group_id 查询 M Plan；复用已有 `MiniMaxPlanAdapter.normalize`，不重复实现 API plan |

与上游有意不同：不把缺字段转换成 0；不调用 `spareFree/liveModels`；不执行刷新、浏览器授权、设备 exchange、签到、claim、模型或完整插件。HTTP 方法为 POST 的 RPC 是查询，不是购买/领取。

## 主进程凭据契约与账户来源

输入 `CollectInput.secret` 为 JSON envelope：`{...原auth, accessToken, source, subject, alias, management:'external', locator}`。如发现层已有 `provider`，必须精确等于 adapter ID；`source` 此时可为 `desktop-opencode` / `workbuddy-desktop` / `trae-desktop`。没有 `provider` 时，`source` 必须是精确服务 ID，Trae 国际兼容原插件 `trae-global`，但仍必须有明确 `region`。

`accessToken` 优先，兼容 `access` / `token`。原 auth 字段不丢弃；`locator`、refresh、设备私钥始终不发送，不读 locator，不改源文件，不消费 refresh。外部过期访问 token 只要求原客户端重登。

| 来源 | 文件 / 条目 | 必要字段 / 上下文 |
| --- | --- | --- |
| OpenCode 社区 OAuth | Windows 默认 `%USERPROFILE%/.local/share/opencode/auth.json`，或发现层选定的 auth.json | `workbuddy` / `workbuddy-ai`、`trae-cn` / `trae-global`、`minimax-code` / `minimax-code-global` 条目；原 `access`、`expires` 及下列服务字段 |
| WorkBuddy 桌面 CN | `%LOCALAPPDATA%/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info` | `auth.accessToken`、`auth.domain`、`auth.expiresAt`；`account.uid`、`account.enterpriseId`；由发现层平铺成 envelope |
| WorkBuddy 桌面国际 | 同目录 `workbuddy-desktop-ai.info` | 同上，不能跨站复用；`{$wbEncrypted:1,...}` 不是可使用 token |
| Trae CN 桌面 | `%APPDATA%/{Trae CN,trae-cn}/User/globalStorage/storage.json` | `iCubeAuthInfo://icube.cloudide` 中 `token/userId`；唯一 `iCubeAuthInfo://icube-dc:<deviceId>` 设备键；客户端编码只能在主进程授权解码。发现层保留 account/region/machineId（如有） |
| Trae 国际 | 当前固定来源是 OpenCode 已保存 OAuth，不假装已支持未核实的 Global 桌面文件布局 | `uid`、`region`（SG/US）、`deviceId`、`machineId`（如有）、`api`、`account`、host/authHost。不会用这些 host 改写固定计费 URL |
| MiniMax Code | 固定插件的 OpenCode OAuth 条目 | `realUserID`（有则省去 user/info）、`uid`、`access`、`expires`；membership 查询返回 workspace/op_group_id。**固定插件明确不读 `~/.minimax`，本任务也不虚构该格式** |

其他平台 WorkBuddy 根目录：macOS `~/Library/Application Support/CodeBuddyExtension`，Linux `~/.local/share/CodeBuddyExtension`。Trae CN：macOS `~/Library/Application Support/Trae CN/User/globalStorage/storage.json`；Linux `${XDG_CONFIG_HOME:-~/.config}/{trae-cn,Trae CN}/User/globalStorage/storage.json`。

WorkBuddy 请求保留 `X-User-Id` / `X-Domain` / 双 enterprise/tenant 头。Trae 保留原设备，不生成/替换设备；固定插件对缺 machineId 发送空字符串，本实现相同。Trae 的 account 企业字段只参与身份/池隔离，不虚构上游没有的 tenant 请求头。输出不含原 token/refresh/locator/设备私钥。

## 数据语义和故障处理

- WorkBuddy summary 各 PackageCode 单独窗口，不跨池相加；无 packages 且已有 enterpriseId 时查询 enterprise。企业 limitNum/credit/cycleResetTime 保留，周期时间明确按 UTC+8。paid/free 每页 200，上限 10 页，截断产生 partialFailure；批次失效写 balance.expiresAt，**不是 reset 或会员截止**。NeedRenewInfo 只是请求参数，不推断 autoRenew。
- Trae 每包独立，国际 basic/bonus 分列且单位 USD；CN credits 不混成 tokens；`-1` 为无限，缺 used 不补零。end_time/expire_time 只作为 windowEnd/额度包余额有效期，**不冒充重置或会员续费**。这些两种展示共用 poolId，不是两份可相加额度。
- MiniMax Code GET user/info（无 realUserID 时），POST workspace，POST membership；只选 workspace_type=0。成功列表无个人 workspace 时停止，不静默读取企业默认空间。workspace 接口失败时兼容上游的默认 membership 查询。付费标志/套餐/会员失效/credits 和 M Plan 窗独立；仅有 hasTokenPlan + opGroupId 才 GET coding_plan/remains。quota 失败不丢 membership/钱包。
- 身份、地区、企业/租户参与 pool 隔离；expectedSubject 改变则查询前拒绝。Token expires 仅写 credentialExpiresAt。真实付款、不明确自动续费、未返回会员日期不猜测。
- 固定 HTTPS host+path 白名单，禁止重定向，响应最多 1 MiB，支持 AbortSignal 和超时。401/403/429/5xx 与业务鉴权错误分类；Retry-After 保留，上游错误文本不透传。局部失败不生成假 0，历史保留由既有采集合并层负责。

## 验证

命令：`npx tsx --test tests/desktop-service-adapters.test.ts`。

结果：本次 14/14 通过；联合 `tests/regional-adapters.test.ts`、`tests/desktop-account-sources.test.ts` 为 38/38 通过；`npm run typecheck` 通过。

合成覆盖：两站 WorkBuddy 请求/企业头/4 个 RPC/分页/失效/局部失败；Trae CN/SG/US 精确路由、设备/租户、USD bonus 分池、无限和缺项；MiniMax 双签名 canonical query、真实用户读取、个人 workspace_id=0、membership/M Plan 串联与局部失败；跨区/跨账号/已过期外部 token/取消/网络/超时/无效及超大 JSON/401/403/429/业务鉴权错误。测试没有执行源插件，也没有网络调用真实服务。

全仓 typecheck 首轮曾受并行工作中 `tests/full-service-integration.test.ts:33` 的 SafeStorageBackend Uint8Array/Buffer 类型错误阻挡；未改该文件，后续重跑已通过。最终结果以主 agent 完整集成为准。

## 版权（固定社区 LICENSE 原文）

MIT License

Copyright (c) 2026 magpie-community contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
