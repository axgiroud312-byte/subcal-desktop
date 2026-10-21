# 账号接入移植来源

本目录许可证必须随应用源码及分发产物保留。移植为 TypeScript，没有引入两个上游项目的完整运行时或代理服务器，也没有新增第三方运行时依赖。

| 原项目 | 固定提交 | 许可证 |
| --- | --- | --- |
| https://github.com/yetone/magpie | `ba319a7587923fc7a4ea3859658244d591261a59` | [MIT / yetone](Magpie-LICENSE.txt) |
| https://github.com/farion1231/cc-switch | `c776fd0ebfe35d769b5909b86bdfa1ccdf089988` | [MIT / Jason Young](CC-Switch-LICENSE.txt) |

具体原文件与本地实现映射见 [源码核对记录](../docs/references/account-access-source-review.md)。原始版本用于复现移植依据，不代表供应商内部接口永远稳定。
# 全服务权益移植

新增社区源码的完整 MIT 见 `Magpie-Community-Plugins-LICENSE.txt`；Qoder 附带的 CLIProxyAPI 权利人声明见 `Qoder-CLIProxyAPI-LICENSE.txt`，保留原文（包括上游版权年份拼写）。固定提交与逐文件映射见 `provider-catalog-SOURCES.md`、`docs/references/priority-adapters-sources.md` 和 `docs/evidence/full-service/{extended,regional,control,signed,desktop_services,wallets,zcode}.md`（按实际交付文件为准）。没有引入或执行上游插件运行时。
