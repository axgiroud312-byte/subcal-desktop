# #31 / #33：只读签名协议交付

整合更新：已注册到应用，来源与账号入口已接线；下文保留独立协议模块交付时的验证记录。当前交付/真实账号范围见 [acceptance.md](acceptance.md)。

日期：2026-10-21。范围仅新增 `src/main/adapters/signed-adapters.ts`、`tests/signed-adapters.test.ts` 和本文件。**协议已实现并通过合成测试；未注册、未进行本机账号发现、未验证真实账号，不代表 accepted。** 注册及来源识别由主 agent 整合。

## 已实际读取的依据

先读取 `GLOSSARY.md`、`docs/specs/full-service-entitlements.md`、`docs/issues/full-service/{codearts,cloud}.md`、共享权益/余额合同和现有适配器约定。

实际读取并以 `git rev-parse HEAD` 核实的本机固定源码：

| 固定基线 / 本机目录 | 阅读位置 | 本次映射 |
| --- | --- | --- |
| Magpie `ba319a7587923fc7a4ea3859658244d591261a59`；`C:/Users/niilo/AppData/Local/Temp/opencode/magpie-onboarding-review` | `internal/provider/volcengine_usage.go:185-277,292-422` | HMAC-SHA256、GetCodingPlanUsage、GetAFPUsage、地区、窗口百分比和 reset |
| 同上 | `internal/provider/tencent_usage.go:150-322,325-406` | TC3-HMAC-SHA256、DescribeTokenPlanList / DescribeTokenPlan、TeamId、额度及周期日期 |
| 同上 | `internal/provider/volcengine_usage_test.go:19-43`；`tencent_usage_test.go:19-39` | 火山 SDK 两个固定签名向量、腾讯官方文档固定签名向量 |
| 社区 `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`；`C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins` | `packages/codearts/index.mjs:55-110,385-439,443-497,1339-1404,1421-1468,1801-1934` | Huawei SDK-HMAC-SHA256；只读统计、token 余额、积分包 POST 分页及活动积分 GET 分页；access JSON 结构 |
| 同上 | `packages/codearts/index.test.mjs:148-167` | 核对 SDK-HMAC 的尾随斜线、排序、哈希规则；本次 GET/POST 查询使用另一个独立 Python 标准库向量 |

未运行、未 import 社区插件。未复制其登录/刷新、DPoP、签到、领取、模型或账本写入逻辑。

## 实现和安全边界

- 导出 `signedAdapters` / `createSignedAdapters(fetchFn?, now?)`，默认五项：CodeArts、北京火山 Coding、北京火山 Agent、广州腾讯企业、Singapore 腾讯企业。
- 类导出：`CodeArtsAdapter`、`VolcenginePlanAdapter(kind, region, fetchFn?, now?)`、`TencentTokenPlanAdapter(region, fetchFn?, now?)`。火山其他地区应按来源真实地区构造并注册实例，不跨区回退。
- `SignedFetchFn` 支持 GET / POST、body、AbortSignal，返回结构与现有 HTTP fetch 一致；默认实现拒绝重定向并流式限制 1 MiB。测试注入 fetch 时也限制最终正文。未调用现有仅支持 GET 的 bearer 帮助函数。
- 只签名并发送固定调用路径；外部凭据不能提供请求 URL。主机限制在 manifests 白名单：`open.volcengineapi.com`、`tokenhub.tencentcloudapi.com`、`snap-access.cn-north-4.myhuaweicloud.com`、`opengw.developer.huaweicloud.com`。
- CodeArts 唯一 POST 为 `snap-manager/v1/package/credit/page`（查询，不创建/领取）。其他为 statistics/plugin、user/tokens/balance、ops/credit/overview 和 ops/credit/campaign GET。
- 火山仅 GetCodingPlanUsage / GetAFPUsage；腾讯仅 DescribeTokenPlanList / DescribeTokenPlan。绝不请求个人版推理 Key、模型、claim、confirm、delivery、onboard、OAuth、STS 刷新、创建会话或购包。
- 查询超时和取消即使传输层不响应 AbortSignal 也会拒绝结果。相同 connection 的新查询、disconnect 会使旧在途响应失效。expectedSubject 不匹配（包括 probe）先于网络拒绝。
- subject 优先沿用主进程来源模块构造的主体；没有主体时由服务/套餐、region、已验证 accountId（缺失时 AK ID 指纹）、TeamId 派生。来源模块与手填入口负责将地区和团队纳入身份，Renderer 不能单独指定 subject。临时 token 不充当身份；有稳定已验证 accountId 才能跨 AK 轮换保持同一 subject。无稳定身份时换 AK 必须重新接入。
- 主 agent 仍必须保留服务层 connection generation / 凭据代次提交前检查；适配器的在途隔离不能代替 DB 层 CAS。401/403、账号错配及取消属于终止错误，不作为普通局部故障吞掉。
- 错误只输出固定脱敏提示，不回显供应商正文、SecretKey、token 或凭据；samples 不带原始响应。401/403/429、业务错误、超时分别分类。
- 真实查询失败不返回空成功来清空旧值；子查询失败提供 partialFailures，已成功字段正常返回，复用现有 merge 保留旧余额和观察时间。

