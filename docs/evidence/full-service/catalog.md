# #7 能力目录与 #35 缺口调查

日期：2026-10-21。**静态源码/公开文档研究完成，不是新增服务已接入或真实账号通过。** 未读取用户凭据，未执行上游模块、模型请求、供应商登录/刷新/签到/充值，也未提交推送或修改 GitHub Issues。

## 读取基线与源码目录（供主 agent 复用）

- 先读 `GLOSSARY.md`、`docs/specs/full-service-entitlements.md`、`docs/design/full-service-entitlements.md`，以及 `docs/references/{magpie-builtins-inventory,magpie-plugins-inventory,full-service-coverage}.md`。
- `gh issue view 7/35 --json title,body,comments,updatedAt`：最新更新时间分别为 `2026-10-21T07:14:50Z`、`2026-10-21T07:15:35Z`，两项 comments 均为空。
- Magpie 固定 HEAD `ba319a7587923fc7a4ea3859658244d591261a59`：`C:/Users/niilo/AppData/Local/Temp/opencode/magpie-onboarding-review`（既有克隆，只读）。
- 社区固定 HEAD `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`：`C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`（本次克隆并 detached checkout，保留供复用）。
- 实际读取 registry、Accounts/PlanQuota/Balance/Presets/retired/aliases 分发，插件各包用量入口或解析段，Kimi Work/Zen Free/Grok Bot/AutoClaw 的关键边界及公开文档。不是全仓逐行审阅；细字段复用两份库存并保留对应固定源码路径。

## 交付与机器核对

独立 `src/shared/provider-catalog.ts`，没有修改现有 types/index/account-access 或接线运行时：

- 33 registry 项 = 20 provider 包、25 provider ID、13 非 provider；未注册 block-patterns 单列，不能算第34项。
- 58 个顶层 PresetDef 全覆盖，Region 另列；13 retired IDs 仅映射插件；4 aliases 保留 region，不重复建服务。
- 内置 Accounts 六源、Key 套餐、控制面、钱包、通用站点模板、Remote 缓存、动态 partners；每个能力条目有凭据条件、字段、限制、任务和源码。
- `implemented:false` + 全局 `static-source-only/pending` 是本次目录状态，不覆盖应用里原来已有的实现状态。目录不能直接当适配器启用表，也不代表每个账号都有列出的可选字段。
- `billing-period-end` 与 `membership-end` 分开。特意收紧 Zed/Command Code/Open Design 的账期字段语义，不因上游统一叫 `until` 就承诺会员最终失效。
- 非 provider无权益字段；page-usage只有本地请求统计；Zen Free只有静态plan名称；partners.Until只限制广告展示期；Remote不伪造本地厂商新观察。

离线测试（PowerShell）：

```powershell
$env:SUBCAL_MAGPIE_SOURCE='C:\Users\niilo\AppData\Local\Temp\opencode\magpie-onboarding-review'
$env:SUBCAL_PLUGINS_SOURCE='C:\Users\niilo\AppData\Local\Temp\opencode\subcal-catalog-plugins'
npx tsx --test tests/provider-catalog.test.ts
```

结果：**5/5通过，0跳过**，实际对本地固定 HEAD 核对完整 registry 包名/ID/kind、58预设、13退休ID、4aliases及每个引用源文件。未设置环境变量时只跳过上游对比，其余4项纯目录测试照常运行。初次`npx tsc --noEmit`通过；最终并行工作汇合时全仓typecheck被其他任务新建的`tests/control-adapters.test.ts:70`（隐式any）、`:98`（未重叠字面量比较）阻塞，没有改动他人文件。不是协议解析/真实账号测试。

许可：新增完整社区 MIT `third_party/Magpie-Community-Plugins-LICENSE.txt`，源映射 `third_party/provider-catalog-SOURCES.md`；Magpie版权为 **2026 yetone**，沿用现有完整 MIT。没有移植 Qoder 的代理运行时，后续移植其相关实现还须保留 LICENSE-CLIProxyAPI。

## #35 逐项结论

