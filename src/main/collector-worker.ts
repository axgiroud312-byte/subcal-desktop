import { getAdapter } from './adapters';
import { AdapterError, type CollectInput } from './adapters/types';

const controller = new AbortController();
let started = false;
process.on('message', async (message: { type: string; adapterId?: string; input?: CollectInput }) => {
  if (message.type === 'cancel') { controller.abort(); return; }
  if (started || message.type !== 'collect' || !message.adapterId || !message.input) return;
  started = true;
  try {
    const adapter = getAdapter(message.adapterId);
    const result = await adapter.collect({ ...message.input, signal: controller.signal });
    process.send?.({ ok: true, result });
  } catch (error) {
    const e = error instanceof AdapterError ? error : new AdapterError('UPSTREAM_UNAVAILABLE', '采集进程未能完成查询');
    // Never serialize an upstream stack, raw response, headers or generic message.
    process.send?.({ ok: false, error: { code: e.code, message: e.message, options: e.options } });
  } finally {
    if (message.input) message.input.secret = undefined;
  }
});
process.on('disconnect', () => { controller.abort(); process.exit(0); });
