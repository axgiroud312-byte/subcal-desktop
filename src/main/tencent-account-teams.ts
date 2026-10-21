import { createHash } from 'node:crypto';
import type { AccountCredential } from './account-access';
import { AdapterError } from './adapters/types';

/** Split only after a read-only discovery probe; preserve the original source
 * subject so external rereads validate it before reapplying the team binding. */
export function tencentTeamCredential(credential: AccountCredential, team: { id: string; name: string }): AccountCredential {
  if (!/^tencent-token-plan-(ap-guangzhou|ap-singapore)$/.test(credential.providerId)) {
    throw new AdapterError('UNSUPPORTED', '只有腾讯 Token Plan 支持此团队拆分');
  }
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(credential.secret);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    root = parsed as Record<string, unknown>;
  } catch { throw new AdapterError('AUTH_REQUIRED', '腾讯团队凭据必须是有效 JSON'); }
  if (root.management !== 'static' && (root.management !== 'external' || !root.locator)) {
    throw new AdapterError('UNSUPPORTED', '团队凭据需要手填来源或可重读的外部来源');
  }
  const id = team.id.trim(), name = team.name.trim() || id;
  if (!id || /[\r\n]/.test(id) || !credential.subject) throw new AdapterError('AUTH_REQUIRED', '团队或原账号标识无效');
  // Keep the original identity so applying the same team again is idempotent.
  const baseSubject = typeof root.tencentBaseSubject === 'string' ? root.tencentBaseSubject : credential.subject;
  const subject = `${credential.providerId}:${createHash('sha256').update(JSON.stringify([baseSubject, id])).digest('hex')}`;
  return {
    ...credential, subject, alias: name, organization: id,
    secret: JSON.stringify({ ...root, tencentBaseSubject: baseSubject, subject, alias: name, organization: id, teamId: id, TeamId: id }),
  };
}
