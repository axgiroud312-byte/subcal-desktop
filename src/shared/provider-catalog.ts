/** Static capability research, NOT an adapter availability registry.
 * Derived from yetone/magpie (Copyright (c) 2026 yetone) and
 * magpie-community/plugins (Copyright (c) 2026 magpie-community contributors).
 * MIT notices and fixed-source mapping: third_party/provider-catalog-SOURCES.md.
 * No credentials, network requests, model lists or inferred entitlements here.
 */
export const CATALOG_BASELINE = {
  magpie: 'ba319a7587923fc7a4ea3859658244d591261a59',
  plugins: 'aee6b9de5edf9e5e5b5d6bc6bf89a09c687340a6',
  reviewedAt: '2026-10-21',
  evidence: 'static-source-only',
  realAccountVerification: 'pending',
} as const

export type CatalogCapability = 'query' | 'control-plane' | 'console-only' | 'retired-endpoint' | 'model-only' | 'not-applicable' | 'remote-cache'
export type CatalogField = 'plan' | 'membership-end' | 'billing-period-end' | 'renewal' | 'windows' | 'reset' | 'balance' | 'key-budget' | 'credit-expiry' | 'trial-expiry' | 'historical-cost'
export interface ProviderCatalogEntry {
  /** Source-scoped key: plugin IDs may intentionally also be retired builtin IDs. */
  key: string
  providerId: string
  origin: 'builtin' | 'plugin' | 'preset' | 'generic' | 'extension' | 'gap'
  capability: CatalogCapability
  credentials: string
  fields: readonly CatalogField[]
  reason: string
  issue: number
  source: string
  /** Static review does not authorize rendering a balance or enabling an adapter. */
  implemented: false
}

function entry(origin: ProviderCatalogEntry['origin'], providerId: string, capability: CatalogCapability, credentials: string, fields: readonly CatalogField[], reason: string, issue: number, source: string): ProviderCatalogEntry {
  return { key: `${origin}:${providerId}`, origin, providerId, capability, credentials, fields, reason, issue, source, implemented: false }
}

export interface CommunityPackage {
  package: string
  directory: string
  kind: 'provider' | 'middleware' | 'agent' | 'tools' | 'page'
  providers: readonly string[]
}
const providerPackage = (directory: string, providers: readonly string[]): CommunityPackage => ({ package: `@magpie-community/opencode-${directory}-auth`, directory, kind: 'provider', providers })
const otherPackage = (kind: Exclude<CommunityPackage['kind'], 'provider'>, name: string, directory = name): CommunityPackage => ({ package: `@magpie-community/${kind}-${name}`, directory, kind, providers: [] })

/** registry.json, exactly 33 registered packages, 20 provider packages / 25 IDs. */
export const COMMUNITY_PACKAGES: readonly CommunityPackage[] = [
  providerPackage('kimi-work', ['kimi-work']),
  providerPackage('zen-free', ['opencode-zen-free']),
  providerPackage('zcode', ['zcode']),
  providerPackage('qoder', ['qoder', 'qoder-cn']),
  providerPackage('devin', ['devin']),
  providerPackage('zed', ['zed']),
  providerPackage('factory', ['factory']),
  providerPackage('grok', ['grok']),
  providerPackage('commandcode', ['commandcode-plan']),
  providerPackage('mimo', ['mimo-app']),
  providerPackage('cursor', ['cursor']),
  providerPackage('kiro', ['kiro']),
  providerPackage('minimax', ['minimax-code', 'minimax-code-global']),
  providerPackage('workbuddy', ['workbuddy', 'workbuddy-ai']),
  providerPackage('cline', ['cline']),
  providerPackage('trae', ['trae-cn', 'trae-global']),
  providerPackage('opendesign', ['opendesign']),
  providerPackage('raccoon', ['raccoon']),
  providerPackage('autoclaw', ['autoclaw', 'autoclaw-cn']),
  providerPackage('codearts', ['codearts']),
  otherPackage('middleware', 'param-override'),
  otherPackage('middleware', 'model-map'),
  otherPackage('middleware', 'system-prompt'),
  otherPackage('middleware', 'word-guard'),
  otherPackage('middleware', 'think-tags'),
  otherPackage('middleware', 'antigravity-cloak'),
  otherPackage('middleware', 'codex-history'),
  otherPackage('agent', 'aider'),
  otherPackage('agent', 'type4me'),
  otherPackage('middleware', 'reserve'),
  otherPackage('tools', 'calc'),
  otherPackage('page', 'usage'),
  otherPackage('agent', 'kimi-desktop'),
]
export const UNREGISTERED_PACKAGES = [{ directory: 'packages/block-patterns', registered: false, capability: 'not-applicable', issue: 7 }] as const
export const NON_PROVIDER_CAPABILITIES: readonly ProviderCatalogEntry[] = COMMUNITY_PACKAGES.filter(p => p.kind !== 'provider').map(p => entry(
  'extension', p.package, 'not-applicable', '无供应商账号；不参与账号接入', [],
  p.kind === 'page' ? '读取Magpie自身请求统计，不是远端供应商权益' : `${p.kind} 插件，不是供应商权益接口`, 7, `packages/${p.directory}/package.json`,
))

