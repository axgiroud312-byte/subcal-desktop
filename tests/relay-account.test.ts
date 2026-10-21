import test from 'node:test';
import assert from 'node:assert/strict';
import { approveRelayCredential, createRelayAccountAdapter } from '../src/main/adapters/relay-account-adapter';

test('explicit panel approval binds protocol, host, user and credential identity', async () => {
  const values = { origin: 'https://panel.example.com', template: 'new-api-account', apiKey: 'panel-token', userId: '42' };
  const credential = approveRelayCredential(JSON.stringify(values));
  for (const change of [{ origin: 'https://other.example.com' }, { template: 'sub2api-account' }, { userId: '43' }, { apiKey: 'other-token' }]) {
    assert.notEqual(approveRelayCredential(JSON.stringify({ ...values, ...change })).subject, credential.subject);
  }
  for (const change of [{ origin: 'http://panel.example.com' }, { origin: 'https://panel.example.com/api' }, { template: 'guess' }, { userId: '' }]) {
    assert.throws(() => approveRelayCredential(JSON.stringify({ ...values, ...change })));
  }
  const calls: string[] = [];
  const adapter = createRelayAccountAdapter(async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.Authorization, 'panel-token');
    assert.equal(init.headers['New-Api-User'], '42');
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: true, data: { quota: 500000 } }) };
  });
  const input = { connectionId: 'relay', generation: 1, reason: 'scheduled' as const, secret: credential.secret, expectedSubject: credential.subject };
  const result = await adapter.collect(input);
  assert.equal(result.balances?.[0].amount.value, '1');
  assert.equal(result.account.subject, credential.subject);
  assert.deepEqual(calls, ['https://panel.example.com/api/user/self']);
  await assert.rejects(adapter.collect({ ...input, secret: JSON.stringify({ ...JSON.parse(credential.secret), origin: 'https://other.example.com' }) }), { code: 'AUTH_REQUIRED' });
  await assert.rejects(adapter.collect({ ...input, expectedSubject: 'another-account' }), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(calls.length, 1);
});
