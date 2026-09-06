import { OPENAI_PORT } from './openai-transport.mjs';
import { LIMITS } from './contract.mjs';

export function startOpenAIHost({ runtime, makeWorker = () => new Worker('openai-worker.mjs', { type: 'module' }) }) {
  const port = runtime.connect({ name: OPENAI_PORT }), workers = new Map();
  let pulse;
  const stop = id => { workers.get(id)?.terminate(); workers.delete(id); if (!workers.size) { clearInterval(pulse); pulse = undefined; } };
  const send = message => { try { port.postMessage(message); } catch { for (const id of [...workers.keys()]) stop(id); } };
  port.onMessage.addListener(message => {
    const id = message?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return;
    if (message.type === 'cancel') { stop(id); return; }
    if (message.type !== 'fetch') return;
    if (workers.has(id) || workers.size >= LIMITS.concurrent) { send({ type: 'error', id, code: 'INVALID_REQUEST' }); return; }
    try {
      const worker = makeWorker(); workers.set(id, worker);
      worker.onmessage = event => { if (workers.get(id) !== worker) return; send({ ...event.data, id }); stop(id); };
      worker.onerror = () => { send({ type: 'error', id, code: 'OPENAI_WORKER_START_FAILED' }); stop(id); };
      worker.postMessage({ url: message.url, authorization: message.authorization, body: message.body });
      if (!pulse) pulse = setInterval(() => send({ type: 'pulse' }), 20000);
    } catch { stop(id); send({ type: 'error', id, code: 'OPENAI_WORKER_START_FAILED' }); }
  });
  port.onDisconnect.addListener(() => { for (const id of [...workers.keys()]) stop(id); });
}
