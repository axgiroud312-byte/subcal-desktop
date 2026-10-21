import fs from 'node:fs/promises';
import { CodexLocalAdapter, defaultCodexTransport } from '../src/main/adapters/codex-adapter';
import { CopilotLocalAdapter } from '../src/main/adapters/copilot-adapter';
import { AdapterError } from '../src/main/adapters/types';
import assert from 'node:assert/strict';

async function main() {
const evidence: Record<string, unknown> = { at: new Date().toISOString(), containsCredentials: false, userAcceptance: 'pending' };
try {
  const raw = await defaultCodexTransport({ timeoutMs: 30000 });
  const normalized = new CodexLocalAdapter().normalize(raw, new Date().toISOString());
  const response = raw.rateLimitsRead as { rateLimitsByLimitId?: Record<string, Record<string, unknown>>; rateLimits?: Record<string, unknown> };
  const buckets = response.rateLimitsByLimitId && Object.keys(response.rateLimitsByLimitId).length ? response.rateLimitsByLimitId : { [String(response.rateLimits?.limitId || 'codex')]: response.rateLimits! };
  let compared = 0;
  for (const [id, bucket] of Object.entries(buckets)) for (const [slot, item] of Object.entries(bucket)) {
    if (!item || typeof item !== 'object' || !('usedPercent' in item)) continue;
    const win = item as { usedPercent: number; resetsAt?: number };
    if (typeof win.usedPercent !== 'number') continue;
    const metric = normalized.metrics.find(m => m.id === `${id}_${slot}`);
    assert.ok(metric); assert.ok(Math.abs(Number(metric.remaining) - (100 - win.usedPercent)) < 0.000001);
    if (typeof win.resetsAt === 'number') assert.equal(metric.resetAt, new Date(win.resetsAt * 1000).toISOString());
    compared++;
  }
  evidence.codex = { officialRead: 'passed', runtimeVersion: raw.runtimeVersion, bucketCount: Object.keys(buckets).length, comparedWindows: compared, normalizedMetricCount: normalized.metrics.length, percentageDirection: 'passed', timestamps: 'passed', identityAndValues: 'not exported', uiAccountComparison: 'pending' };
} catch (error) {
  evidence.codex = { officialRead: 'not_verified', code: error instanceof AdapterError ? error.code : 'CHECK_FAILED' };
}
try {
  const adapter = new CopilotLocalAdapter();
  const result = await adapter.collect({ connectionId: 'local-verification', generation: 1, reason: 'probe' });
  evidence.copilot = { officialRead: 'passed', runtimeVersion: result.runtimeVersion, metricCount: result.metrics.length, identityAndValues: 'not exported', uiAccountComparison: 'pending' };
} catch (error) {
  evidence.copilot = { officialRead: 'not_verified', code: error instanceof AdapterError ? error.code : 'CHECK_FAILED' };
}
await fs.mkdir('docs/evidence/backend-v1', { recursive: true });
await fs.writeFile('docs/evidence/backend-v1/local-runtime-report.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
}
void main().catch(() => { console.error('本地适配器验证未完成'); process.exitCode = 1; });
