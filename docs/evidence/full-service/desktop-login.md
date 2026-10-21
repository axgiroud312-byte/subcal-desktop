# 桌面服务独立直接登录

源码基线：`magpie-community/plugins`，固定 HEAD `aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6`（git rev-parse HEAD 已核对）。
本地核对目录：`C:/Users/niilo/AppData/Local/Temp/opencode/subcal-catalog-plugins`。

实现：`src/main/login/desktop-login.ts`；测试：`tests/desktop-login.test.ts`。
仅使用 Node crypto/http 与注入的 fetch/now。不导入、执行上游插件，不调用模型、签到或收费接口，不读取原客户端登录。

## 源映射

| 服务 | 固定源码位置（packages 下 index.mjs） | 本实现 |
| --- | --- | --- |
| Kiro US/EU | kiro:31–51、305–353、1286–1425 | 官方 signin 页面；Google/GitHub PKCE；Builder ID/IAM 注册及二次 PKCE；按所选地区发现 profile，拒绝跨区 |
| Qoder / CN | qoder:174–200、256–318、1500–1525 | 官方设备页面、nonce + PKCE、有界设备 token 轮询；权益适配器只需 deviceToken，故不生成模型 jobToken |
| WorkBuddy / AI | workbuddy:62–84、119–162、302–320、983–1035 | state/authUrl → token → account；待确认返回 null；企业账号归属确认 |
| MiniMax Code CN / Global | minimax:15–21、31–52、186–286 | PKCE device_code 与 user_code 两种协议、秒/毫秒间隔、pending/slow_down/拒绝 |
| Trae CN / SG / US | trae:33–69、150–174、479–517、615–734 | 官方 authorization → loopback；保存登录设备上下文，支持旧 refresh-only 回调的一次交换；严格绑定地区 |
| CodeArts | codearts:112–132、372–383、443–457、507–537、604–721 | 官方 portal、PKCE SHA-256、P-256 ES256 DPoP、STS 临时 AK/SK/security_token |

## 安全与生命周期

- secret 与 state/verifier/token 仅存在 main 返回对象；调用方只能向 renderer 传 url/userCode/说明，不能把 LoginFlow 或 AccountCredential 整体 IPC。
- 凭据统一 `management: 'static'`，不实现后台刷新；到期重新点应用登录。
- poll 不含等待授权的无限循环；单个 HTTP 请求（包括读取响应体）15 秒上限，取消会中断；并发 poll 合并。
- 回调只绑定 127.0.0.1，检查 remoteAddress、Host、路径、method、state；Trae CORS 仅允许对应官方网站。
- 成功、取消、初始化失败、超时清理监听器与服务器。回调错误仅返回通用文本，不回显令牌、code 或供应商响应正文。

## 验证结果与明确边界

独立 fixture 测试覆盖八组场景：MiniMax 两种设备协议及拒绝/限速、Qoder 双区、WorkBuddy 分阶段确认、Trae/Kiro state 拒绝与成功、CodeArts DPoP 签名校验、取消与超时。全部网络授权请求为 fake fetch；回调测试使用真实本地 HTTP，不登录任何用户账号。

**未进行真实账号端到端验证，不能把 fixture 成功当成供应商线上成功。**

特别需要主代理如实呈现：

1. 上游 CodeArts 回调不保证回传 `ticket_id` 或 `state`（624–665）。本实现使用源码已有的私有 PKCE verifier 与 DPoP 向固定 STS 交换，授权码必须通过供应商验证才保存凭据；若回调显式带了 state/ticket，则拒绝不匹配值。不额外假设官方必须回传未约定字段，也不将合成验证称为线上打通。
2. 上游 Trae 不校验 state。本实现把随机 state 嵌入 `auth_callback_url` 查询参数，必须由官网保留完整 callback URL。官网是否保留已有 query 尚未真实验证。回调如丢弃 state 会被拒绝。
3. Trae 不执行上游用于签到设备绑定的额外 ExchangeToken（本功能只读取权益），也不接受回调提供任意 authHost 作为网络目标。旧 refresh-only 回调只使用固定官方 token 主机。
4. Kiro external_idp 在上游 1398–1399 明确未实现浏览器登录，本模块也不伪造其自动方式。Builder ID 固定 profile 来自源码 51、340；EU 不跨区使用 US profile。IAM 回调地区必须与所选服务一致。
5. Qoder 企业 VPC 未配置精确主机，不支持；设备 token 不消费 refresh。
6. 这六组服务的已实现主路径在固定源码中均是浏览器/device 授权，没有证据表明必须在本应用收集账号密码或粘贴 cookie。

## 许可

Copyright (c) 2026 magpie-community contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