type PluginDescription = readonly [string, CatalogCapability, string, readonly CatalogField[], string, number, string]
const pluginDescriptions: readonly PluginDescription[] = [
  ['kimi-work', 'query', '只读 Kimi desktop config，Work gateway key + web accessToken/userId', ['windows'], '仅会员共享已用比例；无套餐档位、总量、日期或重置；不能归到 Kimi Code', 16, 'index.mjs#L128-L135'],
  ['zen-free', 'model-only', '公共 public 字符串，非账号秘密', [], 'usage() 只有静态名称和空窗口；无账号查询，不代表无限额度', 35, 'provider.mjs#L362-L364'],
  ['zcode', 'control-plane', '个人 Coding key；团队 org/project + account token；gift 独立 ZCode JWT/device', ['plan', 'membership-end', 'renewal', 'windows', 'reset', 'balance', 'credit-expiry'], '个人/团队/gift 分开；gift expires_at 是积分失效；预览不领取；部分失败保持未知', 19, 'index.mjs#L350-L759'],
  ['qoder', 'query', '设备 OAuth；PAT 需交换 job/access token；CN/Global/VPC 身份隔离', ['plan', 'membership-end', 'windows'], '四种资源池分列；enterprise 无窗口不等于不限额；不运行 campaigns claim/runtime-info', 20, 'index.mjs#L1279-L1506'],
  ['devin', 'query', '浏览器登录或只读 Devin CLI credentials.toml windsurf_api_key', ['plan', 'membership-end', 'windows', 'reset', 'balance'], 'GetUserStatus JSON metadata.apiKey；plan 可来自保存的登录；Windsurf 字段名不是独立 Windsurf 接口证据', 14, 'index.mjs#L1739-L1830'],
  ['zed', 'query', '浏览器 userId + accessToken，保留 org', ['plan', 'billing-period-end'], 'GET /client/users/me；只有套餐和 subscription_period.ended_at，无用量窗口；账期结束不冒充续费/最终失效', 26, 'index.mjs#L1059-L1108'],
  ['factory', 'query', 'WorkOS OAuth 或 fk key；组织、EU/premBaseHost 隔离', ['windows', 'reset', 'balance'], 'standard/core 各五小时/周/月，不相加；无套餐日期；可刷新自有凭据', 17, 'index.mjs#L927-L1015'],
  ['grok', 'query', 'Grok Build OAuth/CLI auth.json，不是 xAI 模型 key', ['windows', 'reset'], 'billing credits 比例；currentPeriod.end 是额度周期；CLI 刷新会写来源，不直接移植', 12, 'index.mjs#L710-L792'],
  ['commandcode', 'query', '浏览器 key、只读 ~/.commandcode/auth.json 或 Studio key', ['plan', 'billing-period-end', 'renewal', 'windows', 'reset', 'balance'], 'currentPeriodEnd 不冒充最终会员失效；档位月常量是估算；缓存时间不是新观察', 24, 'index.mjs#L476-L599'],
  ['mimo', 'control-plane', '小米账号 app cookies；platform 独立 session，不是 tp 模型 key', ['plan', 'billing-period-end', 'membership-end', 'renewal', 'windows', 'reset'], 'app endTime 与平台 currentPeriodEnd 分开；app UTC+8、平台 UTC；usage.percent 为剩余', 25, 'index.mjs#L534-L626'],
  ['cursor', 'query', '浏览器/只读 CLI JWT；API key 必须交换 access token', ['plan', 'windows', 'reset', 'key-budget'], 'billingCycleEnd 只作窗口；on-demand USD限额不等于现金；Grok Bot 独立池见扩展', 11, 'index.mjs#L400-L566'],
  ['kiro', 'query', '自有 OAuth/Builder/IAM 或 ksk key；外部 CLI/IDE 只读来源需另拆刷新', ['plan', 'windows', 'reset', 'trial-expiry'], 'region/profileArn 隔离；trial expiry 是失效；上游外部刷新/saveBack 会写来源', 18, 'index.mjs#L305-L445'],
  ['minimax', 'control-plane', 'MiniMax Code 设备 OAuth + 客户端签名；个人 workspace/opGroupId', ['plan', 'membership-end', 'windows', 'reset', 'balance'], 'Code credits 与 M Plan/API key方案分开；CN/Global分开；不执行签到', 22, 'index.mjs#L379-L495'],
  ['workbuddy', 'query', '浏览器或 desktop token/uid/domain/企业上下文', ['plan', 'windows', 'reset', 'credit-expiry'], 'CN/Global分开；DeductionEndTime 是积分批次失效；无会员到期/renew输出；明细有截断风险', 21, 'index.mjs#L1232-L1351'],
  ['cline', 'query', 'WorkOS OAuth 或 Cline API key；单次 refresh token 串行保护', ['plan', 'windows', 'reset', 'balance'], '404无ClinePass不等于401/403；余额微美元；局部成功保留；expiresAt不得默认补给', 23, 'index.mjs#L695-L773'],
  ['trae', 'query', 'Trae 浏览器 OAuth + ideHeaders、uid/region/企业设备上下文', ['plan', 'windows'], 'CN credits/Global USD；pack end 可能失效，不承诺reset或会员到期；多包/国际区域仍待核验', 27, 'index.mjs#L116-L238'],
  ['opendesign', 'control-plane', '设备登录 control key；runtime key 不足；workspace 隔离', ['plan', 'billing-period-end', 'renewal', 'windows', 'reset', 'balance'], 'summary/preflight分读；subscriptionCurrentPeriodEnd是账期；eligible=false不等于钱包无余额', 28, 'index.mjs#L379-L420'],
  ['raccoon', 'query', '浏览器 OAuth 或只读 ~/.box-agent/config/auth.json；不消费 desktop refresh', ['plan', 'membership-end', 'balance', 'credit-expiry'], '账单推算授予/失效量可能不完整（最多5000）；不能标精确总量；无自动reset；不领取', 29, 'index.mjs#L483-L573'],
  ['autoclaw', 'query', '国际 Google/z.ai 或 CN 手机登录，bizHeaders/X-Authorization', ['balance'], '仅wallet credits；signinOnUsage/refresh可触发领取，迁移必须排除maybeSignin；无plan/until/reset', 30, 'index.mjs#L692-L745'],
  ['codearts', 'control-plane', '华为 OAuth → STS AK/SK/security-token，SDK-HMAC-SHA256', ['plan', 'windows', 'reset', 'credit-expiry'], 'package credits与免费tokens分开；批次/ledger推算标来源；本地零点reset是计算；无会员到期/renew', 31, 'index.mjs#L1801-L1934'],
]
export const PLUGIN_CAPABILITIES: readonly ProviderCatalogEntry[] = pluginDescriptions.flatMap(([directory, capability, credentials, fields, reason, issue, file]) =>
  COMMUNITY_PACKAGES.find(p => p.directory === directory)!.providers.map(id => entry('plugin', id, capability, credentials, fields, reason, issue, `packages/${directory}/${file}`)),
)

