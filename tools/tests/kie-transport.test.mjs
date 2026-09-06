import test from 'node:test';
import assert from 'node:assert/strict';
import { createKieTransport, KIE_PORT, KIE_TIMEOUT_MS } from '../../src/extension/kie-transport.mjs';
import { startKieHost } from '../../src/extension/kie-offscreen-host.mjs';
import { workerFetch } from '../../src/extension/kie-worker.mjs';
import { createKieProvider } from '../../src/extension/kie.mjs';
import '../../src/extension/core.js';

const event = () => { const listeners = []; return { addListener: f => listeners.push(f), emit: (...args) => listeners.forEach(f => f(...args)) }; };
async function flush() { for (let i = 0; i < 150; i++) await Promise.resolve(); }
function fixture(fetchImpl, { senderPatch = {} } = {}) {
  const context = { documentId: 'offscreen-document', contextType: 'OFFSCREEN_DOCUMENT', tabId: -1, documentOrigin: 'chrome-extension://extension' }, connections = [], outbound = [], workers = [];
  let exists = false, opens = 0, closes = 0;
  const runtime = { id: 'extension', getURL: file => `chrome-extension://extension/${file}`, onConnect: event(),
    getContexts: async () => exists ? [context] : [],
    connect: ({ name }) => {
      let disconnected = false;
      const host = { name, onMessage: event(), onDisconnect: event() };
      // Actual Chrome offscreen ports can omit documentId even though getContexts has it.
      const background = { name, sender: { id: runtime.id, url: context.documentUrl, origin: context.documentOrigin, ...senderPatch }, onMessage: event(), onDisconnect: event() };
      host.postMessage = message => { if (disconnected) throw Error('closed'); outbound.push(message); queueMicrotask(() => background.onMessage.emit(message)); };
      background.postMessage = message => { if (disconnected) throw Error('closed'); queueMicrotask(() => host.onMessage.emit(message)); };
      host.disconnect = background.disconnect = () => { if (disconnected) return; disconnected = true; host.onDisconnect.emit(); background.onDisconnect.emit(); };
      connections.push(background); queueMicrotask(() => runtime.onConnect.emit(background)); return host;
    }
  };
  const makeWorker = () => {
    const controller = new AbortController();
    const worker = { stopped: false, terminate() { this.stopped = true; controller.abort(); }, postMessage(data) {
      workerFetch(data, { fetchImpl, signal: controller.signal }).then(value => {
        if (!worker.stopped) worker.onmessage({ data: { type: 'result', ...value } });
      }, error => { if (!worker.stopped) worker.onmessage({ data: { type: 'error', code: error.code ?? 'PROVIDER_NETWORK' } }); });
    } };
    workers.push(worker); return worker;
  };
  const chrome = { runtime, offscreen: {
    createDocument: async options => { assert.deepEqual(options.reasons, ['WORKERS']); opens++; exists = true; context.documentUrl = runtime.getURL(options.url); startKieHost({ runtime, makeWorker }); },
    closeDocument: async () => { closes++; exists = false; for (const connection of connections) connection.disconnect(); }
  } };
  const transport = createKieTransport(chrome);
  return { transport, runtime, connections, outbound, workers, stats: () => ({ exists, opens, closes }) };
}
const request = { jobId: 'dummy', sourceLanguage: 'auto', targetLanguage: 'ko', chars: 64,
  segments: Array.from({ length: 64 }, (_, i) => ({ id: `s${i + 4}`, text: 'a' })) };
const response = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: request.segments.map(s => ({ id: s.id, text: '모의 번역' })) }) } }],
  usage: { prompt_tokens: 50, completion_tokens: 300, total_tokens: 350 } });
const provider = f => createKieProvider({ apiKey: 'DUMMY_KEY', model: 'gemini-3-8-flash-openai', fetchImpl: f.transport });

test('delayed 64-segment result survives 25 seconds through transport, records usage and closes workers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0, complete = false, usage;
  const f = fixture(async (_url, options) => { calls++; assert.equal(options.headers.Authorization, 'Bearer DUMMY_KEY');
    return new Promise(resolve => setTimeout(() => resolve(response()), 45000)); });
  const result = globalThis.TranslatorCore.requestMessage({ sendMessage: async () => ({ ok: true,
    data: await provider(f)(request, { onUsage: (_id, value) => { usage = value; } }) }) }, { type: 'TRANSLATE', body: { provider: 'kie' } })
    .then(value => { complete = true; return value; });
  await flush(); t.mock.timers.tick(25001); await flush();
  assert.equal(complete, false); assert.equal(f.workers[0].stopped, false); assert.ok(f.outbound.some(m => m.type === 'pulse'));
  t.mock.timers.tick(19999); await flush();
  assert.equal((await result).translations.length, 64); assert.equal(calls, 1); assert.equal(usage.totalTokenCount, 350);
  await flush(); assert.deepEqual(f.stats(), { exists: false, opens: 1, closes: 1 }); assert.ok(f.workers.every(w => w.stopped));
  assert.ok(f.outbound.every(m => !JSON.stringify(m).includes('DUMMY_KEY')));
  const pulses = f.outbound.length; t.mock.timers.tick(60000); await flush(); assert.equal(f.outbound.length, pulses);
});

