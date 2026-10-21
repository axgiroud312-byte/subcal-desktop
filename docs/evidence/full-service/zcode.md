# #19 ZCode 团队席位和赠送权益：独立只读适配器

整合更新：三个适配器已注册，OpenCode `zcode` OAuth 状态按 site/org/project/device 生成独立候选。注册包装器保留来源层已验证主体以供外部凭据重读，适配器自身池隔离仍生效。新增回归 `tests/service-source-wiring.test.ts`；无真实账号验证，当前边界见 [acceptance.md](acceptance.md)。

2026-10-21。**状态：已有凭据的查询及协议测试已实现；新登录、真实账号和 Electron 验收未完成。** 不关闭 #19，不将合成协议测试称为真实接入成功。

## 交付

只新增：

- `src/main/adapters/zcode-adapter.ts`
- `tests/zcode-adapter.test.ts`
- 本文件

不编辑 regional、main、shared 或其他人的文件。主 agent 注册 `zcodeAdapters`，或使用可注入 `HttpFetchFn` 的 `createZCodeAdapters(fetchFn)`：

| ID | 类 | 固定请求主机 |
|---|---|---|
| `zcode-team-cn` | `ZCodeTeamAdapter('cn')` | `bigmodel.cn`，不是模型域 open.bigmodel.cn |
| `zcode-team-global` | `ZCodeTeamAdapter('global')` | `api.z.ai` |
| `zcode-gift` | `ZCodeGiftAdapter` | `zcode.z.ai` |

这些 ID 与个人 `glm-coding-cn/global` 分开，不合并个人、团队或赠送资金池。没有 raw Key 单独直连模式：团队至少需要组织/项目/地区；赠送必须有 JWT/device。

## 给主 agent 的凭据接口

支持原 OpenCode auth（`refresh` 在该插件中是**状态 JSON 字符串**，不是拿去刷新接口消费的 token）：

```ts
{
  type: 'oauth',
  access: '现成席位key或原插件保存的access',
  refresh: JSON.stringify({
    site: 'bigmodel', // 国际为 zai；必填，不使用上游缺省 zai
    base: 'https://open.bigmodel.cn/api/anthropic',
    key: '现成团队席位key',
    token: '原样业务Authorization',
    org: 'organization-id',
    project: 'project-id',
    jwt: '可选ZCode会话JWT',
    device: '原设备id'
  }),
  accountId: '原账号id',
  source: 'zcode',
  accessToken: '主进程可附加的access副本',
  subject: '主进程已验证主体（可选）',
  alias: '显示名（可选）',
  management: 'external',
  locator: '主进程负责读取的来源引用'
}
```

也支持把上述状态字段放到顶层，以 `source:具体adapterId` 或 `source:'zcode'` 绑定来源。`provider` 若提供，必须与具体 adapterId 一致。

- **团队**：必填 `site、org、project`，以及至少一个 `key/token`。没有 key 时只查订阅与重置券，记录 quota 缺凭据；没有 token 时只查 quota，记录另外两项缺凭据。不会列出、复制或创建 Key。国际 `token` 必须已经是原状态保存的业务 Authorization（通常含 `Bearer `）；国内原状态可能是裸 token。**原样发送，不做交换，不重复加 Bearer**。`key` 的 Authorization 也是原样。
- **赠送**：必填 `site、jwt、device`，**不能用 accessToken/Coding Key 猜成 jwt**。从原 refresh JSON 取 jwt/device。设备 id 不随机生成。已能解码且 exp 过去的 JWT 本地拒绝；无法解码的 opaque token 不猜到期，交给只读接口认证；JWT exp 永不生成会员日期。
- `base` 若提供必须为该 site 的明确 HTTPS 官方主机；团队 CN/Global 错配会在联网前拒绝。若另有 region，团队须与 site 一致。
- `subject` 输出并非简单原样返回：`adapterId + sha256(site, 上游subject/accountId/凭据指纹输入, org, project)`，以确保同账号不同组织/项目/地区不串。主 agent 应使用首次 collect/probe 返回的 subject 作后续 expectedSubject。
- locator、refresh 状态只作为输入解析；不调用文件系统，不修改来源，不消费任何轮换 token，不运行上游 ownSignIn。

## 只读请求与字段

### 团队

并行、各自独立失败：

1. `GET /api/monitor/usage/quota/limit?type=2`：Authorization 为席位 key。
2. `GET /api/biz/team/subscribe/product/querySubscribeDetail`：Authorization 为已有业务 token。
3. `GET /api/biz/customer-package-reset/list?targetType=TEAM`：同已有业务 token。

三者都带 `Bigmodel-Organization`、`Bigmodel-Project`、`Set-Language:zh/en`、`Accept-Language:en-US,en`。响应为 `{code:0|200,success?,data}`；业务失败、结构缺失不是零权益。reset-list 若明确返回其他 targetType/org/project，拒绝该部分数据。