/** migrate.go:284-298. Mapping only; never execute retired legacy implementations. */
export const RETIRED_BUILTINS = {
  cursor: 'cursor', devin: 'devin', kiro: 'kiro', factory: 'factory', grok: 'grok',
  'commandcode-plan': 'commandcode-plan', zcode: 'zcode', qoder: 'qoder', 'qoder-cn': 'qoder-cn',
  workbuddy: 'workbuddy', 'workbuddy-ai': 'workbuddy-ai', 'mimo-app': 'mimo-app', zed: 'zed',
} as const
export const PRESET_ALIASES = {
  'qianfan-token-plan': { preset: 'baidu-qianfan', region: '' },
  'tencent-token-plan': { preset: 'tencent-cloud', region: 'plan' },
  'tencent-tokenhub-cn': { preset: 'tencent-cloud', region: 'cn' },
  'tencent-tokenhub': { preset: 'tencent-cloud', region: 'intl' },
} as const

/** All top-level PresetDef IDs, not nested Region IDs (presets.go:115-606). */
export const PRESET_IDS = [
  'anthropic', 'openai', 'google', 'vertex', 'deepseek', 'xai', 'moonshot', 'moonshot-cn',
  'kimi-code', 'kimi-code-cn', 'zhipu', 'zai', 'minimax', 'minimax-cn', 'stepfun', 'stepfun-cn',
  'xiaomi', 'baidu-qianfan', 'tencent-cloud', 'huaweicloud', 'volcengine', 'qwen', 'qwen-cn',
  'qwen-token-plan', 'bailian-token-plan', 'mistral', 'groq', 'bedrock', 'bedrock-mantle',
  'azure', 'ollama-cloud', 'nous', 'openrouter', 'opencode-go', 'clinepass', 'opencode-zen',
  'kilo', 'commandcode', 'together', 'fireworks', 'siliconflow', 'nvidia', 'modelscope',
  'aihubmix', 'pipellm', '302ai', 'cherryin', 'yylx', 'typesafe', 'vercel-jev', 'cloudflare-jev',
  'bailian-decision', 'qwen-decision', 'ollama', 'lmstudio', 'omlx', 'mlx-serve', 'remote-magpie',
] as const

