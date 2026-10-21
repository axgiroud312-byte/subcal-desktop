# 全服务能力目录来源与许可

仅移植目录元数据/研究结论，没有引入代理、推理、签到、刷新运行时。许可证应随源码及分发保留。

| 上游 | 固定提交 | 许可及本地映射 |
| --- | --- | --- |
| yetone/magpie | ba319a7587923fc7a4ea3859658244d591261a59 | [MIT / yetone](Magpie-LICENSE.txt)；internal/provider/{account,subscription_usage,planquota,balance,presets,migrate,partners,remote_magpie,google,stepfun_plan,volcengine_usage,tencent_usage,chatgpt_api,cline_usage,sub2api_usage}.go → src/shared/provider-catalog.ts 的 builtin/preset/generic/extensions |
| magpie-community/plugins | aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6 | [MIT / magpie-community contributors](Magpie-Community-Plugins-LICENSE.txt)；registry.json、packages/{kimi-work,zen-free,zcode,qoder,devin,zed,factory,grok,commandcode,mimo,cursor,kiro,minimax,workbuddy,cline,trae,opendesign,raccoon,autoclaw,codearts}/{index,provider}.mjs → COMMUNITY_PACKAGES/PLUGIN_CAPABILITIES |

每条目录项 source 指向该上游固定提交下文件/行范围，详细解释见 docs/evidence/full-service/catalog.md 及 docs/references 的两份库存。tests/provider-catalog.test.ts 可对用户指定的本地固定源码做无网络覆盖校验，不加载或执行第三方模块。

Qoder 的 LICENSE-CLIProxyAPI 涉及其代理代码；本次没有复制该运行时代码。后续若移植对应实现须一并保留其附属许可证，不能以此目录的来源说明替代。
