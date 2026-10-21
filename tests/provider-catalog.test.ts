import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  BUILTIN_CAPABILITIES, CATALOG_BASELINE, COMMUNITY_PACKAGES, GAP_CAPABILITIES,
  GAP_PRESET_IDS, GAP_RESEARCH_PATHS, NON_PROVIDER_CAPABILITIES, PLUGIN_CAPABILITIES,
  PRESET_ALIASES, PRESET_CAPABILITIES, PRESET_IDS, PROVIDER_CATALOG,
  RETIRED_BUILTINS, UNREGISTERED_PACKAGES, catalogEntry,
} from '../src/shared/provider-catalog'

const sorted = (xs: readonly string[]) => [...xs].sort()
test('33 registered packages = 20 providers / 25 IDs + 13 excluded packages', () => {
  assert.equal(COMMUNITY_PACKAGES.length, 33)
  assert.equal(COMMUNITY_PACKAGES.filter(p => p.kind === 'provider').length, 20)
  assert.equal(NON_PROVIDER_CAPABILITIES.length, 13)
  const ids = COMMUNITY_PACKAGES.flatMap(p => p.providers)
  assert.equal(ids.length, 25)
  assert.equal(new Set(ids).size, 25)
  assert.deepEqual(sorted(ids), sorted(PLUGIN_CAPABILITIES.map(p => p.providerId)))
  assert.equal(UNREGISTERED_PACKAGES[0].registered, false)
  assert(!COMMUNITY_PACKAGES.some(p => p.directory === 'block-patterns'))
})

test('every entry is static, unique, sourced and has an explicit task/credential boundary', () => {
  assert.equal(new Set(PROVIDER_CATALOG.map(p => p.key)).size, PROVIDER_CATALOG.length)
  for (const p of PROVIDER_CATALOG) {
    assert.equal(p.implemented, false)
    assert(p.source && p.reason && p.credentials, p.key)
    assert(p.issue >= 7 && p.issue <= 36, p.key)
    if (['model-only', 'not-applicable', 'console-only', 'retired-endpoint'].includes(p.capability)) {
      if (p.capability !== 'retired-endpoint') assert.deepEqual(p.fields, [], p.key)
    }
  }
  assert.equal(CATALOG_BASELINE.realAccountVerification, 'pending')
  assert.deepEqual(sorted(PRESET_CAPABILITIES.map(p => p.providerId)), sorted(PRESET_IDS))
  assert.equal(PRESET_IDS.length, 58)
  assert.deepEqual(sorted(GAP_CAPABILITIES.map(p => p.providerId)), sorted(GAP_PRESET_IDS))
})

test('retired IDs map to current plugins; aliases keep region without adding a service', () => {
  assert.equal(Object.keys(RETIRED_BUILTINS).length, 13)
  for (const id of Object.values(RETIRED_BUILTINS)) {
    assert(PLUGIN_CAPABILITIES.some(p => p.providerId === id), id)
    assert(!BUILTIN_CAPABILITIES.some(p => p.providerId === id), id)
  }
  assert.equal(Object.keys(PRESET_ALIASES).length, 4)
  for (const alias of Object.values(PRESET_ALIASES)) assert(PRESET_IDS.includes(alias.preset))
  assert.equal(PRESET_ALIASES['tencent-tokenhub'].region, 'intl')
})

test('no fake Zen balances, advertisement dates, local subscription or middleware entitlements', () => {
  assert.deepEqual(catalogEntry('plugin:opencode-zen-free')?.fields, [])
  assert.equal(catalogEntry('builtin:opencode-zen')?.capability, 'console-only')
  assert.deepEqual(catalogEntry('extension:partners')?.fields, [])
  assert.equal(catalogEntry('extension:remote-magpie')?.capability, 'remote-cache')
  for (const id of ['ollama', 'lmstudio', 'omlx', 'mlx-serve']) assert.equal(catalogEntry(`preset:${id}`)?.capability, 'not-applicable')
  for (const p of NON_PROVIDER_CAPABILITIES) assert.deepEqual(p.fields, [])
  assert(!catalogEntry('plugin:zed')?.fields.includes('windows'))
  assert(!catalogEntry('plugin:cursor')?.fields.includes('membership-end'))
  assert(!catalogEntry('plugin:commandcode-plan')?.fields.includes('membership-end'))
  assert(GAP_RESEARCH_PATHS.every(p => p.issue === 35 && p.suggestedTask && p.source.startsWith('https://')))
})