- limits：`usage/currentValue/remaining` 为数量，优先报告剩余或精确十进制差值；没有数量才用 percentage。TIME_LIMIT 独立单位为调用次数；Coding 为 credits。0 cap 为 unlimited，不把 percentage=100 当耗尽。scope=seat。
- `nextResetTime` 为毫秒，仅用于额度 reset。窗口 `unit/number` 的明确分钟/小时/天/周保留；不把月=30天固定成精确日历日期，不从缺失 number 猜五小时。
- 只有 `(hasSubscription缺失或true) && status=EFFECTIVE && memberGrantStatus=VALID` 才输出套餐和 subscribeEndTime。无时区文本按源码约定 UTC+8；仅日期保留 day 精度；秒/毫秒由该端点协议兼容。无效席位不生成 Free 或清空旧计划。
- 上游输出 renew=off 是团队席位展示策略，不足以证明组织不自动续费；因此此实现不输出团队 autoRenew。
- `fiveHourResets/weekResets` 仅计 `available===true`。缺数组未知；数组明确空可报告0；含未知 available 不计算该数组。每张可用券独立余额，单位“次”，expireTime 保存 **expiresAt**，不设 resetAt，也不触发 reset 操作。券的旧 expireTime 与 available 冲突时保留供应商 available 报告，不擅自消费或修正。余额合同没有 seat scope，故余额 scope=account，但池 ID 含完整团队/项目身份；次数指标 scope=seat。

### 赠送

并行：

- `GET /api/v1/zcode-plan/billing/balance?app_version=3.14.3`
- `GET /api/v1/zcode-plan/billing/preview?app_version=3.14.3&platform=<process.platform>-<process.arch>`

Authorization=`Bearer <jwt>`，X-Device-Mid=已有 device，User-Agent=ZCode/3.14.3。不会查询 claim、模型、keys、配置或登录路径。

- `plans` 按 active 和服务端 server_time/ends_at 过滤；最早活跃计划的名称/到期是卡片摘要，不把全部计划合并一份余额。
- `balances` 通过 user_plan_id（有则优先）、plan_id 关联仍活跃计划，过滤已失效桶；每桶保留 total_units/used_units/remaining_units，缺值不补零。total-used 精确十进制计算标 derived。
- `expires_at` 是赠送桶 **失效**，存余额 expiresAt；额度 metric.resetAt 始终 null。period_start/end 只存 windowStart/windowEnd，不说会自动补回。
- capabilities 的 `model:` 或无冒号模型值成为 models，排除 tool: 等能力；不模拟上游模型路由/可调用状态，不把同模型的不同赠送桶汇总。
- 单位优先 `balance.unit_type/unit`，再按 entitlement_id 取 owner.entitlements.unit_type。未声明则保留 `units` 并记录单位未知，**不根据 total_units 字段名猜 tokens，也不把全部 gifted units 写成 credits**。实际 preview fixture 明确包含 unit_type=token，测试覆盖其用于对应已拥有桶的映射。
- 预览仅在 samples 提示“未计入权益”，不产生已拥有余额、套餐或可用额度。preview 独立失败不遮盖 balance；只有 preview 成功时可返回提示和 balance 失败信息，但不伪造赠送接入成功。即使 preview 看起来 active，也不是已领取计划。

## 失败与验证边界

共用 HttpFetchFn、executeOfficialGet，保留 HTTPS/精确主机、重定向拒绝、取消/超时、响应大小限制、401/403/429/5xx 与 Retry-After。错误不回显供应商 body。子请求失败返回 partialFailures，主进程负责保留相应旧字段；所有请求失败抛错误。

**未完成**：新浏览器授权、组织/项目发现选择、缺失 key 获取、token 交换/刷新、外部来源定时重新读取、真实账号与 Electron 卡片验证。查询本体已实现，不以缺新登录为理由省略现成 auth 的读取。

协议命令：`npx tsx --test tests/zcode-adapter.test.ts`。合成夹具不是本次真实请求；没有连接用户账号或修改外部凭据。

最终验证：ZCode 14/14 测试通过；与既有 regional 联跑 28/28 通过；`npx tsc --noEmit --pretty false` 通过。未提交、未推送。

## 固定源码与夹具来源

固定提交 `magpie-community/plugins@aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`。已实际读取本机 `C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins/packages/zcode`。

- [index.mjs](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zcode/index.mjs)：L15–17 状态存储；L68–89 envelope/auth；L143–145 capabilities；L259–265 团队头；L333–400 业务 root/额度；L463–544 gift；L564–576 preview；L677–764 团队详情/重置券；L769–780 业务 Authorization；L1152–1177 原 auth 结构。
- [team.test.mjs L70–85](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zcode/team.test.mjs#L70-L85)：实际导出的 OAuth 状态字段，席位 key 和业务 token 分离。
- [usage.test.mjs L187–200、L237–276](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zcode/usage.test.mjs#L187-L200)：reset-list 捕获形状及 team response/header。测试借用 PERSONAL 捕获字段形状但明确改 targetType=TEAM/org/project，不能说是本次真实团队响应。
- 同文件 L330–347：原作者标明真实 preview 的 PREVIEW_CLAIMABLE/CLAIMED；本测试保留其字段/单位，但不调用领取。
- [gift.test.mjs L8–29、L149–153](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zcode/gift.test.mjs#L8-L29)：JWT/device 状态、plans/balances、耗尽 sibling。
- [dual.test.mjs L353–361](https://github.com/magpie-community/plugins/blob/aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6/packages/zcode/dual.test.mjs#L353-L361)：多 active/expired grant 和模型桶。测试固定观察时钟，金额/密钥为合成值；没有运行上游代理/plugin。

## MIT License

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
