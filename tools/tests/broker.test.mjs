import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroker } from '../../src/extension/broker.mjs';
import { LIMITS } from '../../src/extension/contract.mjs';
import '../../src/extension/core.js';

const dummyKey = 'DUMMY_NOT_A_REAL_API_KEY_123456';
test('legacy Kie pricing is disabled without network, settings or usage changes', async () => {
  const f = setup({local:{}});
  await assert.rejects(f.send({type:'KIE_PRICES'}),{code:'PROVIDER_DISABLED'});
  assert.equal(f.calls.length,0); assert.deepEqual(f.local,{});
});
function setup({ storage = {}, local = { textConsent: { version: '0.3.0' } }, version = '0.3.0', fetchImpl, modelFetch, now, denyAccess = false, captureImpl, panelTimeoutMs } = {}) {
  const id = 'a'.repeat(32), url = file => `chrome-extension://${id}/${file}`;
  const calls = [], modelCalls = [], access = [];
  const area = memory => ({
    setAccessLevel: async value => { if (denyAccess && memory === local) throw Error('denied'); access.push(value.accessLevel); },
    get: async key => structuredClone({ [key]: memory[key] }),
    set: async value => Object.assign(memory, structuredClone(value)),
    remove: async keys => { for (const key of [].concat(keys)) delete memory[key]; }
  });
  const chrome = { runtime: { id, getURL: url, getManifest: () => ({ version }) },
    storage: { session: area(storage), local: area(local) } };
  const broker = createBroker({ chrome, now, captureImpl, panelTimeoutMs, fetchImpl: async (endpoint, options) => {
    if (options.method === 'GET') {
      modelCalls.push({ endpoint, options });
      if (modelFetch) return modelFetch(endpoint, options);
      return Response.json({ models: ['test-model', 'next-model'].map(id => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) });
    }
    calls.push({ endpoint, options });
    if (fetchImpl) return fetchImpl(endpoint, options);
    const payload = JSON.parse(options.body);
    if (payload.contents[0].parts.some(part => part.inlineData)) return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ recognizedText: 'Hello image', translation: '이미지 안녕', noText: false }) }] } }] });
    const segments = JSON.parse(payload.contents[0].parts[0].text).segments;
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ translations: segments.map(segment => ({ id: segment.id, text: '번역' })) }) }] } }] }));
  } });
  const options = { id, url: url('options.html'), tab: { id: 8 } };
  const content = { id, tab: { id: 7 }, frameId: 0, documentId: 'doc-7', url: 'https://example.invalid' };
  storage['grant:7'] = { documentId: 'doc-7', grant: 'grant-7' };
  const send = (message, sender = options) => broker.handle(message, sender);
  const save = async (apiKey = dummyKey, model = 'test-model') => {
    const { catalogId } = await send({ type: 'LOAD_MODELS', apiKey, credentialModel: model });
    return send({ type: 'SAVE_SETTINGS', apiKey, model, catalogId });
  };
  const translate = async (jobId = 'job-1', overrides = {}, mode) => {
    const settings = await send({ type: 'STATUS' });
    return send({ type: 'TRANSLATE', mode, grant: 'grant-7', body: { jobId, provider: 'google', model: settings.model,
      settingsRevision: settings.settingsRevision, sourceLanguage: 'auto', targetLanguage: 'ko', segments: [{ id: 's1', text: 'Hello' }], ...overrides } }, content);
  };
  return { broker, send, save, translate, calls, modelCalls, access, storage, local, content, options, chrome };
}
test('inline YouTube entry opens the sender document without active-tab query or API calls', async () => {
  const f = setup(); await f.save(); delete f.storage['grant:7'];
  const url = 'https://www.youtube.com/watch?v=abcdefghijk', scripts = [], messages = [];
  f.content.url = url;
  f.chrome.tabs = { get: async id => ({ id, url }), sendMessage: async (...args) => { messages.push(args); return { opened: true }; } };
  f.chrome.scripting = { executeScript: async args => { scripts.push(args); return [{ documentId: 'doc-7', result: url }]; } };
  const result = await f.send({ type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk', tabId: 999, url: 'https://evil.invalid' }, f.content);
  assert.deepEqual(result, { opened: true }); assert.equal(f.calls.length, 0);
  assert.ok(scripts.every(s => s.target.tabId === 7 && s.target.documentIds[0] === 'doc-7'));
  assert.equal(messages[0][0], 7); assert.equal(messages[0][1].type, 'OPEN_VIDEO');
  assert.equal(messages[0][1].videoId, 'abcdefghijk'); assert.deepEqual(messages[0][2], { documentId: 'doc-7' });
  assert.ok(!JSON.stringify(messages).includes(dummyKey));
});

test('Shorts inline entry pins the current document and rejects the previous Short', async () => {
  const f = setup(); await f.save(); f.content.url = 'https://www.youtube.com/';
  let url = 'https://www.youtube.com/shorts/abcdefghijk'; const scripts = [], sent = [];
  f.chrome.tabs = { get: async id => ({ id, url }), sendMessage: async (_id, message) => { sent.push(message); return { opened: true }; } };
  f.chrome.scripting = { executeScript: async args => { scripts.push(args); return [{ documentId: 'doc-7', result: url }]; } };
  assert.deepEqual(await f.send({ type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' }, f.content), { opened: true });
  assert.ok(scripts.some(s => s.files?.includes('youtube-dom.js')));
  assert.equal(sent[0].videoId, 'abcdefghijk'); assert.equal(f.calls.length, 0);
  url = 'https://www.youtube.com/shorts/other_video';
  await assert.rejects(f.send({ type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' }, f.content), { code: 'VIDEO_CHANGED' });
});

test('inline entry rejects foreign, child-frame, stale document and video-changed senders', async () => {
  const f = setup(), url = 'https://www.youtube.com/watch?v=abcdefghijk', message = { type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' };
  await assert.rejects(f.send(message, f.content), { code: 'UNSUPPORTED_VIDEO' });
  f.content.url = url;
  await assert.rejects(f.send(message, { ...f.content, id: 'foreign' }), { code: 'UNAUTHORIZED' });
  await assert.rejects(f.send(message, { ...f.content, frameId: 1 }), { code: 'UNSUPPORTED_VIDEO' });
  await assert.rejects(f.send(message, { ...f.content, documentId: undefined }), { code: 'UNSUPPORTED_VIDEO' });
  f.chrome.tabs = { get: async () => ({ id: 7, url: 'https://www.youtube.com/watch?v=other_video' }) };
  await assert.rejects(f.send(message, f.content), { code: 'VIDEO_CHANGED' });
  f.chrome.tabs.get = async () => ({ id: 7, url });
  f.chrome.scripting = { executeScript: async () => [{ documentId: 'other-doc', result: url }] };
  await assert.rejects(f.send(message, f.content), { code: 'PAGE_CHANGED' }); assert.equal(f.calls.length, 0);
});

test('SPA home or previous-watch sender URL opens the current pinned video document', async () => {
  const f = setup(); await f.save(); const url = 'https://www.youtube.com/watch?v=abcdefghijk';
  f.chrome.tabs = { get: async () => ({ id: 7, url }), sendMessage: async () => ({ opened: true }) };
  f.chrome.scripting = { executeScript: async () => [{ documentId: 'doc-7', result: url }] };
  for (const oldUrl of ['https://www.youtube.com/', 'https://www.youtube.com/watch?v=other_video']) {
    f.content.url = oldUrl;
    assert.deepEqual(await f.send({ type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' }, f.content), { opened: true });
  }
  await assert.rejects(f.send({ type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' }, { ...f.content, origin: 'https://evil.invalid' }), { code: 'UNSUPPORTED_VIDEO' });
  f.chrome.scripting.executeScript = async () => [{ documentId: 'doc-7', result: 'https://www.youtube.com/' }];
  await assert.rejects(f.send({ type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' }, f.content), { code: 'PAGE_CHANGED' });
  assert.equal(f.calls.length, 0);
});

test('caption reads and translation work after same-document SPA navigation from home', async () => {
  const f = setup(); await f.save(); f.content.url = 'https://www.youtube.com/';
  const videoId = 'abcdefghijk'; f.chrome.tabs = { get: async () => ({ url: `https://www.youtube.com/watch?v=${videoId}` }) };
  f.chrome.scripting = { executeScript: async () => [{ documentId: 'doc-7', result: { videoId, raw: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Caption' }] }] }) } }] };
  assert.equal((await f.send({ type: 'VIDEO_CAPTIONS', videoId, trackIndex: 0, grant: 'grant-7' }, f.content)).cues[0].text, 'Caption');
  const settings = await f.send({ type: 'STATUS' });
  assert.ok(await f.send({ type: 'TRANSLATE', mode: 'video', videoId, grant: 'grant-7', body: { jobId: 'spa-video', provider: 'google', model: settings.model, settingsRevision: settings.settingsRevision, sourceLanguage: 'auto', targetLanguage: 'ko', segments: [{ id: 's1', text: 'Caption' }] } }, f.content));
  assert.equal(f.calls.length, 1);
  const usage = await f.send({ type: 'USAGE_GET' }, { id: f.chrome.runtime.id, url: f.chrome.runtime.getURL('statistics.html') });
  assert.equal(usage.rows[0].kind, 'video'); assert.equal(usage.rows[0].attempts, 1);
});

test('inline entry sends missing consent or configuration to options without granting translation', async () => {
  const f = setup(), url = 'https://www.youtube.com/watch?v=abcdefghijk'; let optionsOpened = 0;
  delete f.storage['grant:7']; f.content.url = url;
  f.chrome.tabs = { get: async () => ({ id: 7, url }) };
  f.chrome.runtime.openOptionsPage = async () => { optionsOpened++; };
  f.chrome.scripting = { executeScript: async () => [{ documentId: 'doc-7', result: url }] };
  const message = { type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' };
  assert.deepEqual(await f.send(message, f.content), { opened: false, needsSettings: true });
  await f.save(); f.local.textConsent = { version: 'old' };
  assert.deepEqual(await f.send(message, f.content), { opened: false, needsSettings: true });
  assert.equal(optionsOpened, 2); assert.equal(f.calls.length, 0); assert.equal(f.storage['grant:7'], undefined);
});

test('video appearance persists independently with document authorization and exact validation', async () => {
  const f = setup();
  const defaults = await f.send({ type: 'VIDEO_STYLE_GET', grant: 'grant-7' }, f.content);
  assert.equal(defaults.size, 28);
  const style = { ...defaults, backgroundOpacity: 25, size: 42, font: 'serif', vertical: 15 };
  await f.send({ type: 'VIDEO_STYLE_SET', grant: 'grant-7', style }, f.content);
  assert.deepEqual(f.local.videoAppearance, style);
  assert.deepEqual(await f.send({ type: 'VIDEO_STYLE_GET', grant: 'grant-7' }, f.content), style);
  assert.equal(f.calls.length, 0); assert.equal(f.local.modelProfiles, undefined);
  await assert.rejects(f.send({ type: 'VIDEO_STYLE_SET', grant: 'grant-7', style: { ...style, apiKey: dummyKey } }, f.content), { code: 'INVALID_VIDEO_STYLE' });
  await assert.rejects(f.send({ type: 'VIDEO_STYLE_GET', grant: 'wrong' }, f.content), { code: 'WORKER_INTERRUPTED' });
  const restarted = setup({ local: f.local }); assert.deepEqual(await restarted.send({ type: 'VIDEO_STYLE_GET', grant: 'grant-7' }, restarted.content), style);
});

test('video bridge uses document grants and caption-only provider requests; raw captions remain transient', async () => {
  const f = setup(); await f.save();
  const videoId = 'abcdefghijk'; f.content.url = `https://www.youtube.com/watch?v=${videoId}`;
  f.chrome.tabs = { get: async () => ({ url: f.content.url }) };
  f.chrome.scripting = { executeScript: async () => [{ documentId: 'doc-7', result: { videoId,
    raw: JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Caption hello' }] }] }) } }] };
  const read = await f.send({ type: 'VIDEO_CAPTIONS', grant: 'grant-7', videoId, trackIndex: 0 }, f.content);
  assert.equal(read.cues[0].start, 1); assert.equal(read.cues[0].text, 'Caption hello');
  const settings = await f.send({ type: 'STATUS' });
  const message = { type: 'TRANSLATE', mode: 'video', grant: 'grant-7', videoId, body: { jobId: 'video-job',
    provider: 'google', model: settings.model, settingsRevision: settings.settingsRevision, sourceLanguage: 'auto', targetLanguage: 'ko', segments: [{ id: 'c0', text: 'Caption hello' }] } };
  await f.send(message, f.content);
  assert.ok(!f.calls[0].options.body.includes(videoId)); assert.ok(!f.calls[0].options.body.includes('tStartMs'));
  assert.ok(!JSON.stringify(f.storage).includes('Caption hello')); assert.equal(f.storage['pageCache:7'], undefined);
  f.chrome.tabs.get = async () => ({ url: 'https://www.youtube.com/watch?v=other_video' });
  await assert.rejects(f.send(message, f.content), { code: 'VIDEO_CHANGED' });
  f.local.textConsent = { version: 'old' };
  await assert.rejects(f.send({ type: 'VIDEO_TRACKS', grant: 'grant-7', videoId }, f.content), { code: 'CONSENT_REQUIRED' });
});

async function videoFixture(options = {}) {
  const f = setup(options); await f.save();
  f.content.url = 'https://www.youtube.com/watch?v=abcdefghijk'; f.chrome.tabs = { get: async () => ({ url: f.content.url }) };
  f.video = async (jobId = 'video-job', segments = [{ id: 's1', text: 'Caption original' }], patch = {}) => {
    const settings = await f.send({ type: 'STATUS' });
    return f.send({ type: 'TRANSLATE', mode: 'video', videoId: 'abcdefghijk', grant: 'grant-7', body: { jobId, provider: 'google', model: settings.model,
      settingsRevision: settings.settingsRevision, sourceLanguage: 'auto', targetLanguage: 'ko', segments, ...patch } }, f.content);
  };
  return f;
}
test('video cache survives tab close and worker recreation, remaps IDs, and bypasses quota/usage on hits', async () => {
  const f = await videoFixture(); await f.video(); const usage = JSON.stringify(f.local.tokenUsage);
  assert.equal(f.local.videoTranslationCache.videos.length, 1); assert.ok(!JSON.stringify(f.local.videoTranslationCache).includes('Caption original'));
  await f.broker.forget(7, true);
  const restart = await videoFixture({ local: f.local, storage: { providerQuota: { chars: LIMITS.sessionChars, attempts: Array(60).fill(Date.now()) } } });
  restart.content.url = 'https://www.youtube.com/shorts/abcdefghijk';
  const result = await restart.video('new-job', [{ id: 'remapped', text: 'Caption original' }]);
  assert.equal(restart.calls.length, 0); assert.deepEqual(result.translations, [{ id: 'remapped', text: '번역' }]);
  assert.equal(JSON.stringify(f.local.tokenUsage), usage);
  await assert.rejects(restart.video('changed', [{ id: 'new', text: 'New source' }]), { code: 'CLIENT_RATE_LIMIT' });
});
test('video cache sends only missing text and never mixes target languages', async () => {
  const f = await videoFixture(); await f.video();
  await f.video('partial', [{ id: 'a', text: 'Caption original' }, { id: 'b', text: 'Fresh source' }]);
  const payload = JSON.parse(f.calls[1].options.body);
  assert.deepEqual(JSON.parse(payload.contents[0].parts[0].text).segments, [{ id: 'b', text: 'Fresh source' }]);
  await f.video('japanese', [{ id: 'a', text: 'Caption original' }], { targetLanguage: 'ja' }); assert.equal(f.calls.length, 3);
});
test('cache management is options-only and cache hits still require consent, grant, and current video', async () => {
  const f = await videoFixture(); await f.video();
  assert.equal((await f.send({ type: 'VIDEO_CACHE_STATUS' })).videos, 1);
  for (const type of ['VIDEO_CACHE_STATUS', 'VIDEO_CACHE_CLEAR']) await assert.rejects(f.send({ type, grant: 'grant-7' }, f.content));
  assert.equal((await f.send({ type: 'VIDEO_CACHE_STATUS' })).videos, 1);
  f.local.textConsent = { version: 'old' }; await assert.rejects(f.video(), { code: 'CONSENT_REQUIRED' });
  f.local.textConsent = { version: '0.3.0' }; delete f.storage['grant:7']; await assert.rejects(f.video(), { code: 'WORKER_INTERRUPTED' });
  await f.send({ type: 'VIDEO_CACHE_CLEAR' }); assert.equal((await f.send({ type: 'VIDEO_CACHE_STATUS' })).videos, 0); assert.ok(f.local.modelProfiles);
});
test('cache persistence failure keeps valid translation and signals a warning; invalid format is never cached', async () => {
  const f = await videoFixture(); const set = f.chrome.storage.local.set;
  f.chrome.storage.local.set = async value => { if (value.videoTranslationCache) throw Error('quota'); return set(value); };
  const result = await f.video(); assert.equal(result.cacheWarning, true); assert.equal(result.translations.length, 1);
  const bad = await videoFixture({ fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'bad JSON' }] } }] }) });
  await assert.rejects(bad.video(), { code: 'INVALID_PROVIDER_RESPONSE' }); assert.equal(bad.local.videoTranslationCache, undefined);
});
test('format retries traverse the broker quota and usage accounting for every API attempt', async () => {
  let calls = 0;
  const f = await videoFixture({ fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: ++calls < 4 ? 'bad JSON' : JSON.stringify({ translations: [{ id: 's1', text: 'Recovered' }] }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }) });
  const result = await globalThis.TranslatorCore.formatRetry(() => f.video(), () => true, { wait: async () => {} });
  assert.equal(result.translations[0].text, 'Recovered'); assert.equal(calls, 4); assert.equal(f.storage.providerQuota.attempts.length, 4);
  assert.equal(f.local.tokenUsage.rows[0].attempts, 4); assert.equal(f.local.tokenUsage.rows[0].tokens.total, 60);
});

test('video reads reject non-YouTube pages and discard stale documents after fetch', async () => {
  const f = setup(); const videoId = 'abcdefghijk';
  await assert.rejects(f.send({ type: 'VIDEO_TRACKS', grant: 'grant-7', videoId }, f.content), { code: 'UNSUPPORTED_VIDEO' });
  f.content.url = `https://www.youtube.com/watch?v=${videoId}`;
  f.chrome.tabs = { get: async () => ({ url: f.content.url }) };
  f.chrome.scripting = { executeScript: async () => {
    delete f.storage['grant:7'];
    return [{ documentId: 'doc-7', result: { videoId, tracks: [{ index: 0, label: 'English', language: 'en', automatic: false }] } }];
  } };
  await assert.rejects(f.send({ type: 'VIDEO_TRACKS', grant: 'grant-7', videoId }, f.content), { code: 'VIDEO_CHANGED' });
});

test('popup video entry pins scripts and messages to the watch document and reports missing players', async () => {
  const f = setup(), videoId = 'abcdefghijk', url = `https://www.youtube.com/watch?v=${videoId}`, scripts = [], sent = [];
  f.chrome.tabs = { query: async () => [{ id: 7, url }], sendMessage: async (...args) => { sent.push(args); return { opened: true }; } };
  f.chrome.scripting = { executeScript: async args => { scripts.push(args); return [{ documentId: 'doc-7', result: url }]; } };
  const popup = { id: f.options.id, url: f.chrome.runtime.getURL('popup.html') };
  assert.equal((await f.send({ type: 'OPEN', mode: 'video' }, popup)).opened, true);
  assert.deepEqual(scripts[1].target, { tabId: 7, documentIds: ['doc-7'] });
  assert.ok(scripts[1].files.includes('video-content.js'));
  assert.equal(sent[0][1].type, 'OPEN_VIDEO'); assert.equal(sent[0][1].videoId, videoId);
  assert.deepEqual(sent[0][2], { documentId: 'doc-7' });
  f.chrome.tabs.sendMessage = async () => ({ opened: false });
  await assert.rejects(f.send({ type: 'OPEN', mode: 'video' }, popup), { code: 'CAPTIONS_UNAVAILABLE' });
  f.chrome.tabs.query = async () => [{ id: 7, url: 'https://example.invalid' }];
  await assert.rejects(f.send({ type: 'OPEN', mode: 'video' }, popup), { code: 'UNSUPPORTED_VIDEO' });
});

test('first inline open does not wait for document_idle on a loading YouTube page', async () => {
  const f = setup(); await f.save(); const url = 'https://www.youtube.com/watch?v=abcdefghijk', scripts = [];
  f.content.url = url;
  f.chrome.tabs = { get: async id => ({ id, url }), sendMessage: async () => ({ opened: true }) };
  f.chrome.scripting = { executeScript: async args => {
    scripts.push(args);
    if (!args.injectImmediately) return new Promise(() => {});
    return [{ documentId: 'doc-7', result: url }];
  } };
  let timer;
  try {
    const result = await Promise.race([f.send({ type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' }, f.content),
      new Promise(resolve => { timer = setTimeout(() => resolve('waiting-for-page-idle'), 100); })]);
    assert.deepEqual(result, { opened: true });
    assert.ok(scripts.every(s => s.injectImmediately && s.target.documentIds[0] === 'doc-7'));
    assert.ok(!scripts.find(s => s.files)?.files.includes('image-content.js'));
  } finally { clearTimeout(timer); }
});

test('stalled document check, injection or open response times out and permits retry', async () => {
  for (const stage of ['document', 'files', 'message']) {
    const f = setup({ panelTimeoutMs: 15 }); await f.save();
    const url = 'https://www.youtube.com/watch?v=abcdefghijk'; f.content.url = url;
    let stuck = true, messages = 0, release;
    const wait = () => new Promise(resolve => { release = resolve; });
    f.chrome.tabs = { get: async id => ({ id, url }), sendMessage: async () => {
      messages++; return stuck && stage === 'message' ? wait() : { opened: true };
    } };
    f.chrome.scripting = { executeScript: async args => {
      if (stuck && (stage === 'files' ? !!args.files : stage === 'document' && !args.files)) return wait();
      return [{ documentId: 'doc-7', result: url }];
    } };
    const message = { type: 'OPEN_VIDEO_INLINE', videoId: 'abcdefghijk' };
    await assert.rejects(f.send(message, f.content), { code: 'PANEL_OPEN_TIMEOUT' });
    assert.equal(messages, stage === 'message' ? 1 : 0);
    stuck = false; assert.deepEqual(await f.send(message, f.content), { opened: true });
    const before = messages; release(stage === 'message' ? { opened: true } : [{ documentId: 'doc-7', result: url }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages, before); assert.equal(f.calls.length, 0);
  }
});

test('save is persistent per model and never calls the API or returns a key', async () => {
  const f = setup(); const result = await f.save();
  const catalog = await f.send({ type: 'LOAD_MODELS', apiKey: '', credentialModel: result.model });
  const fetched = f.modelCalls.length;
  await f.send({ type: 'SAVE_SETTINGS', apiKey: '', model: result.model, catalogId: catalog.catalogId });
  assert.equal(f.modelCalls.length, fetched);
  assert.equal(result.configured, true); assert.equal(f.calls.length, 0);
  assert.ok(f.access.includes('TRUSTED_CONTEXTS'));
  assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey, dummyKey);
  assert.equal(f.storage.providerSettings, undefined);
  assert.equal(f.storage.modelCatalog, undefined);
  assert.ok(!JSON.stringify(result).includes(dummyKey));
  const publicStatus = await f.send({ type: 'CONTENT_STATUS', grant: 'grant-7' }, f.content);
  assert.ok(!JSON.stringify(publicStatus).includes(dummyKey));
});
test('settings support keeping a saved key, replacing it and deleting it', async () => {
  const f = setup(); await f.save(); const first = f.local.modelProfiles.revision;
  await f.save(''); assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey, dummyKey);
  assert.notEqual(f.local.modelProfiles.revision, first);
  await f.save('ANOTHER_DUMMY_KEY_123456789'); assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey, 'ANOTHER_DUMMY_KEY_123456789');
  assert.equal((await f.send({ type: 'CLEAR_SETTINGS' })).configured, false);
  assert.equal(f.local.modelProfiles, undefined); assert.equal(f.calls.length, 0);
  await assert.rejects(f.save(''), { code: 'NOT_CONFIGURED' });
});
test('settings validate key and model without echoing submitted values', async () => {
  const f = setup();
  for (const [key, model] of [['bad\nkey', 'test-model'], [dummyKey, 'https://evil.invalid'], [dummyKey, 'models/test']]) {
    await assert.rejects(f.save(key, model), { code: 'INVALID_SETTINGS' });
  }
  assert.equal(f.storage.providerSettings, undefined);
});
test('content cannot save/delete keys and foreign senders cannot access settings', async () => {
  const f = setup(); await f.save();
  for (const type of ['SAVE_SETTINGS', 'CLEAR_SETTINGS', 'STATUS', 'LOAD_MODELS', 'ACCEPT_CONSENT', 'ACTIVATE_MODEL', 'DELETE_MODEL']) await assert.rejects(f.send({ type, apiKey: dummyKey, model: 'test-model', version: '0.3.0', grant: 'grant-7' }, f.content));
  await assert.rejects(f.send({ type: 'STATUS' }, { ...f.options, id: 'b'.repeat(32) }), { code: 'UNAUTHORIZED' });
  assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey, dummyKey);
});
test('ungranted documents and child frames cannot call provider', async () => {
  const f = setup(); await f.save();
  for (const sender of [{ ...f.content, frameId: 1 }, { ...f.content, documentId: 'old-doc' }]) await assert.rejects(f.send({ type: 'CONTENT_STATUS', grant: 'grant-7' }, sender));
  await f.broker.forget(7);
  await assert.rejects(f.send({ type: 'CONTENT_STATUS', grant: 'grant-7' }, f.content)); assert.equal(f.calls.length, 0);
});
test('translation directly calls Google with configured key and no local server', async () => {
  const f = setup(); await f.save();
  const result = await f.translate(); assert.equal(result.translations[0].text, '번역');
  assert.equal(f.calls[0].endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
  assert.equal(f.calls[0].options.headers['x-goog-api-key'], dummyKey);
  assert.ok(!JSON.stringify(result).includes(dummyKey));
});
test('settings version change rejects old snapshots', async () => {
  const f = setup(); const old = await f.save(); await f.save();
  await assert.rejects(f.translate('job-1', { settingsRevision: old.settingsRevision }), { code: 'SETTINGS_CHANGED' });
  assert.equal(f.calls.length, 0);
});
test('quota persists across worker recreation and settings saves', async () => {
  const storage = {}; let time = 0;
  const f = setup({ storage, now: () => time }); await f.save();
  for (let i = 0; i < LIMITS.attemptsPerMinute; i++) await f.translate(`job-${i}`);
  const reboot = setup({ storage, now: () => time }); await reboot.save();
  await assert.rejects(reboot.translate(), { code: 'CLIENT_RATE_LIMIT' });
  time = 59_999; await assert.rejects(reboot.translate(), { code: 'CLIENT_RATE_LIMIT' });
  time = 60_000; await reboot.translate(); assert.equal(storage.providerQuota.chars, (LIMITS.attemptsPerMinute + 1) * 5);
});
test('session budget is retained across minute windows and key deletion', async () => {
  const storage = { providerQuota: { chars: LIMITS.sessionChars - 1, attempts: [] } };
  const f = setup({ storage }); await f.save();
  await f.send({ type: 'CLEAR_SETTINGS' }); await f.save();
  await assert.rejects(f.translate(), { code: 'SESSION_BUDGET' }); assert.equal(f.calls.length, 0);
});
test('concurrent quota reservations cannot bypass budget', async () => {
  const storage = { providerQuota: { chars: LIMITS.sessionChars - 5, attempts: [] } };
  const f = setup({ storage }); await f.save();
  const results = await Promise.allSettled([f.translate('one'), f.translate('two')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.calls.length, 1); assert.equal(storage.providerQuota.chars, LIMITS.sessionChars);
});
test('key deletion cancels an active request and clears storage', async () => {
  let signal, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = setup({ fetchImpl: async (_url, options) => {
    signal = options.signal; started();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await f.save(); const pending = assert.rejects(f.translate(), { code: 'CANCELLED' });
  await ready; await f.send({ type: 'CLEAR_SETTINGS' }); await pending;
  assert.equal(signal.aborted, true); assert.equal(f.local.modelProfiles, undefined);
});
test('five active requests block a sixth, and explicit cancellation aborts only its job', async () => {
  const signals = [];
  const f = setup({ fetchImpl: async (_url, options) => {
    signals.push(options.signal);
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await f.save();
  const first = assert.rejects(f.translate('first'), { code: 'CANCELLED' });
  const others = Array.from({ length: 4 }, (_, i) => assert.rejects(f.translate(`other-${i}`), { code: 'CANCELLED' }));
  while (signals.length < 5) await new Promise(resolve => setTimeout(resolve, 1));
  await assert.rejects(f.translate('sixth'), { code: 'CLIENT_BUSY' });
  await f.send({ type: 'CANCEL', jobId: 'first', grant: 'grant-7' }, f.content); await first;
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  await f.send({ type: 'CLEAR_SETTINGS' }); await Promise.all(others);
});

test('five racing reservations share the last minute slot and do not charge rejected starts', async () => {
  const storage = { providerQuota: { chars: 0, attempts: Array(59).fill(1000) } };
  const f = setup({ storage, now: () => 59999 }); await f.save();
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => f.translate(`race-${i}`)));
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.ok(outcomes.filter(o => o.status === 'rejected').every(o => o.reason.code === 'CLIENT_RATE_LIMIT'));
  assert.equal(f.calls.length, 1); assert.equal(storage.providerQuota.attempts.length, 60); assert.equal(storage.providerQuota.chars, 5);
});

test('multiple tabs share a rolling minute rather than resetting the whole count at a minute boundary', async () => {
  const storage = { providerQuota: { chars: 0, attempts: [...Array(30).fill(0), ...Array(30).fill(30000)] } };
  let time = 59999;
  const f = setup({ storage, now: () => time }); await f.save();
  const settings = await f.send({ type: 'STATUS' });
  storage['grant:9'] = { documentId: 'doc-9', grant: 'grant-9' };
  const other = jobId => f.send({ type: 'TRANSLATE', grant: 'grant-9', body: { jobId, provider: 'google', model: settings.model,
    settingsRevision: settings.settingsRevision, sourceLanguage: 'auto', targetLanguage: 'ko', segments: [{ id: 's1', text: 'Other' }] }
  }, { ...f.content, tab: { id: 9 }, documentId: 'doc-9' });
  await assert.rejects(other('before'), { code: 'CLIENT_RATE_LIMIT' });
  time = 60000;
  for (let i = 0; i < 30; i++) await (i % 2 ? other(`tab9-${i}`) : f.translate(`tab7-${i}`));
  await assert.rejects(other('over'), { code: 'CLIENT_RATE_LIMIT' });
  await assert.rejects(f.translate('over'), { code: 'CLIENT_RATE_LIMIT' });
  assert.equal(f.calls.length, 30); assert.equal(storage.providerQuota.attempts.length, 60);
  time = 90000; await other('expired'); assert.equal(storage.providerQuota.attempts.length, 31);
});

test('Google retry cannot become the 61st API attempt', async () => {
  const storage = { providerQuota: { chars: 0, attempts: Array(59).fill(1000) } };
  const f = setup({ storage, now: () => 1001, fetchImpl: async () => Response.json({}, { status: 503 }) }); await f.save();
  await assert.rejects(f.translate('retry-limit'), { code: 'CLIENT_RATE_LIMIT' });
  assert.equal(f.calls.length, 1); assert.equal(storage.providerQuota.attempts.length, 60);
});

test('consent gates translation and opening panels until accepted for the displayed version', async () => {
  const f = setup({ local: {} }); await f.save();
  assert.equal((await f.send({ type: 'STATUS' })).consentAccepted, false);
  await assert.rejects(f.translate(), { code: 'CONSENT_REQUIRED' });
  await assert.rejects(f.send({ type: 'OPEN', mode: 'page' }, { id: f.options.id, url: f.options.url.replace('options.html', 'popup.html') }), { code: 'CONSENT_REQUIRED' });
  await assert.rejects(f.send({ type: 'ACCEPT_CONSENT', version: '0.2.0' }), { code: 'CONSENT_REQUIRED' });
  assert.equal(f.calls.length, 0);
  await f.send({ type: 'ACCEPT_CONSENT', version: '0.3.0' });
  await f.translate('one'); await f.translate('two');
  assert.deepEqual(f.local.textConsent, { version: '0.3.0' });
});

test('consent survives restart, reload and key changes; update and reinstall need new consent', async () => {
  const local = {};
  const f = setup({ local }); await f.send({ type: 'ACCEPT_CONSENT', version: '0.3.0' });
  await f.save(); await f.send({ type: 'CLEAR_SETTINGS' });
  assert.equal((await f.send({ type: 'STATUS' })).consentAccepted, true);
  const restart = setup({ local }); await restart.save(); await restart.translate();
  assert.equal((await setup({ local, storage: restart.storage }).send({ type: 'STATUS' })).consentAccepted, true);
  const update = setup({ local, version: '0.4.0' }); await update.save();
  await assert.rejects(update.translate(), { code: 'CONSENT_REQUIRED' });
  await update.send({ type: 'ACCEPT_CONSENT', version: '0.4.0' }); await update.translate();
  assert.equal((await setup({ local: {} }).send({ type: 'STATUS' })).consentAccepted, false);
});

test('saving requires a model in the catalog fetched with the same key', async () => {
  const f = setup();
  await assert.rejects(f.send({ type: 'SAVE_SETTINGS', apiKey: dummyKey, model: 'test-model' }), { code: 'MODEL_LIST_CHANGED' });
  const data = await f.send({ type: 'LOAD_MODELS', apiKey: dummyKey });
  assert.ok(!JSON.stringify(data).includes(dummyKey));
  for (const change of [{ model: 'not-listed' }, { apiKey: 'ANOTHER_DUMMY_KEY_123456789' }, { catalogId: 'stale' }]) {
    await assert.rejects(f.send({ type: 'SAVE_SETTINGS', apiKey: dummyKey, model: 'test-model', catalogId: data.catalogId, ...change }), { code: 'MODEL_LIST_CHANGED' });
  }
  await f.send({ type: 'SAVE_SETTINGS', apiKey: dummyKey, model: 'test-model', catalogId: data.catalogId });
  assert.equal(f.modelCalls.length, 1);
  assert.equal((await f.send({ type: 'CONTENT_STATUS', grant: 'grant-7' }, f.content)).models, undefined);
});

test('empty or failed reload removes stale catalog', async () => {
  for (const fail of [() => Response.json({ models: [] }), () => new Response('', { status: 403 })]) {
    let broken = false;
    const f = setup({ modelFetch: async () => broken ? fail() : Response.json({ models: [{ name: 'models/test-model', supportedGenerationMethods: ['generateContent'] }] }) });
    const saved = await f.save(); broken = true;
    await assert.rejects(f.send({ type: 'LOAD_MODELS', apiKey: '', credentialModel: 'test-model' }));
    await assert.rejects(f.send({ type: 'SAVE_SETTINGS', apiKey: '', model: 'test-model', catalogId: saved.catalogId }), { code: 'MODEL_LIST_CHANGED' });
    assert.equal(f.storage.modelCatalog, undefined);
    assert.equal((await f.send({ type: 'STATUS' })).configured, true);
  }
});

test('deletion and newer lookups reject late catalog responses even if fetch ignores abort', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = setup({ modelFetch: async () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  const pending = assert.rejects(f.send({ type: 'LOAD_MODELS', apiKey: dummyKey }));
  await ready; await f.send({ type: 'CLEAR_SETTINGS' });
  finish(Response.json({ models: [{ name: 'models/test-model', supportedGenerationMethods: ['generateContent'] }] }));
  await pending; assert.equal(f.storage.modelCatalog, undefined);
});

test('a superseded model lookup cannot overwrite a newer catalog', async () => {
  let finishFirst, started;
  let count = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const f = setup({ modelFetch: async () => {
    if (++count === 1) { started(); return new Promise(resolve => { finishFirst = resolve; }); }
    return Response.json({ models: [{ name: 'models/next-model', supportedGenerationMethods: ['generateContent'] }] });
  } });
  const first = assert.rejects(f.send({ type: 'LOAD_MODELS', apiKey: dummyKey }));
  await ready;
  const next = await f.send({ type: 'LOAD_MODELS', apiKey: 'ANOTHER_DUMMY_KEY_123456789' });
  finishFirst(Response.json({ models: [{ name: 'models/test-model', supportedGenerationMethods: ['generateContent'] }] }));
  await first;
  assert.equal(f.storage.modelCatalog.id, next.catalogId);
  assert.deepEqual(f.storage.modelCatalog.models.map(item => item.id), ['next-model']);
});

test('two model keys survive restart and update and only the active model key is sent', async () => {
  const f = setup(); await f.save(); await f.save('SECOND_DUMMY_KEY_123456789', 'next-model');
  const restart = setup({ local: f.local });
  assert.equal((await restart.send({ type: 'STATUS' })).model, 'next-model');
  await restart.translate(); assert.equal(restart.calls[0].options.headers['x-goog-api-key'], 'SECOND_DUMMY_KEY_123456789');
  await restart.send({ type: 'ACTIVATE_MODEL', model: 'test-model' }); await restart.translate('other');
  assert.equal(restart.calls[1].options.headers['x-goog-api-key'], dummyKey);
  assert.equal(restart.modelCalls.length, 0);
  const update = setup({ local: f.local, version: '0.4.0' });
  assert.equal((await update.send({ type: 'STATUS' })).profiles.length, 2);
  await update.send({ type: 'ACCEPT_CONSENT', version: '0.4.0' }); await update.translate();
  assert.equal(update.calls[0].options.headers['x-goog-api-key'], dummyKey);
});

test('a new model cannot silently inherit another model key', async () => {
  const f = setup(); await f.save();
  const catalog = await f.send({ type: 'LOAD_MODELS', apiKey: '', credentialModel: 'test-model' });
  await assert.rejects(f.send({ type: 'SAVE_SETTINGS', apiKey: '', model: 'next-model', catalogId: catalog.catalogId }), { code: 'MODEL_KEY_REQUIRED' });
  await assert.rejects(f.send({ type: 'ACTIVATE_MODEL', model: 'next-model' }), { code: 'MODEL_KEY_REQUIRED' });
  assert.equal(f.local.modelProfiles.entries['google:next-model'], undefined);
  assert.equal((await f.send({ type: 'STATUS' })).model, 'test-model');
});

test('single deletion preserves other keys, consent and quota; active deletion has no fallback', async () => {
  const f = setup(); await f.save(); await f.translate(); await f.save('SECOND_DUMMY_KEY_123456789', 'next-model');
  await f.send({ type: 'DELETE_MODEL', model: 'next-model' });
  assert.equal((await f.send({ type: 'STATUS' })).configured, false);
  assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey, dummyKey);
  assert.equal(f.local.modelProfiles.entries['google:next-model'], undefined);
  await assert.rejects(f.translate('deleted', { model: 'next-model', settingsRevision: 'old-revision' }), { code: 'NOT_CONFIGURED' });
  await f.send({ type: 'ACTIVATE_MODEL', model: 'test-model' }); await f.translate('again');
  assert.equal(f.storage.providerQuota.chars, 10);
  await f.send({ type: 'CLEAR_SETTINGS' });
  assert.equal(f.local.modelProfiles, undefined); assert.equal(f.local.textConsent.version, '0.3.0');
  assert.equal(f.storage.providerQuota.chars, 10);
});

test('key rotation affects only its model and public responses never include any saved key', async () => {
  const f = setup(); await f.save(); await f.save('SECOND_DUMMY_KEY_123456789', 'next-model');
  await f.save('ROTATED_DUMMY_KEY_123456789', 'test-model');
  assert.equal(f.local.modelProfiles.entries['google:next-model'].apiKey, 'SECOND_DUMMY_KEY_123456789');
  assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey, 'ROTATED_DUMMY_KEY_123456789');
  for (const data of [await f.send({ type: 'STATUS' }), await f.send({ type: 'CONTENT_STATUS', grant: 'grant-7' }, f.content)]) {
    assert.ok(!JSON.stringify(data).includes('DUMMY')); assert.ok(!JSON.stringify(data).includes('apiKey'));
  }
});

test('activating or deleting a model cancels active translation and invalidates its snapshot', async () => {
  for (const type of ['ACTIVATE_MODEL', 'DELETE_MODEL']) {
    let started; const ready = new Promise(resolve => { started = resolve; });
    const f = setup({ fetchImpl: async (_url, { signal }) => {
      started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
    } });
    await f.save(); const old = await f.send({ type: 'STATUS' });
    const pending = assert.rejects(f.translate(), { code: 'CANCELLED' });
    await ready; await f.send({ type, model: 'test-model' }); await pending;
    assert.notEqual((await f.send({ type: 'STATUS' })).settingsRevision, old.settingsRevision);
    assert.equal(f.storage.modelCatalog, undefined);
  }
});

test('storage failures are sanitized and do not report a successful save or deletion', async () => {
  const f = setup(); await f.save();
  f.chrome.storage.local.set = async () => { throw Error(dummyKey); };
  await assert.rejects(f.save('ROTATED_DUMMY_KEY_123456789'), { code: 'STORAGE_FAILED' });
  assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey, dummyKey);
  f.chrome.storage.local.remove = async () => { throw Error(dummyKey); };
  await assert.rejects(f.send({ type: 'CLEAR_SETTINGS' }), { code: 'STORAGE_FAILED' });
  assert.equal((await f.send({ type: 'STATUS' })).configured, true);
});

test('trusted-access failure blocks reads and legacy session keys are never auto-persisted', async () => {
  const denied = setup({ denyAccess: true });
  await assert.rejects(denied.send({ type: 'STATUS' }), { code: 'STORAGE_FAILED' });
  assert.equal(denied.calls.length, 0);
  const f = setup({ storage: { providerSettings: { apiKey: dummyKey, model: 'test-model' } } });
  assert.equal((await f.send({ type: 'STATUS' })).configured, false);
  assert.equal(f.local.modelProfiles, undefined); assert.equal(f.storage.providerSettings, undefined);
});

test('context selection pins injection to the clicked document and keeps source out of storage', async () => {
  const f = setup(); await f.save();
  const injections = [], deliveries = [];
  f.chrome.scripting = { executeScript: async input => { injections.push(input); return [{ documentId: 'clicked-doc', result: 'https://example.invalid/article' }]; } };
  f.chrome.tabs = { sendMessage: async (...args) => deliveries.push(args) };
  await f.broker.openSelection({ selectionText: 'EXACT SELECTED SOURCE', frameId: 0, editable: false, pageUrl: 'https://example.invalid/article' }, { id: 42, url: 'https://example.invalid/article' });
  assert.deepEqual(injections[0].target, { tabId: 42, frameIds: [0] });
  assert.deepEqual(injections[1].target, { tabId: 42, documentIds: ['clicked-doc'] });
  assert.equal(deliveries[0][1].selectionText, 'EXACT SELECTED SOURCE');
  assert.deepEqual(deliveries[0][2], { documentId: 'clicked-doc' });
  assert.ok(!JSON.stringify(f.storage).includes('EXACT SELECTED SOURCE'));
  assert.equal(f.calls.length, 0);
  await f.broker.openSelection({ selectionText: 'SECOND SELECTION', frameId: 0 }, { id: 42, url: 'https://example.invalid/article' });
  assert.equal(deliveries[1][1].grant, deliveries[0][1].grant, 'same document keeps the grant so a retained body job remains authorized');
});

test('context selection rejects editable, child frame, oversized, unconsented and changed documents', async () => {
  const f = setup(); await f.save();
  const tab = { id: 42, url: 'https://example.invalid/article' };
  for (const info of [{ editable: true }, { frameId: 2 }, { selectionText: '' }]) {
    await assert.rejects(f.broker.openSelection({ selectionText: 'Hello', ...info }, tab), { code: 'UNSUPPORTED_SELECTION' });
  }
  await assert.rejects(f.broker.openSelection({ selectionText: 'x'.repeat(60001) }, tab), { code: 'REQUEST_TOO_LARGE' });
  const noConsent = setup({ local: {} }); await noConsent.save();
  await assert.rejects(noConsent.broker.openSelection({ selectionText: 'Hello' }, tab), { code: 'CONSENT_REQUIRED' });
  f.chrome.scripting = { executeScript: async () => [{ documentId: 'new-doc', result: 'https://example.invalid/changed' }] };
  await assert.rejects(f.broker.openSelection({ selectionText: 'Hello' }, tab), { code: 'PAGE_CHANGED' });
  await assert.rejects(f.send({ type: 'OPEN', mode: 'selection' }, { id: f.options.id, url: f.options.url.replace('options.html', 'popup.html') }), { code: 'INVALID_REQUEST' });
});

test('page results survive worker recreation and reload, remap IDs without a provider call, and expire on tab close', async () => {
  const f = setup(); await f.save();
  await f.translate('first', {}, 'page');
  assert.equal(f.calls.length, 1); assert.equal(f.storage.providerQuota.chars, 5);
  assert.ok(f.storage['pageCache:7']);
  assert.ok(!JSON.stringify(f.storage['pageCache:7']).includes(dummyKey));
  assert.ok(!JSON.stringify(f.local).includes('Hello'));
  await f.broker.forget(7);
  assert.ok(f.storage['pageCache:7']);
  const reboot = setup({ storage: f.storage, local: f.local });
  const result = await reboot.translate('reloaded', { segments: [{ id: 'different-id', text: 'Hello' }] }, 'page');
  assert.deepEqual(result.translations, [{ id: 'different-id', text: '번역' }]);
  assert.equal(reboot.calls.length, 0); assert.equal(f.storage.providerQuota.chars, 5);
  await reboot.broker.forget(7, true);
  assert.equal(f.storage['pageCache:7'], undefined); assert.equal(f.storage['grant:7'], undefined);
});

test('page cache reuses only matching segments and never caches selected text', async () => {
  const f = setup(); await f.save();
  await f.translate('selection', {}, 'selection'); assert.equal(f.storage['pageCache:7'], undefined);
  await f.translate('page', {}, 'page');
  await f.translate('mixed', { segments: [{ id: 'one', text: 'Hello' }, { id: 'two', text: 'World' }] }, 'page');
  const sent = JSON.parse(JSON.parse(f.calls.at(-1).options.body).contents[0].parts[0].text);
  assert.deepEqual(sent.segments, [{ id: 'two', text: 'World' }]);
  const before = f.calls.length;
  await f.translate('another-language', { targetLanguage: 'ja' }, 'page');
  assert.equal(f.calls.length, before + 1);
  await f.save(); await f.translate('new-settings', {}, 'page'); assert.equal(f.calls.length, before + 2);
});

test('page cache does not cross URLs, tabs or document authorization', async () => {
  const f = setup(); await f.save(); await f.translate('first', {}, 'page');
  f.content.url = 'https://example.invalid/elsewhere';
  await f.translate('elsewhere', {}, 'page'); assert.equal(f.calls.length, 2);
  f.content.tab.id = 9; f.content.documentId = 'doc-9';
  f.storage['grant:9'] = { documentId: 'doc-9', grant: 'grant-7' };
  await f.translate('other-tab', {}, 'page'); assert.equal(f.calls.length, 3);
  f.content.documentId = 'stale';
  await assert.rejects(f.translate('stale', {}, 'page'), { code: 'WORKER_INTERRUPTED' });
});

test('tab close prevents late responses from recreating saved content', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = setup({ fetchImpl: async () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  await f.save();
  const pending = assert.rejects(f.translate('late', {}, 'page'), { code: 'CANCELLED' });
  await ready; await f.broker.forget(7, true);
  finish(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ translations: [{ id: 's1', text: '늦은 결과' }] }) }] } }] }));
  await pending; assert.equal(f.storage['pageCache:7'], undefined);
});

test('cache storage failure preserves the valid translation and reports the retention limit', async () => {
  const f = setup(); await f.save();
  const set = f.chrome.storage.session.set;
  f.chrome.storage.session.set = async value => { if (value['pageCache:7']) throw Error('quota'); return set(value); };
  const result = await f.translate('quota', {}, 'page');
  assert.equal(result.translations[0].text, '번역'); assert.equal(result.cacheWarning, true);
  assert.equal(f.storage['pageCache:7'], undefined);
});

async function imageSetup(options = {}) {
  const f = setup(options); await f.save(); const sent = [];
  f.chrome.scripting = { executeScript: async () => [{ documentId: 'doc-7', result: 'https://example.invalid' }] };
  f.chrome.tabs = { sendMessage: async (_id, message) => sent.push(message) };
  await f.broker.openImage({ mediaType: 'image', srcUrl: 'https://private.invalid/picture?secret=URL_PRIVATE', frameId: 0 }, { id: 7, windowId: 3, url: 'https://example.invalid' });
  const message = sent[0], settings = await f.send({ type: 'STATUS' });
  const imageMessage = { type: 'TRANSLATE_IMAGE', grant: message.grant, imageToken: message.imageToken,
    body: { jobId: 'image-job', model: settings.model, settingsRevision: settings.settingsRevision, targetLanguage: 'ko',
      image: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8O0AAAAASUVORK5CYII=' } } };
  return { ...f, imageMessage, imageTranslate: overrides => f.send({ ...imageMessage, ...overrides }, f.content) };
}

test('image action gates pixels, charges image budget, and never persists image or URL', async () => {
  const f = await imageSetup();
  const result = await f.imageTranslate(); assert.equal(result.translation, '이미지 안녕');
  assert.equal(f.calls.length, 1); assert.equal(f.storage.providerQuota.images, 1); assert.equal(f.storage.providerQuota.chars, 0);
  assert.ok(!JSON.stringify(f.storage).includes('URL_PRIVATE')); assert.ok(!JSON.stringify(f.storage).includes(f.imageMessage.body.image.data));
  assert.equal(f.storage['pageCache:7'], undefined);
  await assert.rejects(f.imageTranslate({ imageToken: 'wrong' }), { code: 'IMAGE_ACTION_EXPIRED' });
  await f.send({ type: 'RELEASE_IMAGE', grant: f.imageMessage.grant, imageToken: f.imageMessage.imageToken }, f.content);
  await assert.rejects(f.imageTranslate(), { code: 'IMAGE_ACTION_EXPIRED' });
});

test('image translation preserves consent, settings and session image budget gates', async () => {
  const f = await imageSetup();
  delete f.local.textConsent;
  await assert.rejects(f.imageTranslate(), { code: 'CONSENT_REQUIRED' });
  f.local.textConsent = { version: '0.3.0' };
  await f.save(); await assert.rejects(f.imageTranslate(), { code: 'SETTINGS_CHANGED' });
  const full = await imageSetup({ storage: { providerQuota: { chars: 0, images: 50, attempts: [] } } });
  await assert.rejects(full.imageTranslate(), { code: 'IMAGE_SESSION_BUDGET' }); assert.equal(full.calls.length, 0);
});

test('image menu rejects frames, non-images and unconsented use before any capture', async () => {
  const f = setup(); await f.save(); const tab = { id: 7, windowId: 3, url: 'https://example.invalid' };
  for (const info of [{ frameId: 1 }, { editable: true }, { mediaType: 'video' }, { srcUrl: 'file:///private' }])
    await assert.rejects(f.broker.openImage({ mediaType: 'image', srcUrl: 'https://example.invalid/a.png', ...info }, tab), { code: 'UNSUPPORTED_IMAGE' });
  delete f.local.textConsent;
  await assert.rejects(f.broker.openImage({ mediaType: 'image', srcUrl: 'https://example.invalid/a.png' }, tab), { code: 'CONSENT_REQUIRED' });
});

test('closing an image action cancels its active provider call', async () => {
  let started; const ready = new Promise(resolve => { started = resolve; });
  const f = await imageSetup({ fetchImpl: async (_url, { signal }) => { started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })); } });
  const pending = assert.rejects(f.imageTranslate(), { code: 'CANCELLED' });
  await ready; await f.send({ type: 'RELEASE_IMAGE', grant: f.imageMessage.grant, imageToken: f.imageMessage.imageToken }, f.content); await pending;
});

test('image capture requires its action token and is throttled without persisting pixels', async () => {
  let captures = 0, time = 0;
  const pixels = { mimeType: 'image/png', data: 'DUMMY_CROPPED_PIXELS' };
  const f = await imageSetup({ now: () => time, captureImpl: async input => {
    captures++; await input.assertActive(); assert.equal(input.tabId, 7); assert.equal(input.windowId, 3); assert.equal(input.documentId, 'doc-7'); return pixels;
  } });
  const message = { type: 'CAPTURE_IMAGE', grant: f.imageMessage.grant, imageToken: f.imageMessage.imageToken };
  assert.deepEqual(await f.send(message, f.content), pixels);
  await assert.rejects(f.send(message, f.content), { code: 'IMAGE_CAPTURE_WAIT' });
  time = 1001; await f.send(message, f.content); assert.equal(captures, 2);
  await f.broker.forget(7); await assert.rejects(f.send(message, f.content), { code: 'WORKER_INTERRUPTED' });
  assert.ok(!JSON.stringify(f.storage).includes('PIXELS')); assert.equal(f.calls.length, 0);
});

test('text requests retain the separate image budget and changed models abort image requests', async () => {
  const f = await imageSetup(); await f.imageTranslate(); await f.translate('text-job');
  assert.equal(f.storage.providerQuota.images, 1); assert.equal(f.storage.providerQuota.chars, 5);
  let started; const ready = new Promise(resolve => { started = resolve; });
  const pendingFixture = await imageSetup({ fetchImpl: async (_url, { signal }) => { started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })); } });
  const pending = assert.rejects(pendingFixture.imageTranslate(), { code: 'CANCELLED' });
  await ready; await pendingFixture.send({ type: 'CLEAR_SETTINGS' }); await pending;
});


const countedResponse = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ translations: [{ id: 's1', text: '번역' }] }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, cachedContentTokenCount: 30 } });
const statsSender = f => ({ id: f.chrome.runtime.id, url: f.chrome.runtime.getURL('statistics.html') });
test('usage aggregates each translation kind, excludes cache hits and model list, and survives key deletion', async () => {
  const f = setup({ fetchImpl: async () => countedResponse() }); await f.save();
  assert.equal((await f.send({ type: 'USAGE_GET' }, statsSender(f))).rows.length, 0);
  await f.translate('page-one', {}, 'page'); await f.translate('page-cached', {}, 'page');
  await f.translate('selected', {}, 'selection');
  let snapshot = await f.send({ type: 'USAGE_GET' }, statsSender(f));
  assert.equal(snapshot.rows.length, 2); assert.equal(f.calls.length, 2); assert.ok(snapshot.rows.every(r => r.attempts === 1 && r.tokens.total === 130));
  assert.ok(!JSON.stringify(snapshot).includes(dummyKey)); assert.ok(!JSON.stringify(snapshot).includes('Hello'));
  await f.send({ type: 'CLEAR_SETTINGS' });
  snapshot = await f.send({ type: 'USAGE_GET' }, statsSender(f)); assert.equal(snapshot.rows.length, 2);
});

test('usage image early return still counts metadata and retains no pixels', async () => {
  const f = await imageSetup({ fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ recognizedText: 'Hello image', translation: '이미지 안녕', noText: false }) }] } }], usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 30, totalTokenCount: 430 } }) });
  await f.imageTranslate();
  const snapshot = await f.send({ type: 'USAGE_GET' }, statsSender(f));
  assert.equal(snapshot.rows[0].kind, 'image'); assert.equal(snapshot.rows[0].tokens.total, 430); assert.equal(snapshot.rows[0].reported, 1);
  assert.ok(!JSON.stringify(f.local.tokenUsage).includes(f.imageMessage.body.image.data));
});