/** Opt-in offline source comparison. Never import/execute upstream provider code.
 * Set both paths to clones checked out at CATALOG_BASELINE, then run this test.
 */
const magpie = process.env.SUBCAL_MAGPIE_SOURCE
const plugins = process.env.SUBCAL_PLUGINS_SOURCE
test('fixed upstream registry, presets, retired IDs, aliases and source paths match exactly', { skip: !magpie || !plugins }, () => {
  const head = (dir: string) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(head(magpie!), CATALOG_BASELINE.magpie)
  assert.equal(head(plugins!), CATALOG_BASELINE.plugins)
  const registry = JSON.parse(readFileSync(join(plugins!, 'registry.json'), 'utf8')) as { plugins: { package: string; providers?: string[]; kind?: string }[] }
  assert.deepEqual(sorted(registry.plugins.map(p => p.package)), sorted(COMMUNITY_PACKAGES.map(p => p.package)))
  for (const upstream of registry.plugins) {
    const ours = COMMUNITY_PACKAGES.find(p => p.package === upstream.package)!
    assert.equal(ours.kind, upstream.kind ?? 'provider')
    assert.deepEqual(sorted(ours.providers), sorted(upstream.providers ?? []))
  }
  const presets = readFileSync(join(magpie!, 'internal/provider/presets.go'), 'utf8')
  const constants: Record<string, string> = { VertexPreset: 'vertex', AzurePreset: 'azure', OMLXPreset: 'omlx', MLXServePreset: 'mlx-serve', RemoteMagpiePreset: 'remote-magpie' }
  const sourceIds = [...presets.matchAll(/^\t\{ID: ("[^"]+"|\w+),/gm)].map(m => m[1].startsWith('"') ? JSON.parse(m[1]) as string : constants[m[1]])
  assert.deepEqual(sorted(sourceIds), sorted(PRESET_IDS))
  const migrate = readFileSync(join(magpie!, 'internal/provider/migrate.go'), 'utf8')
  const retiredBlock = migrate.split('var retiredBuiltins = map[string]bool{')[1].split('\n}')[0]
  const retiredConstants: Record<string, string> = { QoderCNID: 'qoder-cn', WorkBuddyAIID: 'workbuddy-ai', MiMoID: 'mimo-app', CommandCodePlanID: 'commandcode-plan' }
  const retired = [...retiredBlock.matchAll(/^\s*("[^"]+"|\w+):\s+true/gm)].map(m => m[1].startsWith('"') ? JSON.parse(m[1]) as string : retiredConstants[m[1]])
  assert.deepEqual(sorted(retired), sorted(Object.keys(RETIRED_BUILTINS)))
  const aliasBlock = presets.split('var presetAliases = map[string]struct{ preset, region string }{')[1].split('\n}')[0]
  const aliases = Object.fromEntries([...aliasBlock.matchAll(/"([^"]+)":\s+\{"([^"]+)", "([^"]*)"\}/g)].map(m => [m[1], { preset: m[2], region: m[3] }]))
  assert.deepEqual(aliases, PRESET_ALIASES)
  for (const p of PROVIDER_CATALOG) {
    if (!p.source.startsWith('internal/') && !p.source.startsWith('packages/')) continue
    const root = p.source.startsWith('packages/') ? plugins! : magpie!
    assert(readFileSync(join(root, p.source.split('#')[0]), 'utf8').length > 0, p.key)
  }
})