test('Kie reaches its 180 second deadline once, terminates the fetch and records unknown usage', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let aborted = 0, calls = 0, usage;
  const f = fixture(async (_url, { signal }) => { calls++; return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted++; reject(Error('aborted')); })); });
  const result = assert.rejects(provider(f)(request, { onUsage: (_id, value) => { usage = value; } }), { code: 'KIE_REQUEST_TIMEOUT' });
  await flush(); t.mock.timers.tick(KIE_TIMEOUT_MS); await flush(); await result;
  assert.equal(calls, 1); assert.equal(aborted, 1); assert.deepEqual(usage, {}); assert.equal(f.stats().exists, false);
});

test('cancelling one concurrent request preserves the other and discards late output', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const finish = [];
  const f = fixture(async () => new Promise(resolve => finish.push(resolve))), controller = new AbortController();
  const first = assert.rejects(provider(f)(request, { signal: controller.signal }), { code: 'CANCELLED' });
  const second = provider(f)({ ...request, jobId: 'second' });
  await flush(); assert.equal(f.workers.length, 2); assert.equal(f.stats().opens, 1);
  controller.abort(); await flush(); await first; assert.equal(f.stats().exists, true); assert.equal(f.workers[0].stopped, true);
  finish[0](response()); finish[1](response()); await flush(); assert.equal((await second).jobId, 'second');
  await flush(); assert.equal(f.stats().exists, false); assert.ok(f.workers.every(w => w.stopped));
});

test('offscreen port loss ends pending work, does not resend, and a later request creates a fresh document', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  const f = fixture(async () => { calls++; return calls === 1 ? new Promise(() => {}) : response(); });
  const result = assert.rejects(provider(f)(request), { code: 'KIE_TRANSPORT_DISCONNECTED' });
  await flush(); f.connections[0].disconnect(); await flush(); await result;
  assert.equal(calls, 1); assert.equal(f.workers[0].stopped, true);
  assert.equal((await provider(f)(request)).translations.length, 64); await flush(); assert.equal(f.stats().opens, 2);
});

test('unrequested/foreign/content-script ports never receive a key or request', async () => {
  const f = fixture(async () => response());
  for (const sender of [{ id: 'other', url: f.runtime.getURL('kie-offscreen.html') },
    { id: f.runtime.id, url: f.runtime.getURL('kie-offscreen.html'), tab: { id: 1 }, documentId: 'x' },
    { id: f.runtime.id, url: f.runtime.getURL('options.html'), documentId: 'x' }]) {
    let closed = false;
    f.runtime.onConnect.emit({ name: KIE_PORT, sender, disconnect: () => { closed = true; }, postMessage: () => assert.fail('must not transmit') });
    await flush(); assert.equal(closed, true);
  }
});

test('dedicated worker rejects arbitrary destinations and oversized input and bounds the response', async () => {
  const valid = { url: 'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions', authorization: 'Bearer DUMMY', body: '{}' };
  for (const patch of [{ url: 'https://evil.invalid/' }, { url: 'https://api.kie.ai/client/v1/model-pricing/page' }, { authorization: 'Bearer bad\r\nInjected: value' }, { body: 'x'.repeat(131073) }]) {
    await assert.rejects(workerFetch({ ...valid, ...patch }, { fetchImpl: () => assert.fail('must not fetch') }), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(workerFetch(valid, { fetchImpl: async (_url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    return new Response('x'.repeat(262145));
  } }), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
});

test('a matching URL with a different document ID cannot obtain a request during startup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  const f = fixture(async () => { calls++; return response(); }, { senderPatch: { documentId: 'unregistered-document' } });
  const result = assert.rejects(provider(f)(request), { code: 'KIE_TRANSPORT_START_TIMEOUT' });
  await flush(); t.mock.timers.tick(8000); await flush(); await result;
  assert.equal(calls, 0); assert.equal(f.workers.length, 0); assert.equal(f.stats().exists, false);
});

test('startup rejects stale nonce, wrong origin and tab senders even when documentId is absent', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const senderPatch of [{ url: 'chrome-extension://extension/kie-offscreen.html#stale' },
    { origin: 'https://evil.invalid' }, { tab: { id: 1 } }]) {
    let calls = 0;
    const f = fixture(async () => { calls++; return response(); }, { senderPatch });
    const result = assert.rejects(provider(f)(request), { code: 'KIE_TRANSPORT_START_TIMEOUT' });
    await flush(); t.mock.timers.tick(8000); await flush(); await result;
    assert.equal(calls, 0); assert.equal(f.workers.length, 0); assert.equal(f.stats().exists, false);
  }
});

test('a provided matching documentId is accepted and a fresh document uses a new nonce', async () => {
  const f = fixture(async () => response(), { senderPatch: { documentId: 'offscreen-document' } });
  assert.equal((await provider(f)(request)).translations.length, 64); await flush();
  assert.equal((await provider(f)(request)).translations.length, 64); await flush();
  assert.equal(f.connections.length, 2);
  assert.notEqual(f.connections[0].sender.url, f.connections[1].sender.url);
  assert.ok(f.connections.every(p => p.sender.url.startsWith(f.runtime.getURL('kie-offscreen.html#'))));
});

test('response body may arrive after 25 seconds even when headers arrived immediately', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(async () => {
    const text = await response().text();
    return new Response(new ReadableStream({ start(controller) {
      setTimeout(() => { controller.enqueue(new TextEncoder().encode(text)); controller.close(); }, 55000);
    } }), { headers: { 'content-type': 'application/json' } });
  });
  const result = provider(f)(request);
  await flush(); t.mock.timers.tick(30000); await flush(); assert.equal(f.workers[0].stopped, false);
  t.mock.timers.tick(25000); await flush(); assert.equal((await result).translations.length, 64);
  await flush(); assert.equal(f.stats().exists, false);
});