test('usage APIs are restricted to exact trusted UI pages; popup can read but cannot clear', async () => {
  const f = setup(); const popup = { id: f.chrome.runtime.id, url: f.chrome.runtime.getURL('popup.html') };
  assert.deepEqual((await f.send({ type: 'USAGE_GET' }, popup)).rows, []);
  for (const sender of [f.content, f.options, { ...statsSender(f), id: 'foreign' }, { ...statsSender(f), url: f.chrome.runtime.getURL('statistics.html') + '?spoof=1' }]) {
    for (const type of ['USAGE_GET', 'USAGE_CLEAR']) await assert.rejects(f.send({ type, grant: 'grant-7' }, sender));
  }
  await assert.rejects(f.send({ type: 'USAGE_CLEAR' }, popup));
  assert.deepEqual((await f.send({ type: 'USAGE_CLEAR' }, statsSender(f))).rows, []);
});

test('late cancelled translation still counts received usage but does not restore cleared statistics', async () => {
  for (const clear of [false, true]) {
    let finish, started; const ready = new Promise(resolve => { started = resolve; });
    const f = setup({ fetchImpl: async () => { started(); return new Promise(resolve => { finish = resolve; }); } }); await f.save();
    const pending = assert.rejects(f.translate('late-usage', {}, 'page'), { code: 'CANCELLED' });
    await ready; if (clear) await f.send({ type: 'USAGE_CLEAR' }, statsSender(f));
    await f.broker.forget(7, true); finish(countedResponse()); await pending;
    const snapshot = await f.send({ type: 'USAGE_GET' }, statsSender(f));
    assert.equal(snapshot.rows.length, clear ? 0 : 1);
    if (!clear) assert.equal(snapshot.rows[0].tokens.total, 130);
  }
});