## 相对上游的修正 / 保守处理

### 腾讯

- 上游只请求 Offset=0。本次 Limit=100，读取到 TotalCount 或短页，最大 100 页；检测分页停滞，后续页失败保留前页且标部分失败。
- 以 TeamId 去重、逐团队详情查询；详情提供不同 TeamId 时整次拒绝，不能用另一团队返回覆盖。详情只返回部分 PackageInfo/TokenSummary 字段时合并列表已有字段。
- 企业专业套餐 `enterprise` 用 credits；`enterprise-auto` 用 tokens；未知 ProductType 不猜单位、不生成伪额度。
- PackageInfo.ExpireTime → membershipExpiresAt；TokenSummary.CycleEndTime → billingPeriodEnd 和真实窗口 reset；CycleStartTime → windowStart。没有 CycleEndTime 时不沿用上游按 StartTime/CurrentCycle 推算月末的行为。
- 多团队统一连接可展示独立组织 scope / TeamId 池，但共享合同只能放一组顶层 entitlements，**因此不把多个团队的会员日期写成一个账号日期**，而是标记 `team:…:membership-date-requires-team-connection`。主进程应自动按已返回 TeamId 建团队连接；有 teamId 的凭据仍读取完整团队列表，只查询该团队详情，不要求用户手动填写额度/日期。单团队连接输出独立有效期和账期。
- 个人 Token Plan 仍未证明有可读 API，不冒充支持。

### 火山

- region 同时进入签名、manifest id、subject、pool；Coding 和 Agent 分离。
- Coding 使用真实 Percent；AFP 优先 Percent，只有 Used + Quota/Total 且正数才推导百分比。AFP 原始绝对数量单位没有证据，故不猜 tokens/credits。
- session 明确为 5 小时，weekly 为 7 天；monthly 不凭空标 30 天。ResetTime / ResetTimestamp 支持秒、毫秒、带偏移时间。
- 无会员有效期、续费或付款推断。临时 AK 安全令牌作为 `x-security-token` 参与签名；此临时凭据分支的真实供应商调用仍待验证。

### CodeArts

- credits 与免费 daily tokens 独立，不转换、相加。daily reset 按源码北京时间次日零点规则推导，`resetObservation.evidence=derived` 并明确规则来源，未伪装成接口返回值。
- 统计中 basic 的 end_date 只作额度 reset；总额可能混合购买/赠送积分，故不把 basic 的 reset 批量复制给总额或赠送余额。
- package/credit/page 的 basic/ondemand 与 bonus 两组查询、campaign benefits 均按 pageNum/pageSize 继续读取，最大各 100 页；失败保留已获得批次。
- 每个积分批次单独余额与 expiresAt；到期只代表批次作废，不作为会员到期或 reset。统计总量和分项都保留独立 id/kind，**不能重复加总**。
- 优先供应商批次 id/packageId/benefitId；缺 id 时用类别、创建时间、过期时间、原始数量生成稳定指纹，相同无法区分的批次不累加。同一批次新 used 不改变 id。
- 只要返回了缺数量，不补零、不把缺字段当免费池用尽。不使用外部签到 ledger，也不推算赠送积分“领取后 30 天”。
- 没有明确会员/账期/自动续费信息就不填 entitlements；CodeArts STS expires_at 只进入 credentialExpiresAt。

## 给主 agent 的凭据与来源接线建议

仅主进程/采集进程接触以下 JSON；不得将这些字段加入 Renderer 表单、日志或备份。

统一展开结构（值均为占位符）：