表中“未找到”只表示**本次固定源码/公开资料未建立足够协议证据**，不是供应商永久不可读；没有反向推断/猜测接口。每个模型入口的公开源依据是 [固定 presets.go](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/presets.go#L114-L605)；其中 Website/KeysURL 指向各自控制台/文档，不能把该地址当余额 API。所有下列未落地能力仍归 #35。

| ID | 明确结论与后续条件 |
| --- | --- |
| anthropic | 官方组织 Usage/Cost Admin API 可实施，见下节；个人账号不适用，不提供订阅到期/钱包证据 |
| openai | 官方组织 Costs/Usage 可实施，需 Admin key；不是ChatGPT权益，也不是可用余额 |
| google | Gemini Developer API key不足以读Cloud账单；可研究已有Billing导出，非原生余额 |
| vertex | 同上，需项目/账单权限和已有导出；gcloud模型身份不自动等于Billing读取权 |
| xai | 官方Management API已发现prepaid余额，独立management key/teamId，见下节 |
| xiaomi | 固定MiMo社区插件已有platform session `/api/v1/tokenPlan/detail`、`/tokenPlan/usage`；归#25扩展，不能用tp/API key直接代替该session |
| baidu-qianfan | personal/team/api为不同模型方案；未找到已证实个人/企业Token Plan只读权益协议 |
| huaweicloud | MaaS Token Plan与CodeArts不同；#31的STS统计不能直接套MaaS；未建立MaaS权益路径 |
| qwen | DashScope国际模型调用入口，无原生权益读取证据；需控制面权限研究 |
| qwen-cn | DashScope国内同上；不得合并国际账户 |
| qwen-token-plan | 源码L339–346明确只有控制台credits展示，无现成plan API；不能套Bailian账户 |
| bailian-token-plan | 同上，独立平台/key；控制台不是可调用权益协议证据 |
| mistral | 仅模型/key控制台预设，未建立权益只读协议 |
| groq | 仅模型/key控制台预设，未建立权益只读协议 |
| bedrock | AWS Cost Explorer只读成本路径已发现；AWS IAM/SigV4，非Bedrock bearer key；不是余额 |
| bedrock-mantle | 与Bedrock同一AWS账单归属；不可作为第二钱包累计；无Mantle专用权益证据 |
| azure | Azure Cost Management只读查询已有官方文档；需Entra/RBAC/scope，不是OpenAI resource key |
| nous | Portal模型预设，未建立余额/订阅只读协议 |
| kilo | 公共免费模型/网关不表示无限余额；未建立账户权益只读协议 |
| together | 模型入口，未建立账户权益只读协议 |
| fireworks | 模型入口，未建立账户权益只读协议 |
| nvidia | NIM模型/key入口不表示开发credits余额可读；未建立协议 |
| modelscope | API-Inference access token不等于DashScope账单；未建立剩余额度协议 |
| pipellm | 聚合模型/key入口，未建立该站余额协议；不能假定通用New API |
| 302ai | 同上，不能凭OpenAI兼容模型API猜余额路径 |
| cherryin | 同上，不能套AiHubMix账户协议 |
| yylx | auto/global/cn是路由地区，非三个可累计钱包；未建立余额协议 |
| typesafe | 此入口为决策路由，不适用“模型支持=订阅权益”；底层账户成本另研究 |
| vercel-jev | 同上，Jev不是独立钱包；Vercel账户成本另需控制面 |
| cloudflare-jev | 同上，Workers AI账户成本另需控制面；不拿模型目录作额度 |
| bailian-decision | 决策路由，不适用独立订阅；底层Bailian plan/工作区不得重复计 |
| qwen-decision | 决策路由，不适用独立订阅；底层Qwen账户另研究 |
| ollama | 本地服务，不适用供应商订阅权益；Ollama Cloud另有#34 |
| lmstudio | 本地服务，不适用；本地token计数不是钱包 |
| omlx | 本地服务，同上 |
| mlx-serve | 本地服务，同上 |
| chatgpt-api | 固定chatgpt_api.go只有独立OAuth client和settings/usage指引，无原生查询；不能复用Codex token |
| opencode-zen | 固定balance.go L1316–1343说明仅workspace owners/admins console Credits可见，模型key无余额API；不套Go /usage |
| opencode-zen-free | `usage()`直接返回名称和空窗口，无远端账户请求；不造免费无限余额 |
| siliconflow | 两站user/info有410/20092退休分支；本次公开旧API文档/llms地址404，未建立替代，归#34/#35保留退休状态 |
| tencent-personal-plan | #33企业SecretId/TeamId路径不自动覆盖个人sk-tp；个人只读协议未证实 |
| windsurf | 见下节：官方旧usage页已重定向Devin，但不能据此合并任意旧账号/余额 |

## 已发现可行路径与建议实施任务（未发布）

以下仅读取公开资料，没有请求真实API。机器可读摘要在 `GAP_RESEARCH_PATHS`；建议任务名为本地建议，不是已创建GitHub Issue。

### GAP-XAI-READONLY：独立管理端余额

- 实际成功读取：[Management overview](https://docs.x.ai/docs/management-api)、[billing](https://docs.x.ai/docs/management-api/billing)、[auth](https://docs.x.ai/docs/management-api/auth)。新版目录给出的带 `.md` 新路径有404，使用成功的旧兼容路径，不把404当接口不可用。
- base=`https://management-api.x.ai`，管理key与teamId独立于inference key。`GET /auth/management-keys/validation`确认scope/ACL；最小读取权限需实施时核定，不自动创建/轮换Key。
- `GET /v1/billing/teams/{team_id}/prepaid/balance` → `total.val`和`changes`，单位USD cents。公开例子购买1000美分后total=-1000：**符号规则须协议夹具/真实账户核验，不直接显示负资产**。可另只读`postpaid/spending-limits`，限额不等于余额；不接top-up/设置支出上限等写接口。
- 建议输入：`{"total":{"val":"-1000"},"changes":[{"changeOrigin":"PURCHASE","amount":{"val":"-1000"}}]}`；覆盖0/正负符号、大整数字符串、缺total、403和team切换。没有会员日期/续费证据。此路径不与Grok Build(#12)/Cursor Grok Bot(#11)混算。

### GAP-OPENAI-COST：组织历史用量/成本

- 人类文档入口403；实际读取官方 [openai-openapi/openapi.yaml](https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml) 中 `/organization/costs`：security=`AdminApiKeyAuth`，示例Bearer `$OPENAI_ADMIN_KEY`。
- `GET https://api.openai.com/v1/organization/costs?start_time=…`，按project/key分组、`next_page/has_more`分页；`amount.value/currency`是历史消费，不是余额、信用上限或会员有效期。
- 此读取URL是可变分支兼容地址，GitHub当前默认分支为main；本次API查询得到最新提交`3db76f5c62f01cf8e0c1cc602fdf9546b341961b`，**未声称该HEAD与raw master响应完全同一文件**。正式实施先固定已校验的schema快照/hash再写parser。
- 建议输入为官方结构：`{"data":[{"start_time":1730419200,"end_time":1730505600,"results":[{"amount":{"value":0.06,"currency":"usd"},"project_id":null}]}],"has_more":false,"next_page":null}`；覆盖分页、null维度、多币种、403与观察延迟。不套旧Relay credit_grants。

### GAP-ANTHROPIC-COST：组织成本而非Claude会员

- 实际读取[官方Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)。组织Admin凭据；个人账号不提供Admin API、workspace key不工作，AWS渠道暂不支持此API。
- `GET /v1/organizations/usage_report/messages`与`GET /v1/organizations/cost_report`，`anthropic-version: 2023-06-01`。成本为**USD cents的decimal strings**；按workspace/description分组、`has_more/next_page`分页；Priority Tier成本不包括，不能当全量钱包。
- 建议先固定官方schema再生成合成输入；测试cents小数字符串、null workspace、多个时间桶、分页、部分请求失败、个人权限拒绝。与Claude Code(#9)分开，不移植模型调用。

### GAP-CLOUD-COST：云成本（需独立授权及费用告知）

- [AWS GetCostAndUsage官方API](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html)：POST `ce.us-east-1.amazonaws.com/`、SigV4、`X-Amz-Target: AWSInsightsIndexService.GetCostAndUsage`，`ResultsByTime`/`Metrics.Amount/Unit`/`Estimated`/`NextPageToken`。IAM成本权限，不使用Bedrock bearer key；查询可能收费，不能自动开通Cost Explorer。测试跨账号隔离、分页、不同单位不相加、Estimated保留。
- [Azure Query Usage官方API](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage?view=rest-cost-management-2025-03-01)：版本2025-03-01，POST `management.azure.com/{scope}/providers/Microsoft.CostManagement/query`，查询语义；Entra OAuth + scope/RBAC，非模型resource key。响应动态columns/rows/nextLink，按列名解析，不写死列序；204≠0。文档源固定提交`8b6043bbd97a254bebbb85173707755932cf7a66`（页面提供）。
- [Google Cloud Billing导出](https://cloud.google.com/billing/docs/how-to/export-data-bigquery)：公开文档确认已有Billing→BigQuery分析路线；启用导出/创建dataset属于配置写入，不藏入定时读取；可另研究查询**已存在**导出。此次没有确认“Gemini模型Key可直接读余额”，不登记成现成原生余额接口。
- 这些都是消费报告，不拿“预算-消费”冒充剩余现金，不自动生成会员有效期。Google路线先做方案研究，AWS/Azure可拆只读成本适配任务。

### Windsurf

本次实际抓取 `https://docs.windsurf.com/windsurf/accounts/usage`，工具返回的是 **Devin Desktop Plans and Usage**，内容指向 `app.devin.ai/settings/usage`、March 2026新方案。它建立了官方产品/文档迁移线索，但不是独立Windsurf权益API证据。固定Devin插件使用`metadata.apiKey`的GetUserStatus，而不是一般Bearer API。建议#14下单列“旧Windsurf身份迁移识别”研究任务：确认账户/租户与server归属、只读响应，再决定是否共用适配器；不能见到windsurf_api_key字段就合并钱包。

## 尚待验证

- 真实账号、平台适用范围、管理权限、供应商响应时效与每个可选字段均pending；本次不关闭#7/#35，不标accepted。
- 除已成功读到的官方材料外，其他缺口结论只到“固定源码未实现”；不声称已穷尽每家供应商文档。SiliconFlow旧文档404等获取限制已明示。
- 上游静态代码的缺省零、固定plan名称、余额估算、trial expiry/credit expiry放进resetsAt等行为不能原样变成产品事实；移植时应沿用本项目领域语义及失败保留规则。
