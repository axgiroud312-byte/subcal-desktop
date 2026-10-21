# 地区适配器：只读交付与缺口

整合更新：下文是此独立模块交付时的记录；ZCode 后由 `zcode-adapter.ts` 接入，WorkBuddy/Trae/MiniMax Code 后由 `desktop-service-adapters.ts` 接入。注册和来源接线见 `index.ts`、`service-account-sources.ts`，当前验证边界见 [acceptance.md](acceptance.md)，不再以原“未实现”段代表全仓现状。

日期：2026-10-21。**状态：部分实现；只有静态源码核对与合成协议测试，没有真实账号/Electron 验收，不能关闭 #18/#19/#20/#21/#22/#25/#27/#29。**

## 交付与集成

仅新增 `src/main/adapters/regional-adapters.ts`、`tests/regional-adapters.test.ts` 和本文件。

- `regionalAdapters` / `createRegionalAdapters(fetchFn)`：13 个可查询 ProviderAdapter 实例。主 agent 负责注册、凭据导入、调度和 UI；本模块不修改共享合同。
- `regionalUnavailableAdapters`：5 个明确失败的占位（WorkBuddy CN/Global、Trae CN/SG/US）。**不要注册为已可用接入**；`supportedFields=[]`，任何查询/解析均抛 `UNSUPPORTED`，不联网。
- 单测命令：`npx tsx --test tests/regional-adapters.test.ts`。
- 本次最终结果：14/14 合成协议测试通过；`npx tsc --noEmit --pretty false` 通过（整个工作区当时状态）。
- 共用 `HttpFetchFn`、`executeOfficialGet`、`hashKeySubject`、`CollectOutput.entitlements/balances`。默认 HTTP 路径拒绝重定向，保留超时、取消、响应大小限制和 401/403/429/5xx 分类。不导入或执行完整插件。
- 所有网络调用均为写死的账户 GET。无 refresh、token exchange、模型、签到、领取、购买、创建 Key、执行 CLI 或修改外部文件。
- 主进程 OpenCode envelope 支持 `{...auth, accessToken, subject, alias, source, management:'external', locator}`；不读取 locator，不花费 refresh token。`subject` 必须来自主进程已验证身份；传入的 subject 原样用于 expectedSubject 校验，池 ID 仍含适配器 ID，防止跨区池合并。
- 也接受严格 envelope `{provider:manifest.id, region:manifest.region, accessToken, ...}`。地区采用 manifest 的固定主机；Kiro 支持原账号 region `us-east-1/eu-central-1`，MiMo 支持原 region `SGP/RU/IN`。
- 个人 GLM Coding Key、MiniMax Plan Key 可直接传 raw key；其 identity 使用 `hashKeySubject(manifest.id,key)`。其余服务拒绝未绑定来源的 raw 字符串。

## 逐服务范围

| Issue | 导出类 / IDs | 已实现 | 明确缺口 |
|---|---|---|---|
| #18 | `KiroAdapter` / `kiro-us-east-1`, `kiro-eu-central-1` | 固定地区 Get-Usage-Limits；subscriptionTitle；precision used/total/remaining；服务端 Unix 秒 reset；ACTIVE 试用独立余额，其 expiry 仅为余额失效 | 需现成 token + profileArn；无 profile 自动发现/API Key GetProfile；无 Builder ID/CLI/IDE 登录与刷新。不能只粘贴 ksk key 即声称接入 |
| #19 | `GlmCodingAdapter` / `glm-coding-cn`, `glm-coding-global` | 个人 quota 与 subscription 并行读取；Coding credits/MCP 次数/百分比；0 cap 为 unlimited；毫秒 reset；VALID 订阅；autoRenew；北京时区 nextRenewTime；日期精度保留 | 无团队身份、团队 quota/detail、ZCode gift、重置券列表。`zcode` 来源没有明确地区/模式时拒绝，不把其 JWT 当 Coding Key |
| #20 | `QoderAdapter` / `qoder-cn`, `qoder` | 两站 GET usage + Cosy-ClientType:10；device 或已交换 job token；四类池不相加；unit、套餐有效期；Enterprise 仅套餐 | 原始 PAT 不交换；VPC 明确拒绝，不回退公网；没有设备授权或刷新 |
| #21 | `RegionalUnavailableAdapter` / `workbuddy`, `workbuddy-ai` | 仅安全失败描述 | 未实现 token/uid/domain/企业上下文与 billing POST、分页/包失效；没有借用通用 Bearer GET 冒充查询 |
| #22 | `MiniMaxPlanAdapter` / `minimax-plan-cn`, `minimax-plan-global` | 两站 coding_plan/remains；Bearer + 可选 X-Group-Id；按模型保留 interval/weekly 剩余百分比；status=2 耗尽，3 跳过；服务端秒/毫秒 reset | MiniMax Code 签名账号 POST 尚未实现：无个人 workspace/member 发现、套餐有效期、Code credits 钱包、设备登录和刷新；不猜 usage_count 单位 |
| #25 | `MimoAppAdapter` / `mimo-app-sgp`, `mimo-app-ru`, `mimo-app-in`；`MimoTokenPlanAdapter` / `mimo-token-plan` | App 现成区域 session cookie，self + usage；App 剩余百分比、endTime、renewalMode；无时区按源约定 UTC+8；独立平台 cookie 查询 Token Plan detail/usage，currentPeriodEnd 无时区按 UTC；优先 month_total_token，单位保留参考 credits | 不做小米账号登录/STS/会话续期；不复用 App cookie 去平台；不查询 apiKey 或 apiKey/raw；App 与平台必须由主进程分别导入已存在会话，暂不自动关联账号 |
| #27 | 占位 `trae-cn`, `trae-global-sg`, `trae-global-us` | 仅安全失败描述 | 未实现设备绑定 IDE headers 和权益 POST、CN 多包/Global USD 包解析；不能声称仅填写 token 就成功 |
| #29 | `RaccoonAdapter` / `raccoon` | balance 与 entitlement_info 并行；available_points 原始精度；office/code 套餐及明确带时区或日精度的会员有效期 | 不读 bills；因此不输出账单推算总额度或批次失效。未知时区文本/数字有效期不猜。自定义 mainOrigin、浏览器刷新、desktop 引用读取由主进程后续接入 |