const b = (id: string, cap: CatalogCapability, auth: string, fields: readonly CatalogField[], note: string, issue: number, file: string) => entry('builtin', id, cap, auth, fields, note, issue, `internal/provider/${file}`)
export const BUILTIN_CAPABILITIES: readonly ProviderCatalogEntry[] = [
  b('claude', 'query', 'Claude独立配置/钥匙串；SubCal应优先OAuth HTTP', ['windows', 'reset'], '上游CLI /usage，不调用普通模型作后备；会员日期未知', 9, 'subscription_usage.go#L619-L866'),
  b('codex', 'query', 'CODEX_HOME/auth.json/OAuth；workspace', ['plan', 'membership-end', 'windows', 'reset', 'balance'], 'wham/usage；仅有效subscription_active_until为会员日期，token exp不是', 8, 'subscription_usage.go#L889-L985'),
  b('copilot', 'query', '编辑器/CLI/OAuth设备码；GHE host+login隔离', ['plan', 'windows', 'reset'], 'copilot_internal/user；小数、unlimited、overage，不假设次数；无会员日期', 10, 'subscription_usage.go#L1072-L1195'),
  b('chatgpt-api', 'console-only', '独立public OAuth clientId/hostId，非Codex凭据', [], '只有token plan，无原生权益请求；导向settings/usage', 35, 'chatgpt_api.go#L3-L108'),
  b('gemini', 'query', '.gemini OAuth + Google project/client', ['plan', 'windows', 'reset'], 'loadCodeAssist/retrieveUserQuota；需分离onboardUser开通副作用', 15, 'google.go#L919-L1080'),
  b('antigravity', 'query', '独立Google OAuth client/project', ['plan', 'windows', 'reset'], '模型池与五小时/周共享池不重复计数', 15, 'google.go#L1158-L1274'),
  ...['opencode-go', 'kimi-code', 'kimi-code-cn', 'zhipu', 'zai', 'minimax', 'minimax-cn', 'commandcode', 'ollama-cloud'].map(id => {
    const issue = id === 'opencode-go' ? 13 : id.startsWith('kimi') ? 16 : ['zhipu', 'zai'].includes(id) ? 19 : id.startsWith('minimax') ? 22 : id === 'commandcode' ? 24 : 34
    const fields: CatalogField[] = id === 'ollama-cloud' || id === 'commandcode' ? ['windows', 'reset', 'balance'] : ['windows', 'reset']
    if (['zhipu', 'zai'].includes(id)) fields.push('plan', 'membership-end', 'renewal')
    return b(id, 'query', '服务对应套餐Key；地区/工作区分别保留', fields, 'planquotaSourceOf按host/套餐路径分派；API key可用不保证有套餐；窗口end不当会员到期', issue, 'planquota.go#L37-L71')
  }),
  b('clinepass', 'query', 'Cline key', ['plan', 'windows', 'reset', 'balance'], '404无计划与拒绝/失败区别；微美元余额；允许局部成功', 23, 'cline_usage.go#L24-L186'),
  ...['stepfun', 'stepfun-cn'].map(id => b(id, 'control-plane', '平台session/Oasis-Token，不是模型key', ['plan', 'membership-end', 'renewal', 'windows', 'reset'], 'Step Plan控制面与API钱包未证实同身份不合并', 32, 'stepfun_plan.go#L388-L586')),
  b('volcengine', 'control-plane', 'AK/SK HMAC + region', ['plan', 'windows', 'reset'], 'GetCodingPlanUsage/GetAFPUsage；缓存必须含region；不猜单位', 33, 'volcengine_usage.go#L90-L374'),
  b('tencent-cloud', 'control-plane', 'SecretId/Key TC3 + region/TeamId；企业方案', ['windows', 'reset', 'membership-end'], 'DescribeTokenPlanList/Plan；PackageInfo.ExpireTime原实现未输出，需另提取；个人套餐仍为缺口；补分页', 33, 'tencent_usage.go#L91-L322'),
  ...['deepseek', 'moonshot', 'moonshot-cn', 'openrouter', 'siliconflow', 'stepfun-wallet', 'stepfun-cn-wallet', 'aihubmix'].map(id => b(id, id === 'siliconflow' ? 'retired-endpoint' : 'query', id === 'aihubmix' ? '模型Key预算或独立账号access token' : '厂商API key；按地区/币种分开', id === 'aihubmix' ? ['balance', 'key-budget'] : ['balance'], id === 'siliconflow' ? 'CN/Global /v1/user/info有410/20092退休判断；无已证实替代' : '余额不等于套餐/到期；OpenRouter账户credits不等于Key预算；赠送/现金分列', 34, 'balance.go#L44-L185')),
  b('opencode-zen', 'console-only', 'Zen key或公共免费模型', [], '不请求Go /usage冒充Zen；无key余额查询', 35, 'balance.go#L1316-L1343'),
]