```json
{
  "provider": "volcengine",
  "region": "cn-beijing",
  "accessKeyID": "<account-control-plane-ak>",
  "secretAccessKey": "<account-control-plane-sk>",
  "securityToken": "<optional-temporary-token>",
  "accountId": "<optional-source-verified-account-id>"
}
```

- 火山来源：Magpie provider 配置 `accessKeyID` / `secretAccessKey`（实际阅读到 provider.go 的该 JSON 名称）；Ark 官方 endpoint 的 `ark.<region>.volces.com/api/coding` / `/api/plan` 用于识别套餐/地区，不作为查询目标。推理 sk key 不是 AK/SK。
- 腾讯 provider 可用 `tencent-cloud` 或 `tencent`；字段也接受 `SecretId` / `SecretKey`、`secretId` / `secretKey`，可带 `TeamId` / `teamId`。`tokenhub.tencentmaas.com/plan` 映射 ap-guangzhou，`tokenhub-intl.tencentmaas.com/plan` 映射 ap-singapore；其他 endpoint 不自动套用企业协议。只从已有本机配置或用户明确提供的 CAM 只读凭据取值，不创建新 Key。
- CodeArts OpenCode auth envelope 可原样加服务来源后放入 secret；**不能只取 access 当 bearer 或只取 key 丢弃 metadata**：

```json
{
  "provider": "codearts",
  "type": "oauth",
  "metadata": { "region": "cn-north-4", "accountId": "<verified-user-id>" },
  "access": "{\"access_key_id\":\"<temporary-ak>\",\"secret_access_key\":\"<temporary-sk>\",\"security_token\":\"<temporary-token>\",\"expires_at\":\"<offset-ISO-time>\"}"
}
```

- 合并取值顺序 metadata → 解析后的 access → envelope 顶层；access（或接线层 accessToken）可为对象或 JSON 字符串。AK 支持 access_key_id/AccessKeyID/accessKeyId/accessKeyID，SK 支持 secret_access_key/SecretAccessKey/secretAccessKey；令牌支持 security_token/securityToken/Token/sessionToken；寿命支持 expires_at/expiresAt/expiration/expires（带偏移 ISO 或 epoch）。不修改原 envelope。
- CodeArts 地区固定 cn-north-4，可以由经核对的 provider 固定来源自动补齐；火山和腾讯必须按真实 endpoint 保留原地区，不应为多个候选盲目复制一份凭据。
- 从 OpenCode 标准 auth.json 对应 provider 项只读导入（本机路径由项目现有来源定位器决定，含 XDG 覆盖），不要执行其插件。其他原始 refresh_token / PKCE / DPoP 可留在加密原始 envelope 供来源跟随，但适配器完全不使用、不消耗它们；外部刷新后由主进程读取新代次。
- 腾讯团队建卡可根据返回 metrics 的 `team:<TeamId>:cycle` / pool 识别，但更完整的团队发现应在主进程接线时单独复用 DescribeTokenPlanList 的真实 TeamId（包含无已知单位的团队）；不要把当前聚合输出声称为完整团队发现。

## 验证记录

`npx tsx --test tests/signed-adapters.test.ts`：18/18 通过。

覆盖三家固定签名向量、RFC3986、临时 token、地区/来源拒绝、CodeArts OpenCode envelope、过期凭据、Tencent 101 团队分页、TeamId 详情错配、详情暂时不可用/后页失败、未知单位、CodeArts 批次分页、零值/缺值、积分与认证/会员/账期日期分离、局部失败 merge、旧 subject 迟到、disconnect、忽略 signal 的 transport 超时和取消、脱敏错误。

Huawei 签名固定值使用 Python `hashlib` / `hmac` 独立算出，未调用本适配器生成期望值；火山/腾讯期望值来自上述固定上游测试。

最后再次执行全仓 `npm run typecheck`：通过。此前其他并行文件一度阻挡类型检查，随后由并行整合修复；本任务未修改这些文件。

真实账号、权限策略、临时签名 token 的远端接受情况、Electron 加入/持久化/自动更新/外部凭据代次跟随：**待验证**。不因缺账号阻挡协议实现，也不把合成测试描述成真实联通成功。未提交、未更改现有注册文件。

## 许可证

保留既有 `third_party/Magpie-LICENSE.txt` 与 `third_party/Magpie-Community-Plugins-LICENSE.txt`，本适配和测试的上述来源适用以下许可：

```text
MIT License

Copyright (c) 2026 yetone
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
```
