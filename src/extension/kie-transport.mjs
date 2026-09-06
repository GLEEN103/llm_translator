import { AppError, LIMITS } from './contract.mjs';

export const KIE_TIMEOUT_MS = 180_000;
export const KIE_PORT = 'kie-private-transport';
const FILE = 'kie-offscreen.html';
const errors = new Set(['PROVIDER_RESPONSE_TOO_LARGE', 'KIE_REQUEST_TIMEOUT', 'PROVIDER_NETWORK', 'INVALID_REQUEST', 'KIE_WORKER_START_FAILED']);

// Background owns authorization and accounting. Only the actual offscreen document gets this port.
export function createKieTransport(chrome) {
  const pending = new Map();
  let port, connecting, serial = Promise.resolve(), users = 0;
  const lock = task => { const result = serial.then(task); serial = result.catch(() => {}); return result; };
  const fail = () => { for (const entry of [...pending.values()]) entry.finish(new AppError('KIE_TRANSPORT_DISCONNECTED')); };
  chrome.runtime.onConnect.addListener(candidate => {
    if (candidate.name !== KIE_PORT) return;
    void (async () => {
      const sender = candidate.sender;
      const attempt = connecting, origin = chrome.runtime.getURL('').replace(/\/$/, '');
      if (!attempt || port || sender?.id !== chrome.runtime.id || sender.url !== attempt.url || sender.origin !== origin || sender.tab) {
        candidate.disconnect(); return;
      }
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [attempt.url] });
      // Chrome can omit MessageSender.documentId for offscreen ports. Verify the live document
      // and this creation's unguessable URL; still reject a provided mismatching documentId.
      if (connecting !== attempt || port || !contexts.some(context => context.contextType === 'OFFSCREEN_DOCUMENT' &&
          context.documentUrl === attempt.url && context.documentOrigin === origin && context.tabId === -1 && context.documentId &&
          (sender.documentId === undefined || context.documentId === sender.documentId))) { candidate.disconnect(); return; }
      port = candidate;
      candidate.onDisconnect.addListener(() => { if (port === candidate) { port = undefined; fail(); } });
      candidate.onMessage.addListener(message => {
        if (port !== candidate || message?.type === 'pulse') return;
        const entry = pending.get(message?.id);
        if (!entry) return;
        if (message.type === 'error') { entry.finish(new AppError(errors.has(message.code) ? message.code : 'PROVIDER_NETWORK')); return; }
        if (message.type !== 'result' || !Number.isInteger(message.status) || message.status < 200 || message.status > 599 ||
            typeof message.text !== 'string' || new TextEncoder().encode(message.text).length > LIMITS.responseBytes ||
            typeof message.contentType !== 'string' || message.contentType.length > 256) {
          entry.finish(new AppError('KIE_RESPONSE_ENVELOPE')); return;
        }
        try {
          entry.finish(null, new Response([204, 205, 304].includes(message.status) ? null : message.text,
            { status: message.status, headers: { 'content-type': message.contentType } }));
        } catch { entry.finish(new AppError('KIE_RESPONSE_ENVELOPE')); }
      });
      attempt.resolve();
    })().catch(() => { candidate.disconnect(); });
  });
  const ensure = () => lock(async () => {
    if (port) return;
    // A document left behind after a worker restart must not resume old jobs.
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.some(context => context.documentUrl?.split('#')[0] === chrome.runtime.getURL(FILE))) await chrome.offscreen.closeDocument();
    let timer;
    const url = `${FILE}#${crypto.randomUUID()}`;
    const ready = new Promise((resolve, reject) => { connecting = { resolve, reject, url: chrome.runtime.getURL(url) }; timer = setTimeout(() => reject(new AppError('KIE_TRANSPORT_START_TIMEOUT')), 8000); });
    try {
      await Promise.all([ready, chrome.offscreen.createDocument({ url, reasons: ['WORKERS'],
        justification: 'Run bounded Kie translation network requests in a dedicated worker while the service worker handles authorization and accounting.' })]);
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('KIE_TRANSPORT_START_FAILED');
    } finally { clearTimeout(timer); connecting = undefined; }
  });
  const closeIfIdle = () => lock(async () => {
    if (users || pending.size) return;
    const old = port; port = undefined; old?.disconnect();
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.some(context => context.documentUrl?.split('#')[0] === chrome.runtime.getURL(FILE))) await chrome.offscreen.closeDocument();
  }).catch(() => {});
  return async (url, options) => {
    const signal = options.signal;
    signal?.throwIfAborted(); users++;
    try {
      await ensure(); signal?.throwIfAborted();
      if (!port) throw new AppError('KIE_TRANSPORT_DISCONNECTED');
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID(), target = port;
        let done = false, timer;
        const finish = (error, response) => {
          if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(id);
          if (error) { try { target.postMessage({ type: 'cancel', id }); } catch {} reject(error); } else resolve(response);
        };
        const abort = () => finish(new AppError('CANCELLED'));
        pending.set(id, { finish }); signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => finish(new AppError('KIE_REQUEST_TIMEOUT')), KIE_TIMEOUT_MS);
        try { target.postMessage({ type: 'fetch', id, url, authorization: options.headers?.Authorization, body: options.body }); }
        catch { finish(new AppError('KIE_TRANSPORT_DISCONNECTED')); }
      });
    } finally { users--; void closeIfIdle(); }
  };
}