/** Region IDs matter for identity, not extra providers or summable wallets. */
export const PRESET_REGIONS = {
  zhipu: ['api', 'coding'], zai: ['api', 'coding'], stepfun: ['plan', 'api'], 'stepfun-cn': ['plan', 'api'],
  xiaomi: ['plan-cn', 'plan-sgp', 'plan-ams', 'api'], 'baidu-qianfan': ['personal', 'team', 'api'],
  'tencent-cloud': ['plan', 'cn', 'intl', 'enterprise', 'enterprise-intl'], huaweicloud: ['plan', 'api'],
  volcengine: ['coding', 'agent', 'api'], siliconflow: ['cn', 'intl'], yylx: ['auto', 'global', 'cn'],
  'bailian-decision': ['cn-beijing', 'ap-southeast-1', 'token-plan'],
  bedrock: ['us-east-1', 'us-east-2', 'us-west-2', 'eu-central-1', 'eu-west-1', 'eu-west-3', 'ap-northeast-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-south-1'],
  'bedrock-mantle': ['us-east-1', 'us-east-2', 'us-west-2', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-west-1', 'eu-west-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'sa-east-1'],
} as const

const generic = (id: string, auth: string, fields: readonly CatalogField[], note: string, file = 'balance.go#L89-L145') => entry('generic', id, 'control-plane', auth, fields, note, 34, `internal/provider/${file}`)
export const GENERIC_CAPABILITIES = [
  generic('new-api-key', '站点API Key', ['key-budget'], '/api/usage/token total_available/500000 USD；不是账户钱包'),
  generic('one-api-key', '站点API Key', ['key-budget'], '/api/usage/token total_available/500000 USD；不是账户钱包'),
  generic('new-api-account', 'account access token + New-Api-User', ['balance'], '/api/user/self quota/500000 USD；不让用户配置表达式'),
  generic('sub2api-account', '站点JWT；此路径不提供自动登录刷新', ['balance'], '/api/v1/user/profile data.balance USD'),
  generic('sub2api-key', '站点API Key', ['key-budget', 'windows', 'reset'], '/v1/usage remaining/rate_limits；按源区分钱包/Key预算', 'sub2api_usage.go#L3-L60'),
  generic('legacy-openai-relay', '兼容Relay Key', ['balance'], '/dashboard/billing/credit_grants；不能归为官方OpenAI余额'),
  entry('generic', 'balance-url', 'model-only', '用户自定义BalanceURL/Path（仅参考能力）', [], '任意表达式不等于厂商原生能力；下批需内置模板，不要求用户配置', 35, 'internal/provider/balance.go#L44-L54'),
] as const

