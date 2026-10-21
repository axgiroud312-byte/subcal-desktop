# Control / wallets / remote — implementation evidence

整合更新：本文保留独立模块交付时的边界；CodeArts/火山/腾讯已由 `signed-adapters.ts` 补充，其他钱包见 `wallets.md`。应用远端入口使用 `remote-account-adapter.ts`，中转入口使用 `relay-account-adapter.ts`，不是直接启用未配置的工厂。当前状态统一见 [acceptance.md](acceptance.md)。

## Status (2026-10-21)

This is **protocol-fixture validation, not a successful live-account claim**. No real credentials were used. No onboarding, inference, model listing, check-in, claiming, token refresh or remote refresh request is implemented. Only the three files assigned to this workstream were created; registration, credential UI and adapter-ID/schema integration belong to the integrating agent.

Exports: `controlAdapters: ProviderAdapter[]` and `createControlAdapters({ fetchFn?, remoteOrigins?, relays? })` in `src/main/adapters/control-adapters.ts`.

| Issue / adapter IDs | Implemented read protocol | Limits / remaining work |
|---|---|---|
| #15 `gemini-cli` | POST `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`, body `{project}` | Existing OAuth access token + provisioned project required. No `loadCodeAssist`, `onboardUser`, OAuth login/refresh or model calls. Token expiry requires external reauthentication. |
| #15 `antigravity` | POST `https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`, body `{project}` | Group/window quotas only; deliberately no `fetchAvailableModels`. Missing ratios remain unknown, never zero. Existing entitlement/project must already work. Internal API may change; source warns use outside Antigravity can risk account suspension. |
| #32 `stepfun-plan-com`, `stepfun-plan-ai` | POST platform `/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit` and `/GetStepPlanStatus` | Existing web session required; not an API Key. `Oasis-Token=access...refresh`, web ID and site-specific app ID. No RefreshToken call. Quota/status failure isolated, but auth/permission/cancellation is fatal. |
| #32 `stepfun-balance-com`, `stepfun-balance-ai` | GET API `/v1/accounts`, root `balance` | Raw API key or external envelope. `.com` CNY, `.ai` USD. API balance is not a Step Plan subscription quota. |
| #34 `ollama-cloud` | GET `https://ollama.com/api/balance` | Included USD allowance separated from purchased USD balance and legacy session/weekly percentage windows. Not local Ollama model/server probing. |
| #34 configurable `relay-{protocol}-{originHash}` | GET `/api/usage/token` (new-api-key), `/v1/usage` (sub2api-key), `/dashboard/billing/credit_grants` | Requires application-approved HTTPS origin and explicit protocol. New-api quota / 500000 converted exactly using decimal/BigInt, not floating-point money. Key-scoped budget is not an account cash wallet. No arbitrary JSONPath, key-in-URL, account JWT login or arbitrary endpoint templates. |
| #36 `remote-magpie` | GET approved origin `/v1/magpie/quotas/cards`, `{data:[...]}` | Cached numeric/unlimited windows only. Remote provider+user+kind+pool/name and configured origin are isolated. No `/refresh`, vendor calls or nested-remote propagation. Card error bodies are not exposed. Missing cached read time yields `unfetched` values, not fresh usage. |
| #31 CodeArts | **Not implemented / not registered by this module** | Read community PKCE/DPoP/STS + SDK-HMAC-SHA256 source. Need independently verified signer vectors, temporary-credential expiry handling, signed quota responses and negative cases before claiming support. No placeholder adapter returns success. |
| #33 Volcengine / Tencent | **Not implemented / not registered by this module** | Read Magpie signing and control-plane source. Need complete canonical/signature vectors, plan enumeration, units/dates/error classification and an authorized real-account check. Tencent source itself says it has not tried its real API. Inference `sk-` keys do not authorize the control plane. |
| #34 other wallets | **Not implemented by this module** | DeepSeek/Kimi/OpenRouter belong to existing adapters; SiliconFlow/AiHubMix and account-level relay login are not silently substituted. |

Remote factory defaults have **no approved origins**: default Remote collection refuses before transmitting a credential. Integrator must configure `remoteOrigins`, e.g. `['https://magpie.example']`. Relays are only created when configured, e.g. `relays: [{origin:'https://relay.example', protocol:'new-api-key'}]`. The shared HTTPS/default-port/no-redirect transport policy is retained; HTTP LAN endpoints, non-443 ports and embedded credentials are unsupported. Approving an internal HTTPS origin is a trusted application decision, not something a secret can authorize.

## Credential contract

API-key adapters accept either a raw key or the integrating agent's external envelope:

```json
{"type":"api","key":"existing key","accessToken":"existing key","subject":"stable external identity","alias":"Work","source":"provider-id","management":"external","locator":"credential locator"}
```

Only the selected token is sent, not the envelope/locator. Existing envelope `subject` and `alias` are preserved. Manual-key identities use the shared `hashKeySubject(adapterId,key)`. `expectedSubject` mismatch is fatal. Tokens/keys never appear in output samples or diagnostic errors. An external envelope must be supplied by the trusted integration, not accepted as proof of a different authenticated user.

Additional required formats (existing credentials only):

- Google: `{"accessToken":"OAuth access token","project":"already-provisioned-project"}` plus optional envelope identity. `access`/`token` also accepted. A raw OAuth token without a project is insufficient; missing project is an explicit credential error, not an onboarding attempt.
- Step Plan: `{"access":"access JWT","refresh":"refresh JWT","webId":"browser web_id"}` plus optional envelope identity, or the same session JSON encoded inside `accessToken`/`access`. Mainland and international adapters have independent hosts/app IDs (10300 / 20700). No login bookmarklet or renewal is executed.
- Remote: `{"origin":"https://approved-origin","apiKey":"enabled gateway key"}`; envelope `accessToken`/`key`/`token` are alternatives to `apiKey`. `origin` must exactly match trusted factory configuration. Remote raw-key-only collection is intentionally insufficient without an origin.