test('usage storage failures prevent unrecorded starts and preserve successful charged responses', async () => {
  const f = setup({ fetchImpl: async () => countedResponse() }); await f.save();
  const set = f.chrome.storage.local.set;
  f.chrome.storage.local.set = async value => { if (value.tokenUsage) throw Error('full'); return set(value); };
  await assert.rejects(f.translate('cannot-start'), { code: 'USAGE_STORAGE_FAILED' }); assert.equal(f.calls.length, 0);
  f.chrome.storage.local.set = async value => { if (value.tokenUsage?.rows.some(r => r.reported)) throw Error('full'); return set(value); };
  assert.equal((await f.translate('finish-fails')).translations[0].text, '번역');
  const snapshot = await f.send({ type: 'USAGE_GET' }, statsSender(f)); assert.equal(snapshot.writeWarning, true); assert.equal(snapshot.rows[0].reported, 0); assert.equal(snapshot.rows[0].attempts, 1);
});


const kieKey = 'DUMMY_KIE_ONLY_NOT_A_REAL_KEY';
function legacySetup() {
  return setup({local:{textConsent:{version:'0.3.0'},modelProfiles:{schemaVersion:1,active:'kie:test-model',revision:'old-revision',entries:{
    'kie:test-model':{provider:'kie',model:'test-model',displayName:'Legacy model',apiKey:kieKey},
    'google:test-model':{provider:'google',model:'test-model',displayName:'Google model',apiKey:dummyKey}
  }}}});
}
test('existing Kie selection stays stored but unconfigured and cannot translate or reactivate',async()=>{
  const f=legacySetup(), before=structuredClone(f.local);
  const status=await f.send({type:'STATUS'});
  assert.equal(status.provider,'kie'); assert.equal(status.configured,false); assert.equal(status.notice,'PROVIDER_DISABLED');
  assert.equal(status.profiles.length,2); assert.ok(!JSON.stringify(status).includes(kieKey));
  for(const type of ['LOAD_MODELS','SAVE_SETTINGS','ACTIVATE_MODEL']) await assert.rejects(f.send({type,provider:'kie',model:'test-model',apiKey:kieKey}),{code:'PROVIDER_DISABLED'});
  await assert.rejects(f.translate('legacy',{provider:'kie'}),{code:'PROVIDER_DISABLED'});
  assert.deepEqual(f.local,before); assert.equal(f.calls.length,0); assert.equal(f.modelCalls.length,0);
  assert.equal(f.storage.providerQuota,undefined);
});
test('legacy deletion preserves Google profile and existing usage; Google activation still translates',async()=>{
  const f=legacySetup();
  // Use the existing usage store through a Google request, then verify Kie deletion preserves it.
  await f.send({type:'ACTIVATE_MODEL',provider:'google',model:'test-model'});
  await f.translate(); const usage=structuredClone(f.local.tokenUsage);
  assert.equal(f.calls[0].options.headers['x-goog-api-key'],dummyKey);
  assert.equal(f.calls[0].options.headers.Authorization,undefined);
  await f.send({type:'DELETE_MODEL',provider:'kie',model:'test-model'});
  assert.equal((await f.send({type:'STATUS'})).configured,true);
  assert.equal(f.local.modelProfiles.entries['kie:test-model'],undefined);
  assert.equal(f.local.modelProfiles.entries['google:test-model'].apiKey,dummyKey);
  assert.deepEqual(f.local.tokenUsage,usage);
});
test('legacy active key deletion needs no provider calls and does not automatically activate Google',async()=>{
  const f=legacySetup();
  await f.send({type:'DELETE_MODEL',provider:'kie',model:'test-model'});
  assert.equal((await f.send({type:'STATUS'})).configured,false);
  assert.equal(f.local.modelProfiles.active,''); assert.equal(f.calls.length,0);
  await f.save(); assert.equal((await f.send({type:'STATUS'})).configured,true);
});
test('legacy Kie blocks image and selection menus before injection or network',async()=>{
  const f=legacySetup(),tab={id:7,windowId:3,url:'https://example.invalid'};
  await assert.rejects(f.broker.openImage({mediaType:'image',srcUrl:'https://example.invalid/a.png',frameId:0},tab),{code:'PROVIDER_DISABLED'});
  await assert.rejects(f.broker.openSelection({selectionText:'Hello',frameId:0},tab),{code:'PROVIDER_DISABLED'});
  const popup={...f.options,url:f.chrome.runtime.getURL('popup.html')};
  await assert.rejects(f.send({type:'OPEN',mode:'video'},popup),{code:'PROVIDER_DISABLED'});
  assert.equal(f.calls.length,0); assert.equal(f.modelCalls.length,0);
});