/** Each gap has an explicit conservative conclusion and a source, not a guessed API. */
export const GAP_PRESET_IDS = [
  'anthropic', 'openai', 'google', 'vertex', 'xai', 'xiaomi', 'baidu-qianfan', 'huaweicloud',
  'qwen', 'qwen-cn', 'qwen-token-plan', 'bailian-token-plan', 'mistral', 'groq', 'bedrock',
  'bedrock-mantle', 'azure', 'nous', 'kilo', 'together', 'fireworks', 'nvidia', 'modelscope',
  'pipellm', '302ai', 'cherryin', 'yylx', 'typesafe', 'vercel-jev', 'cloudflare-jev',
  'bailian-decision', 'qwen-decision', 'ollama', 'lmstudio', 'omlx', 'mlx-serve',
] as const
const localIds: readonly string[] = ['ollama', 'lmstudio', 'omlx', 'mlx-serve']
const routingIds: readonly string[] = ['typesafe', 'vercel-jev', 'cloudflare-jev', 'bailian-decision', 'qwen-decision']
export const GAP_CAPABILITIES: readonly ProviderCatalogEntry[] = GAP_PRESET_IDS.map(id => entry(
  'gap', id,
  localIds.includes(id) || routingIds.includes(id) ? 'not-applicable' : ['qwen-token-plan', 'bailian-token-plan'].includes(id) ? 'console-only' : 'model-only',
  localIds.includes(id) ? '本地服务，无供应商订阅身份' : '模型调用凭据不足以证明有控制面权限',
  [],
  localIds.includes(id) ? '本地推理计数不是供应商权益' : routingIds.includes(id) ? '此入口是决策路由；底层云账户成本需独立控制面调查' : id === 'xiaomi' ? 'MiMo插件有platform session路径(#25)，不能用tp/API key冒充；按账号授权另接' : ['anthropic', 'openai', 'xai'].includes(id) ? '公开管理API找到后续只读路径，见catalog.md；尚未实现，历史成本不是余额或会员有效期' : '固定源码仅注册模型入口，无原生权益查询证据；需控制台/官方只读协议进一步验证，不宣称厂商永远不支持',
  35, 'internal/provider/presets.go#L114-L605',
))

export const EXTENSION_CAPABILITIES: readonly ProviderCatalogEntry[] = [
  entry('extension', 'grok-bot', 'query', '复用Cursor JWT sub构造会话cookie；不新增grok provider', ['windows', 'reset', 'trial-expiry'], 'get-sand-usage-status；仅比例；trialExpiresAt源字段可提取，但原输出未包含；不调用Bot', 11, 'packages/cursor/index.mjs#L531-L566'),
  entry('extension', 'remote-magpie', 'remote-cache', '远端Magpie地址和共享授权Key；远端账号独立命名空间', ['plan', 'windows', 'reset', 'balance'], 'GET /v1/magpie/quotas/cards读远端缓存；字段按远端实际返回，非本机发现或厂商新观察', 36, 'internal/provider/remote_quotas.go'),
  entry('extension', 'partners', 'not-applicable', '公开动态预设/广告清单，无账号', [], 'From/Until限制广告展示期，不是会员日期；动态项不能静态声称原生权益支持', 7, 'internal/provider/partners.go#L53-L60'),
  entry('gap', 'windsurf', 'console-only', '待核验独立Windsurf身份；不凭windsurf_api_key名字合并Devin', [], '官方旧Windsurf usage文档已跳转Devin；存在产品迁移线索但无独立权益协议确认，建议与#14作身份迁移研究', 35, 'docs/evidence/full-service/catalog.md#windsurf'),
  entry('gap', 'tencent-personal-plan', 'console-only', '个人Token Plan模型Key≠企业SecretId/TeamId', [], '企业DescribeTokenPlan不自动覆盖个人；需个人控制面只读证据', 35, 'internal/provider/tencent_usage.go'),
]

