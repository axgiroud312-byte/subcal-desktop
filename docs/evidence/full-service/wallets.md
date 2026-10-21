# #34 API 钱包适配器证据

## 交付与边界

仅新增 `src/main/adapters/wallet-adapters.ts`、`tests/wallet-adapters.test.ts`、本文。未改注册表、账号入口、凭据保存或隔离进程；由主流程接入已有 safeStorage / 加密 vault、账号代次和隔离采集。适配器不自行持久化、扫描、登录、刷新凭据，不执行插件或推理。

`walletAdapters` 默认只有五项：`kimi-platform-global`、`siliconflow-cn`、`siliconflow-global`、`aihubmix-key`、`aihubmix-account`。**SiliconFlow 注册表示能够识别旧协议及退休错误，不表示退休接口现在可用。** 没有重复 DeepSeek、Kimi 国内、OpenRouter、StepFun、Ollama。

主进程凭据 `secret` 可传原始 Key 或 JSON `{...auth, accessToken, subject, alias, source, management:'external', locator}`。`accessToken` 优先，兼容 `apiKey/key/token`。可选 `provider` 绑定产品；官方来源 `source` 可以是 OpenCode 导入渠道，不将来源渠道误当产品。若提供 `origin/baseUrl/baseURL`（顶层或 locator），必须与固定来源完全匹配，不能跨地区发送。账号入口必须明确区分 API Key 与账号访问令牌。New API 账号还需原来源的 `userId/accountId`。

中转仅由可信主进程配置批准：

```ts
createWalletAdapters({
  fetchFn, // 可省略，默认使用已有只读 HTTP 实现
  approvedOrigins: [{
    origin: 'https://panel.example.com',
    template: 'new-api-key',
    source: 'reviewed-panel',
  }],
});
// 中转凭据还必须带 source:'reviewed-panel', locator:{origin:'https://panel.example.com'}。
```

`approvedOrigins` 不是 Renderer 自助输入的授权参数。每条为经过主进程确认的 `{origin, template, source}`，`source` 标识已有配置中已知的协议，而非品牌/模型名猜测。一个站点批准一种模板不意味着批准其他模板。仅精确 HTTPS origin、标准 443、无路径/查询/片段/嵌入凭据；不允许 IP、通配符、任意端点、BalancePath 表达式或 Key 插值 URL。模板注册 ID 为 `template-哈希(origin:source)`。默认无中转主机权限。

## 固定源码与协议映射

