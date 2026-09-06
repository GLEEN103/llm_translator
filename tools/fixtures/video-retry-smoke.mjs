// Real broker/cache/session/UI with synthetic captions and provider responses.
import './core.js';
import './video-core.js';
import './video-session.js';
import { createBroker } from './broker.mjs';
const native = globalThis.chrome, roots = [], attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) { const root = attach.call(this, options); roots.push(root); return root; };
const player = document.getElementById('movie_player'), video = document.querySelector('video'), videoId = 'abcdefghijk';
Object.defineProperty(video, 'readyState', { value: 4 }); Object.defineProperty(video, 'currentTime', { value: 0, writable: true });
const listeners = [], fixture = globalThis.videoRetryFixture = { roots, fail: true, calls: Number(sessionStorage.getItem('fixture-provider-calls') ?? 0) };
const brokerChrome = { runtime: native.runtime, storage: native.storage, tabs: { get: async () => ({ url: 'https://www.youtube.com/watch?v=' + videoId }) } };
const broker = createBroker({ chrome: brokerChrome, fetchImpl: async (_url, options) => {
  if (options.method === 'GET') return Response.json({ object: 'list', data: [{ id: 'gpt-5.6-luna', object: 'model' }] });
  fixture.calls++; sessionStorage.setItem('fixture-provider-calls', String(fixture.calls));
  const input = JSON.parse(JSON.parse(options.body).input[0].content[0].text);
  return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
    text: fixture.fail && input.segments[0].text === 'phrase-0' ? 'not JSON' : JSON.stringify({ translations: input.segments.map(s => ({ id: s.id, text: `T:${s.text}` })) }) }] }],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
} });
const optionsSender = { id: native.runtime.id, url: native.runtime.getURL('options.html') };
const { catalogId } = await broker.handle({ type: 'LOAD_MODELS', provider: 'openai', apiKey: 'DUMMY_RETRY_KEY_123', credentialModel: 'gpt-5.6-luna' }, optionsSender);
await broker.handle({ type: 'SAVE_SETTINGS', provider: 'openai', apiKey: 'DUMMY_RETRY_KEY_123', model: 'gpt-5.6-luna', catalogId }, optionsSender);
await broker.handle({ type: 'ACCEPT_CONSENT', version: '1.0' }, optionsSender);
await native.storage.session.set({ 'grant:777': { documentId: 'fixture-doc', grant: 'fixture-grant' } });
const sender = { id: native.runtime.id, url: 'https://www.youtube.com/watch?v=' + videoId, tab: { id: 777 }, frameId: 0, documentId: 'fixture-doc' };
fixture.summary = () => broker.handle({ type: 'VIDEO_CACHE_STATUS' }, optionsSender);
fixture.open = () => listeners.forEach(listener => listener({ type: 'OPEN_VIDEO', videoId, grant: 'fixture-grant' }, { id: native.runtime.id }, () => {}));
globalThis.TranslatorYouTubeDOM = { videoId: () => videoId, createBinding: () => ({ poll: () => ({ ready: true, ended: false, video, player }) }) };
Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { id: native.runtime.id,
  onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async message => {
    if (message.type === 'VIDEO_TRACKS') return { ok: true, data: { tracks: [{ index: 0, label: 'Fixture English', language: 'en', automatic: false }] } };
    if (message.type === 'VIDEO_CAPTIONS') return { ok: true, data: { cues: Array.from({ length: 128 }, (_, i) => ({ id: `cue-${i}`, start: i * 2, end: i * 2 + 2, text: `phrase-${i}` })) } };
    try { return { ok: true, data: await broker.handle(message, sender) }; } catch (error) { return { ok: false, error: error.code }; }
  }
} } });
await import('./video-content.js'); fixture.ready = true;