/** Presets point at the reviewed capability or the explicit gap without inventing fields. */
export const PRESET_CAPABILITIES: readonly ProviderCatalogEntry[] = PRESET_IDS.map(id => {
  const existing = BUILTIN_CAPABILITIES.find(p => p.providerId === id) ?? GAP_CAPABILITIES.find(p => p.providerId === id) ?? EXTENSION_CAPABILITIES.find(p => p.providerId === id)
  if (!existing) throw new Error(`Missing static capability for preset ${id}`)
  return { ...existing, key: `preset:${id}`, origin: 'preset' as const }
})
export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  ...BUILTIN_CAPABILITIES, ...PLUGIN_CAPABILITIES, ...PRESET_CAPABILITIES,
  ...GENERIC_CAPABILITIES, ...GAP_CAPABILITIES, ...EXTENSION_CAPABILITIES, ...NON_PROVIDER_CAPABILITIES,
]

/** Public documentation findings kept separate from fixed-source capabilities.
 * No endpoint here is implemented or called by this module. Docs read 2026-10-21.
 */
export const GAP_RESEARCH_PATHS = [
  { id: 'xai', status: 'documented-read-path', credentials: 'Management API key + teamId；不是inference key', method: 'GET', endpoint: 'https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance', fields: ['total.val', 'changes'], source: 'https://docs.x.ai/docs/management-api/billing', caution: 'USD cents；示例PURCHASE=-1000，余额符号需账户夹具核验；禁止top-up/rotate/create-key', suggestedTask: 'GAP-XAI-READONLY', issue: 35 },
  { id: 'openai', status: 'documented-read-path', credentials: 'Organization Admin API key；非ChatGPT OAuth/普通project key', method: 'GET', endpoint: 'https://api.openai.com/v1/organization/costs', fields: ['data[].results[].amount.value', 'data[].results[].amount.currency', 'next_page'], source: 'https://github.com/openai/openai-openapi/blob/master/openapi.yaml', caution: '历史成本不是可用余额；不推出会员到期', suggestedTask: 'GAP-OPENAI-COST', issue: 35 },
  { id: 'anthropic', status: 'documented-read-path', credentials: '组织Admin凭据；个人账号不可用；workspace key不适用', method: 'GET', endpoint: 'https://api.anthropic.com/v1/organizations/cost_report', fields: ['data', 'has_more', 'next_page'], source: 'https://platform.claude.com/docs/en/manage-claude/usage-cost-api', caution: '历史成本USD cents，不是钱包/Claude订阅；Priority成本不包含', suggestedTask: 'GAP-ANTHROPIC-COST', issue: 35 },
  { id: 'azure', status: 'documented-read-path', credentials: 'Entra OAuth + Cost Management scope/RBAC；非模型resource key', method: 'POST', endpoint: 'https://management.azure.com/{scope}/providers/Microsoft.CostManagement/query?api-version=2025-03-01', fields: ['properties.columns', 'properties.rows', 'properties.nextLink'], source: 'https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage?view=rest-cost-management-2025-03-01', caution: '查询语义POST；历史成本不是余额；按tenant/subscription/scope隔离', suggestedTask: 'GAP-CLOUD-COST', issue: 35 },
  { id: 'bedrock', status: 'documented-read-path', credentials: 'AWS SigV4/IAM cost权限；非Bedrock bearer key', method: 'POST', endpoint: 'https://ce.us-east-1.amazonaws.com/', fields: ['ResultsByTime', 'NextPageToken'], source: 'https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html', caution: 'GetCostAndUsage历史成本，可能计费；不可自动开通Cost Explorer；Mantle不重复计同一AWS账单', suggestedTask: 'GAP-CLOUD-COST', issue: 35 },
] as const

/** Returns research metadata only. Never treat this as permission to schedule a query. */
export function catalogEntry(key: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find(p => p.key === key)
}
