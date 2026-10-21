# 独立只读适配器证据与整合说明

## 交付边界

新增 `src/main/adapters/extended-adapters.ts`、`tests/extended-adapters.test.ts` 和本文，未改共享注册表、凭据服务、前端或任何上游文件。未提交/推送。

**状态：固定源码静态确认 + 合成协议验证；全部真实账号/Electron 纵向验收仍 pending。** 不把测试通过等同接入生产账号，不关闭 Issue。

2026-10-21 实际执行 `git rev-parse HEAD` 确认：

- Magpie：`C:/Users/niilo/AppData/Local/Temp/opencode/magpie-onboarding-review`，HEAD `ba319a7587923fc7a4ea3859658244d591261a59`。
- 社区：`C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`，HEAD `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`。
- 已读项目 `docs/references/full-service-coverage.md`、`magpie-plugins-inventory.md` 以及本组 `docs/issues/full-service/*.md`；通过 `gh api repos/axgiroud312-byte/subcal-desktop/issues?state=all&per_page=100` 实读 #12/#16/#17/#23/#24/#26/#28/#30 正文。未执行插件运行时。

## 固定源文件映射 / 版权

社区基址：[magpie-community/plugins@aee6b9d](https://github.com/magpie-community/plugins/tree/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6)。以下都映射到新增 `extended-adapters.ts` 同名产品分支及 `extended-adapters.test.ts`，不是退休内置实现：

| Issue / 本地 ID | 实读源文件与范围 | 实现结果与有意差异 |
| --- | --- | --- |
| #12 `grok-build` | `packages/grok/index.mjs` L123–149、L168–191、L679–744；`packages/grok/usage.test.mjs` | CLI auth.json 只读；固定 billing GET；主额度/按需额度仅百分比。`currentPeriod.end` 优先，RFC3339 才作 reset；不运行 `grok models`，不制造旧 429 窗口。缺失百分比不沿上游默认零。 |
| #16 `kimi-code` / `kimi-code-cn` | Magpie `internal/provider/planquota.go` L397–487、`presets.go` Kimi Code 两站、`plan_key_allowance_test.go` / `planquota_test.go` 搜索结果 | 国际 `api.kimi.ai`、国内 `api.kimi.com` `/coding/v1/usages`，周/短窗只暴露已核验的百分比，不冒充 token。 |
| #16 `kimi-work` | `packages/kimi-work/index.mjs` L15–35、L68–78、L128–134；`kimi-work.test.mjs` | 每次只读官方 desktop config；核验 Work `baseUrl`，使用 web access token 请求唯一 GetSubscriptionStats POST `{}`；仅会员共享百分比，不查询模型、不刷新、不写回。 |
| #17 `factory` | `packages/factory/index.mjs` L325–374、L927–1015、L1846–1870；`usage.test.mjs` | US/EU 固定 host、组织头、Standard/Core 三窗口、毫秒/ISO windowEnd、USD 美分转换；分池不相加。没有自动组织重签/refresh；私有任意 host 不支持。 |
| #23 `cline` | `packages/cline/index.mjs` L678–773、L939–975 | me/limits/balance 分路；404 limits 仅表示无 Pass；微美元除 1e6；一端失败保留另一端，所有失败保留真实 AUTH/429 等错误类型。有限兼容 credits 形态，不照搬任意深度递归金额猜测。 |
| #24 `commandcode` | `packages/commandcode/index.mjs` L374–599 | subscription/credits 独立查询；保留 billingPeriodEnd 与 bool cancel 推导 autoRenew；金额分桶保留 USD；**不复制静态 planMonthly 推算总额**，因此无虚假月池/用量百分比。 |
| #26 `zed` | `packages/zed/index.mjs` L157–224、L1059–1108；`usage.test.mjs` | 精确 `Authorization: userId accessToken`；选有效组织计划；只有 plan 卡，没有假窗口。账期末仅 billingPeriodEnd，不作会员最终到期/续费；非默认组织不挪用个人账期。欠费是 partial，不标 token 失效。 |
| #28 `opendesign` | `packages/opendesign/index.mjs` L60–85、L180–255、L379–420 | control key 与 runtime key 区分；workspace/current、preflight、summary；USD/credits 分开，summary 局部失败不抹去 preflight。空金额不归零；autoRenew 仅有明确 subscriptionStatus 与 bool cancel 时产生。 |
| #30 `autoclaw` / `autoclaw-cn` | `packages/autoclaw/index.mjs` L25–42、L225–244、L329–348、L692–745 | 仅区域钱包 GET，按源码业务头签名，total_balance 原始精度保留。余额非 total 配额、没有 used=0 假进度。**代码无 task-list/task-complete/签到开关路径**，不跨区域回退传凭据。 |

上述为协议与解析移植，不执行/导入完整插件。该文件保留两个版权；MIT 全文见本文末尾。社区 `APP_ID/APP_KEY` 是上游客户端公开业务签名参数，不是用户凭据；不会对外输出用户 token。

## 给主 agent 的接入接口

导出 `extendedAdapters: ProviderAdapter[]`，共 11 项；也导出 `ExtendedProviderAdapter` 与各产品具体类、`ExtendedAdapterOptions`、`ExtendedCredentialResolver`。

构造器参数是 `{ fetchFn?, postFetchFn?, resolveCredential? }`，不是裸 fetch 函数。

- GET 全复用 `HttpFetchFn` / `executeOfficialGet`（HTTPS/host 白名单、状态码、超时/取消、大小限制）。生产请注入现有系统代理 transport。
- `postFetchFn` 只供 Kimi Work 一个固定只读 RPC，协议类型 body 必为 `'{}'`，redirect 固定 error；也复用 executor 的超时/状态/大小处理。默认 POST 流式读取上限 1 MiB；如系统代理 GET transport 不兼容 POST，请显式注入这个单独 transport。
- `resolveCredential(id,input)` 是复杂登录/外部来源桥接点，返回**当前 accessToken** 与必要元数据，不传 refreshToken。外部来源每次重读；不得消费/旋转其 refresh。自有 OAuth 的串行刷新、先安全持久化，仍由主进程现有授权服务负责，适配器不会刷新。
- 原始 key 的 subject 与主 agent 约定一致：`${providerId}:${sha256(key.trim()).slice(0,12)}`。JSON `subject` 优先原样沿用，绝不重复加 provider 前缀。JSON 支持 `accessToken,subject,alias,source,management,locator,userId,organizationId,systemId,region,controlKey`，其中 source/management/locator 是桥接元数据，不会改变网络目标。
- 主 agent 需要在 AdapterManifest union/数据库 schema/注册表/服务目录扩展这些 ID。本文件暂用局部类型断言兼容尚未拓展的 union，没有复用退休 ID。真实账号验证状态必须 pending，manifest 的 `official_auto` 仅复用当前 transport tier，不代表已通过真实验收。
- 登录 envelope 不应让用户自己填写 JSON；下表是**主进程**接入字段，不是新增用户配置步骤。

| ID | 推荐入口与主进程凭据元数据 | 自动支持信息 |
| --- | --- | --- |
| grok-build | 本机 Grok Build 登录（已有默认只读 GROK_HOME/auth.json），或授权模块 accessToken+subject | 主/按需百分比、供应商窗口 reset |
| kimi-code / kimi-code-cn | 用户必要 Code key；区域由服务 ID 固定，不能拿 Moonshot API key 代替 | 周/短窗口百分比与 reset |
| kimi-work | 本机 Kimi Work 登录（已有默认只读 config 解析），保存 source/locator/稳定 subject 的账号引用；后续每次 reread | 会员共享百分比，没有日期/绝对量 |
| factory | fk-key，或授权模块 accessToken+subject+organizationId+region(us/eu) | Standard/Core 分池、窗口 reset、额外 USD 余额 |
| cline | key，或授权模块 accessToken+subject+userId（userId 作为 me 不可读时 fallback） | ClinePass 三窗、USD 钱包/有限 credits 兼容 |
| commandcode | key 或官方登录导入 accessToken+subject | 套餐 ID、账期末/自动续费、额度窗、月/购买/免费 USD 分项 |
| zed | 授权模块必须给 accessToken+userId，可附 subject/systemId/organizationId | 组织套餐、可归属的账期末、欠费提示，无用量窗 |
| opendesign | 账户授权 controlKey（envelope `controlKey`，或原始 `vela_ctrl_…`），不是 runtime key | Design Plan、账期末/续费、credits 窗、USD 钱包，workspace 隔离 |
| autoclaw / autoclaw-cn | 对应区域授权模块 accessToken+subject | 总/最多 3 子钱包 credits，不自动签到 |

账户池包含 provider/subject/organization/region；Factory Standard/Core 各自共享窗口池，不跨账号或区域合并。所有余额均未设置实际支付价格。

### 尚未实现 / 不能宣称已完成

- 本组三文件没有接入新的自有设备码/浏览器 OAuth UI、Factory/ Cline 自有 refresh 状态机、Zed 原生登录、Open Design 设备授权和 AutoClaw 两区登录。必要 key 可直接查，复杂授权由上面 resolver 接主进程已有能力；若主进程没有这些能力，相应用户登录入口仍属于未完成，不应以 adapter 已注册冒充完整纵向交付。
- 除 Grok Build 与 Kimi Work 外，没有新增自动定位/解析外部客户端凭据文件。其他来源由主进程受信 resolver 承接，不能让 Renderer 传任意文件路径。
- Cline credits 非当前 `{balance}` 兼容形态只覆盖明确 total/used/remaining/credits 字段；真实更多 schema 待有账号样本后补齐。
- 不生成供应商未给出的 membershipExpiresAt/nextBillingStart/真实支付日期。Command Code/Open Design/Zed 的 period end 仅账期边界；不会伪造“最终到期”或扣费事件。
- 没有真实账号凭据，没有发真实供应商请求，没有 Electron 加卡/持久化/再更新验收。以上都需主 agent 集成后验证。

## 测试记录

命令：`npx tsx --test tests/extended-adapters.test.ts`。覆盖 11 ID、固定读协议、产品区域隔离、Grok period 优先、Kimi ratio/数值字符串、Factory epoch 毫秒与 USD、Cline 404 与双路 partial、Command Code period/renew 与不造月总额、Zed 组织选择与不挪账期、Open Design key 类型与空金额、AutoClaw 无签到、稳定 subject/token rotation、多账号池、401/403/429/503、取消/大小限制。

首次执行 21 项：20 通过，1 项发现 Open Design 缺失 subscriptionStatus 仍错误生成 autoRenew，已修复为必须明确 status；另补本机登录只读/轮换测试两项。**最终 23/23 通过，无跳过；`npx tsc --noEmit` 完整通过**（首次并行开发期间的外部类型错误已由其他 agent 修复，未越权修改）。

## 完整 MIT 许可

MIT License

Copyright (c) 2026 magpie-community contributors

Copyright (c) 2026 yetone

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