已实际运行 `git rev-parse HEAD` 核实本地 `C:/Users/niilo/AppData/Local/Temp/opencode/magpie-onboarding-review` 为 **`ba319a7587923fc7a4ea3859658244d591261a59`**。来源：[Magpie](https://github.com/yetone/magpie/tree/ba319a7587923fc7a4ea3859658244d591261a59)。已阅读项目 `GLOSSARY.md`、`docs/specs/account-access.md`、`docs/specs/full-service-entitlements.md`。

| 服务 / 模板 | 固定 GET / 字段 | 固定源码依据 |
|---|---|---|
| Kimi API 国际 | `api.moonshot.ai/v1/users/me/balance`；`code:0,status:true,data.available_balance/cash_balance/voucher_balance`，USD 账户 total/cash/grant 分开 | `balance.go:60–63,411–428` 确认国际主机、USD、available；现金/代金券采用项目既有 `http-adapters.ts:451–554` Moonshot 余额字段，不与国内请求混用 |
| SiliconFlow 国内/国际 | `api.siliconflow.cn` / `api.siliconflow.com` 的 `/v1/user/info`；历史 `code:20000,data.totalBalance`，分别 CNY/USD | `balance.go:66–69,449–485`；`balance_test.go:593` 有旧 balance/chargeBalance/totalBalance。只取有确认语义的 total，不猜其他旧字段是今日现金或代金券 |
| SiliconFlow 退休 | HTTP 410 **或** JSON `code:20092` → `UNSUPPORTED`，无成功输出 | `balance.go:468–485`：2026-08-14 退休、没有替代 API；控制台 `cloud.siliconflow.cn` / `.com`。401 仍为登录错误，不误判退休 |
| AiHubMix Key | `aihubmix.com/dashboard/billing/remain`；`total_usage` 是 USD **剩余预算**，负数未设上限，不代表账户资金无限 | `balance.go:79–83,508–527` |
| AiHubMix 账号 | `aihubmix.com/api/user/self`；`success:true,data.quota / 500000` → USD account total；账号令牌原样 Authorization | `balance.go:79–83,546–570,1557–1568`；不是 API Key 查询自动升级 |
| `new-api-key` / `one-api-key` | 已批准主机 `/api/usage/token`；`success:true,data.total_available / 500000` → USD key budget，Bearer Key | `balance.go:96–105,121–129`，明确 new-api 与 one-api Key 协议；未注册无证据的 One API 账号令牌头 |
| `new-api-account` | 已批准主机 `/api/user/self`；`success:true,data.quota / 500000` → USD account total；原样账号令牌 + `New-Api-User` | `balance.go:121–129,247–257,1241–1249` |
| `sub2api-account` | 已批准主机 `/api/v1/user/profile`；`data.balance` → USD account total，Bearer 登录 JWT | `balance.go:106–113,133–145,1557–1568` |
| `sub2api-key` | 已批准主机 `/v1/usage`；`remaining` 为当前 Key 可消费预算；`rate_limits` 各自 5h/1d/7d 的 limit/used/remaining/window_start/reset_at | `balance.go:109–113,135–137,1294–1305`；`sub2api_usage.go:3–61`；`testdata/sub2api_usage_key_limits{,_not_started}.json`。只移植额度字段，不执行夹具中的任何模型 |
| `credit-grants` | 已批准主机 `/dashboard/billing/credit_grants`；`total_available` 与 `total_used` 独立 USD account total/usage | `balance.go:114–116,130–132`；不将历史 total_granted 冒充当前赠送余额 |

这只是固定协议模板，不声称任意同名厂商或中转站均兼容。不做自动探测、API Key/账号令牌降级重试或跨区回退。

## 正确性及验证

- JSON 数字在既有 GET 层解析前按词法保留为十进制字符串，支持精确指数展开；`/500000` 与减法采用 BigInt 定点运算，不四舍五入到两位。超长值/指数拒绝，不伪造零。
- `balances[]` 分 scope/kind/currency；账户与 Key 不混并、不累计分项。AiHubMix 无上限 Key 只有 `scope:key` 的 unlimited 预算观察，无账户余额。Key 池同时绑定产品、来源主机、subject 与 Key 指纹，避免同账号多个 Key 互相覆盖。
- 未返回金额记局部缺项，全无可读值抛出 schema 错误。Sub2API 未提供 used 不归零；未开始窗口不推算 reset_at。不推断会员/续费/实际付款。
- 外部取消、401/403/429/5xx、业务拒绝、退休均保持错误；适配器不写旧快照。HTTP Date 比本次采集旧时用旧时间；明确传入的 providerAt 旧时间也保留，字段时间不改成读取时刻。落库继续依赖现有按字段旧响应拒绝/账号代次检查。
- 测试只用静态合成响应；没有真实密钥、没有真实账号请求。**真实账户验证全部待验证**：包括国际 Kimi 权益对照、两区 SiliconFlow 退休响应、AiHubMix 两种凭据、每个实际获批 relay 部署、Electron 自动加入/重启/调度与 safeStorage 生命周期。不可凭这些单测宣称真实接入验收通过。

验证结果：`npx tsx --test tests/wallet-adapters.test.ts` **13/13 通过**；`npm run typecheck` **通过**。这些是静态协议与类型验证，不是实际账号或桌面验收。

## MIT 许可（移植协议映射）

MIT License

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
