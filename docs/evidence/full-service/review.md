# 只读协议复核与修复

2026-10-21。对照固定 Magpie `ba319a7587923fc7a4ea3859658244d591261a59` 与社区 `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6` 的独立静态复核；只使用合成凭据与上游公开测试样例，没有调用真实服务或模型。

已修复：

- New API `/api/usage/token` 接受上游 `code:true`，兼容明确 `success:true`，拒绝显式失败（`internal/provider/balance_test.go:505–506`）。
- Sub2API `quota_limited` 按 `rate_limits[]` 保存 Key 预算窗口，不当账户现金（`testdata/sub2api_usage_key_limits.json`）。
- Antigravity 有效 bucket 按上游 protobuf 合同处理省略的零 `remainingFraction`；显式非法值仍未知，规则不套用 Gemini CLI（`google.go:1250–1252`、`google_test.go:477,505`）。
- Grok Bot 显式池 ID 加账号前缀，避免跨账号历史及提醒混池。
- Remote `amount` 的 `omitempty` 零值在 `used=0` 且有单位和上限时保留数量；非零缺数量不猜精确余额（`subscription_usage.go:32–40`）。
- Grok Bot 试用结束保存在窗口结束，不生成周期补满；Devin ACU `planEnd` 保存周期结束，不当额度重置。
- 积分钱包单位可保留 `credits`，不会因只接受三字母币种而让整个成功查询无法持久化。

复核确认不应修改的协议：AutoClaw 钱包使用标准 Authorization（模型代理中的 X-Authorization 不适用钱包）；StepFun 来源明确兼容 fraction-or-percent；Antigravity summary 确有 `groups[].buckets[]`；Grok CLI auth 使用嵌套账户条目；Kimi Code 数量在 `limits[].detail`、时长在 `window`。

对应回归：`tests/upstream-regressions.test.ts`、`tests/full-service-integration.test.ts`。这些证据不代替真实账号验收。