### 主进程凭据映射

- Kiro：`source:'kiro'`，原 `region`、`profileArn`、`method` 与 accessToken。`type:'api'` / `method:'apikey'` 设置 `tokentype:API_KEY`；external-idp 设置 `EXTERNAL_IDP`。没有 profile 不联网。region 与 profile ARN 区域不符不联网。
- GLM：`source:'zhipu'` → 国内；`source:'zai'` → 国际。或使用对应 manifest.id 的 provider/source。Authorization **直接为 Coding Key，不补 Bearer**。
- Qoder：`source:'qoder'/'qoder-cn'`。优先原 auth.deviceToken；`patAuth:true,type:'oauth',access` 才能作为已交换 job token；手工调用可给 `tokenKind:'device'|'job'`。拒绝带 VPC/instance/openapi 的来源。
- MiniMax：`source:'minimax-code'/'minimax-cn'` → 国内；`source:'minimax-code-global'/'minimax'` → 国际，保留 `opGroupId` → X-Group-Id。此路径只代表 Plan quota，不等于 Code 账号完整权益。
- MiMo App：从原 `auth.access` 中的 cookie JSON 解析 header；只读取 `auth.refresh` JSON 的 `base/region` 用来绑定地区，不执行其中 passToken。也可明确提供已绑定来源的 cookie。平台须独立 `source:'mimo-token-plan',cookie`。
- Raccoon：`source:'raccoon'`，现成 accessToken，固定 xiaohuanxiong.com。

## 字段与失败规则

- 无字段不补零；可只有套餐/余额而没有额度。局部 HTTP 失败以 partialFailures 返回，其余成功字段继续；双路失败抛错误。上层仍需合并旧快照，不能用缺字段清空旧值。
- reset、会员有效期、账期结束、试用余额失效分别使用对应共享字段；日期不补午夜；Token expires 永不输出会员日期。
- 直接剩余额度标 reported，total-used 标 derived；余额与百分比、模型池、组织池不相加。Raccoon 不把余额伪装 total/used。
- 支付金额不在自动输出字段内。未返回 autoRenew 不推断 false。GLM `nextRenewTime` 在自动续费情况下保存账期结束，不伪装最终会员失效。

## 可检查验证

合成测试覆盖：precision 十进制差值与 0；试用失效不作 reset；Kiro 精确路径/tokenType/profile 地区；Qoder 四池/Enterprise/PAT 拒绝/VPC 拒绝/稳定主体；GLM 原样 Authorization/局部失败/VALID/0 cap/MCP/日期；MiniMax status 和模型池；MiMo UTC 与 UTC+8、cookie 单站、App/TokenPlan 分池；Raccoon 不触发任何 grant/setting_info；所有适配器跨区拒绝与取消；401/403/429/5xx 脱敏及 Retry-After；OpenCode envelope 和 raw Key identity。

真实账号、连续调度、重启恢复、OS 外部凭据定位和真实 Electron 卡片：**待主 agent 集成后验证**。合成成功不是厂商线上成功。

## 固定源码与版权映射

已实际核对两个工作树 HEAD：

- 社区：`aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`，本机 `C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`。
- Magpie：`ba319a7587923fc7a4ea3859658244d591261a59`，本机 `C:/Users/niilo/AppData/Local/Temp/opencode/magpie-onboarding-review`。

社区固定前缀 `https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/`：

| 文件 | 实际读取的映射区域 |
|---|---|
| packages/kiro/index.mjs | L273–278 authHeaders；L305–397 query/precision/trial；L401–445 外部刷新边界 |
| packages/zcode/index.mjs | L71–89 原样 Authorization/envelope；L341–445 Coding quota/subscription；L463–544 gift（仅评估缺口） |
| packages/qoder/index.mjs | L235–253 VPC fail-closed；L1279–1300 usage；L1457–1495 解析；L1650–1687 device/PAT job token |
| packages/minimax/index.mjs | L379–495 membership/quota/地区；membership 签名链未移植 |
| packages/mimo/index.mjs | L14–23 地区；L107 appHeaders；L169–206 platform session；L239–263 auth；L406–417 时区；L500–625 两类权益 |
| packages/raccoon/index.mjs | L446–478 response；L483–574 grant 禁区与只读 query/bills 估算边界 |
| packages/workbuddy/index.mjs | L1232–1351 summary/企业/分页/失效的实际源码核对；未移植，另见 references L153–161 |
| packages/trae/index.mjs | L116–238 CN/SG/US 权益协议，因 IDE/device 认证未移植 |

Magpie 固定链接：[internal/provider/planquota.go L83–137、L244–363](https://github.com/yetone/magpie/blob/ba319a7587923fc7a4ea3859658244d591261a59/internal/provider/planquota.go#L244-L363)。复核 GLM 毫秒 reset、MiniMax count 方向不确定与模型/video 单位，不盲信 usage_count 或统一当 tokens。

### MIT License（社区映射代码）

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

Magpie：Copyright (c) 2026 yetone，MIT 全文见 [../../references/Magpie-LICENSE.txt](../../references/Magpie-LICENSE.txt)。本模块只独立移植查询字段，不加载其代理或模型功能。