test('legacy Kie inline button opens settings without starting captions or translation',async()=>{
  const f=legacySetup(),url='https://www.youtube.com/watch?v=abcdefghijk';let opened=0;
  f.content.url=url;
  f.chrome.tabs={get:async id=>({id,url})};
  f.chrome.scripting={executeScript:async args=>{assert.equal(args.files,undefined);return [{documentId:'doc-7',result:url}];}};
  f.chrome.runtime.openOptionsPage=async()=>{opened++;};
  assert.deepEqual(await f.send({type:'OPEN_VIDEO_INLINE',videoId:'abcdefghijk'},f.content),{opened:false,needsSettings:true});
  assert.equal(opened,1);assert.equal(f.calls.length,0);assert.equal(f.modelCalls.length,0);
});

const openaiKey = 'DUMMY_OPENAI_ONLY_NOT_A_REAL_KEY';
const openaiModels = async () => Response.json({object:'list',data:[{id:'gpt-5.6-luna',object:'model'}]});
const openaiAnswer = (value = {translations:[{id:'s1',text:'직접 번역'}]}) => Response.json({status:'completed',output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:10,output_tokens:7,output_tokens_details:{reasoning_tokens:2},total_tokens:17}});
async function saveOpenAI(f) {
  const list=await f.send({type:'LOAD_MODELS',provider:'openai',apiKey:openaiKey});
  return f.send({type:'SAVE_SETTINGS',provider:'openai',apiKey:openaiKey,model:'gpt-5.6-luna',catalogId:list.catalogId});
}
test('OpenAI model keys and usage survive restart without crossing Google or legacy Kie',async()=>{
  const f=setup({modelFetch:openaiModels,fetchImpl:async()=>openaiAnswer()});
  const status=await saveOpenAI(f);assert.equal(status.provider,'openai');assert.equal(status.configured,true);
  assert.equal(f.calls.length,0);assert.equal(f.modelCalls[0].options.headers.Authorization,'Bearer '+openaiKey);
  await f.translate('openai',{provider:'openai'},'selection');
  assert.equal(f.calls[0].endpoint,'https://api.openai.com/v1/responses');assert.equal(f.calls[0].options.headers.Authorization,'Bearer '+openaiKey);
  assert.equal(f.calls[0].options.headers['x-goog-api-key'],undefined);
  const reboot=setup({local:f.local});const restored=await reboot.send({type:'STATUS'});assert.equal(restored.provider,'openai');assert.ok(!JSON.stringify(restored).includes(openaiKey));
  const snapshot=await reboot.send({type:'USAGE_GET'},statsSender(reboot));assert.equal(snapshot.rows[0].provider,'openai');assert.equal(snapshot.rows[0].tokens.total,17);assert.equal(snapshot.rows[0].tokens.output,5);
  await assert.rejects(reboot.send({type:'LOAD_MODELS',provider:'google',apiKey:'',credentialModel:'gpt-5.6-luna'}),{code:'NOT_CONFIGURED'});
  await assert.rejects(reboot.send({type:'ACTIVATE_MODEL',provider:'kie',model:'gpt-5.6-luna'}),{code:'PROVIDER_DISABLED'});
  await reboot.save();await reboot.translate();assert.equal(reboot.calls[0].options.headers['x-goog-api-key'],dummyKey);
  await reboot.send({type:'DELETE_MODEL',provider:'openai',model:'gpt-5.6-luna'});assert.equal((await reboot.send({type:'STATUS'})).provider,'google');
  assert.equal((await reboot.send({type:'USAGE_GET'},statsSender(reboot))).rows.some(r=>r.provider==='openai'),true);
});
test('OpenAI catalog rejects unsupported ids and cross-provider catalogs',async()=>{
  const f=setup({modelFetch:openaiModels});const list=await f.send({type:'LOAD_MODELS',provider:'openai',apiKey:openaiKey});
  await assert.rejects(f.send({type:'SAVE_SETTINGS',provider:'openai',apiKey:openaiKey,model:'gpt-future',catalogId:list.catalogId}),{code:'INVALID_SETTINGS'});
  await assert.rejects(f.send({type:'SAVE_SETTINGS',provider:'google',apiKey:openaiKey,model:'gpt-5.6-luna',catalogId:list.catalogId}),{code:'MODEL_LIST_CHANGED'});
  assert.equal(f.calls.length,0);
});
test('OpenAI image path uses active provider and records image usage without pixels or source URL in storage',async()=>{
  const f=await imageSetup({modelFetch:async url=>url.startsWith('https://api.openai.com/')?openaiModels():Response.json({models:[{name:'models/test-model',supportedGenerationMethods:['generateContent']}]}),
    fetchImpl:async()=>openaiAnswer({recognizedText:'Hello',translation:'안녕',noText:false})});
  const status=await saveOpenAI(f);const result=await f.imageTranslate({body:{...f.imageMessage.body,model:status.model,settingsRevision:status.settingsRevision}});
  assert.equal(result.translation,'안녕');assert.equal(f.calls[0].endpoint,'https://api.openai.com/v1/responses');
  const body=JSON.parse(f.calls[0].options.body);assert.ok(body.input[0].content[1].image_url.startsWith('data:image/png;base64,'));
  assert.equal(f.storage.providerQuota.images,1);assert.equal(f.local.tokenUsage.rows[0].provider,'openai');assert.equal(f.local.tokenUsage.rows[0].kind,'image');
  assert.ok(!JSON.stringify(f.local).includes(f.imageMessage.body.image.data));assert.ok(!JSON.stringify(f.storage).includes('URL_PRIVATE'));
});
test('switching from OpenAI cancels pending work, keeps unknown usage and cannot apply late results',async()=>{
  let started;const ready=new Promise(resolve=>{started=resolve;});
  const f=setup({modelFetch:openaiModels,fetchImpl:async(_url,{signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));}});
  await saveOpenAI(f);const pending=assert.rejects(f.translate('active',{provider:'openai'}),{code:'CANCELLED'});await ready;
  await f.send({type:'DELETE_MODEL',provider:'openai',model:'gpt-5.6-luna'});await pending;
  assert.equal(f.calls.length,1);assert.equal(f.local.tokenUsage.rows[0].reported,0);assert.equal(f.local.tokenUsage.rows[0].attempts,1);
});