Future, **not yet accepted or used** credentials for the missing services:

- CodeArts current STS credentials: `{access_key_id, secret_access_key, security_token, expires_at}`. Automatic renewal additionally requires existing `refresh_token`, `code_verifier`, and `dpop_private_key_jwk`; access token alone is not a signed control-plane credential. Do not request/export the user's DPoP private key merely to work around missing implementation.
- Volcengine: `{AccessKeyID, SecretAccessKey, region, planKind}` with IAM permission to query Ark `GetCodingPlanUsage` / `GetAFPUsage` at `open.volcengineapi.com`, version 2024-01-01. The plan kind must distinguish Coding versus Agent.
- Tencent enterprise Token Plan: `{SecretId, SecretKey, region}` with TokenHub read permissions, `tokenhub.tencentcloudapi.com`, version 2026-03-22. Guangzhou/Singapore must not be mixed. Personal plan usage is not this enterprise API.

These missing credential formats describe prerequisites, **not working UI/import support**.

## Meaning, isolation and safety

- Ratios are percentage metrics, never token counts or cash. Google fractions must be in 0–1. Step Plan follows source fraction-or-percent encoding, rejects values outside 0–100, and zero reset without credit buckets means absent window, not exhausted quota.
- Monetary strings retain decimal precision. Ollama purchased balance is separate from included allowance; currencies and key/account scopes are explicit. No cross-service aggregation is performed.
- Step Plan epoch seconds/milliseconds are parsed independently of ISO-instant fields. Membership expiry is `entitlements.membershipExpiresAt`; auto-renew is an independent boolean. Neither is fabricated as renewal/payment date. Ollama `period.until` is billing-period end only, not membership expiry or a confirmed charge.
- Google metric IDs do not include mutable reset timestamps. Token type distinguishes otherwise identical model quota buckets. Dynamic pools are bound to account subject.
- Remote `asOf` takes precedence over `readAt`. It stays `cached` and uses the remote reading timestamp, not collection time. Windows without a reading time have no available numeric reading. Absolute resets only; `resetSecs` is not added to local now. String `balance` labels and remote plan dates are not parsed into invented numeric/currency/renewal data.
- Per-card failures preserve valid sibling cards; malformed whole replies fail `SCHEMA_CHANGED`. Transport errors reuse `executeOfficialGet`, including safe auth/403/429/backoff/network/timeout/cancellation classification. Fixed read RPC POSTs use that helper's allowlist, cancellation and response handling via a small transport bridge. Native POST transport disables redirects and bounds bodies to 1 MiB as well.
- Manifest `supportTier: official_auto` is the current shared schema's sole available value, **not a certification** for these undocumented/internal protocols. `permissions` and this evidence explicitly mark fixture-only, no live verification. Integrator must not present these as live-verified accounts before a successful probe.

## Reproducible checks

`npx tsx --test tests/control-adapters.test.ts`

Tests cover exact read URLs/methods/bodies/auth, excluded mutating requests, external envelope identity/raw-key identity, region-specific sessions/currencies, partial responses, absent versus zero quotas, percent versus USD versus credits, stable metric IDs, seconds/milliseconds/date semantics, remote cache age and account isolation, unapproved-origin refusal, exact relay conversion, safe transport status classification and cancellation. No live credentials are required.

## Fixed source / copyright mapping

Both local checkouts were read, and `git rev-parse HEAD` returned exactly the requested commits:

1. `C:/Users/niilo/AppData/Local/Temp/opencode/magpie-onboarding-review`, commit **ba319a7587923fc7a4ea3859658244d591261a59**. Copyright (c) 2026 yetone, MIT.
   - `internal/provider/google.go` lines 437–466, 1051–1077, 1193–1274: read RPC transport, Gemini quota buckets and Antigravity summary groups. Not OAuth/onboarding/model enumeration code.
   - `internal/provider/stepfun_plan.go` lines 350–385, 455–579: session query headers, quota fractions/epochs and subscription status. Login and refresh code was inspected to establish prerequisites, not ported/executed.
   - `internal/provider/ollama_usage.go`: current included/purchased and legacy percentage response shapes.
   - `internal/provider/balance.go` lines 44–84, 121–137, 492–505: StepFun root balance, fixed relay paths and unit mapping.
   - `internal/provider/remote_quotas.go` and `subscription_usage.go`: cache-only endpoint, data envelope, card/window wire fields, remote identity boundaries and cache timestamps. Remote refresh code was not ported.
   - `internal/provider/volcengine_usage.go` and `tencent_usage.go`: inspected to document control-plane signing/credential gaps; **no completion claim**.
2. `C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`, commit **aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6**. Copyright (c) 2026 magpie-community contributors, MIT.
   - `registry.json` CodeArts entry and `packages/codearts/index.mjs` PKCE/DPoP/STS, `credentialOf` and SDK-HMAC-SHA256 sections: reviewed for source mapping and required credential fields. **No CodeArts implementation copied as an apparently functional adapter.**

Protocol-specific TypeScript was adapted/reimplemented from these wire contracts. Both MIT notices are retained below for any substantial adapted portions; do not strip this attribution when redistributing the adapter.

### Magpie MIT notice

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

### Community MIT notice

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
