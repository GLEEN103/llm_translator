import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/extension/core.js';
import '../../src/extension/video-core.js';
import '../../src/extension/video-session.js';
import '../../src/extension/video-style.js';
import { createKieProvider } from '../../src/extension/kie.mjs';
const V = globalThis.TranslatorVideoCore, Session = globalThis.TranslatorVideoSession, Style = globalThis.TranslatorVideoStyle;
const cue = (start, text, end = start + 2) => ({ id: 'reused-id', start, end, text });
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function setup({ read, translate, status } = {}) {
  let time = 0, serial = 0, ctx = { time: 0, suspended: false }, settings = { configured: true, consentAccepted: true, model: 'dummy', settingsRevision: 'r1' };
  const timers = new Map(), calls = [], reads = [], cancelled = [], changes = [];
  const session = Session.create({ now: () => time, setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { at: time + ms, fn }); return id; }, clearTimer: id => timers.delete(id), uuid: () => `job-${++serial}`,
    context: () => ctx, status: async () => status ? status(settings) : settings, read: async () => { reads.push(time); return read ? read(reads.length) : { cues: [cue(0, 'A')] }; },
    translate: async (segments, _settings, jobId) => { calls.push({ segments, time }); return translate ? translate(segments, jobId, calls.length) : { jobId, translations: segments.map(s => ({ id: s.id, text: `T:${s.text}` })) }; },
    cancel: id => cancelled.push(id), change: data => changes.push(data)
  });
  async function advance(ms) {
    const end = time + ms; await flush();
    let count = 0;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; if (++count > 1000) throw Error('runaway timer');
      time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    time = end; await flush();
  }
  return { session, calls, reads, cancelled, changes, timers, advance, ctx, settings };
}
test('ON automatically collects later chunks and translates only new text across reused IDs', async () => {
  const f = setup({ read: async n => ({ cues: n === 1 ? [cue(0, 'A')] : [cue(10, 'B'), cue(12, 'A')] }) });
  f.session.start(); await f.advance(0); assert.equal(f.calls.length, 1);
  await f.advance(10000); assert.equal(f.reads.length, 2); assert.deepEqual(f.calls[1].segments.map(s => s.text), ['B']);
  assert.equal(f.session.snapshot().cues.length, 3); assert.equal(f.session.snapshot().enabled, true);
  await f.advance(30000); assert.equal(f.calls.length, 2); assert.ok(f.reads.every((t, i) => !i || t - f.reads[i - 1] >= 10000)); f.session.dispose();
});

const manyCues = () => Array.from({ length: 400 }, (_, i) => cue(i * 2, `phrase-${i}`));
const translated = (segments, jobId) => ({ jobId, translations: [...segments].reverse().map(s => ({ id: s.id, text: `T:${s.text}` })) });
test('captions send five unique batches, apply reversed replies immediately, and rest before the next wave', async () => {
  const finish = [], jobs = new Set();
  const f = setup({ read: () => ({ cues: manyCues() }), translate: (segments, jobId) => {
    jobs.add(jobId); return new Promise(resolve => finish.push(() => resolve(translated(segments, jobId))));
  } });
  f.ctx.time = 500; f.session.start(); await f.advance(0);
  assert.equal(f.calls.length, 5); assert.equal(jobs.size, 5);
  assert.equal(f.calls[0].segments[0].text, 'phrase-250');
  assert.equal(new Set(f.calls.flatMap(c => c.segments.map(s => s.id))).size, 320);
  finish[4](); await flush(); assert.equal(f.session.snapshot().results.size, 64);
  for (const i of [2, 0, 3, 1]) finish[i](); await flush();
  assert.equal(f.session.snapshot().results.size, 320);
  for (const segment of f.session.snapshot().segments) if (f.session.snapshot().results.has(segment.id)) {
    assert.equal(f.session.snapshot().results.get(segment.id), `T:${segment.text}`);
  }
  await f.advance(4999); assert.equal(f.calls.length, 5);
  await f.advance(1); assert.equal(f.calls.length, 7);
  finish[6](); finish[5](); await flush(); assert.equal(f.session.snapshot().results.size, 400);
  await f.advance(10000); assert.equal(f.calls.length, 7); f.session.dispose();
});

test('OFF cancels all five caption requests and ignores every late reply', async () => {
  const finish = [];
  const f = setup({ read: () => ({ cues: manyCues() }), translate: (segments, jobId) => new Promise(resolve => finish.push(() => resolve(translated(segments, jobId)))) });
  f.session.start(); await f.advance(0); f.session.stop();
  assert.equal(new Set(f.cancelled).size, 5);
  finish.reverse().forEach(done => done()); await f.advance(60000);
  assert.equal(f.session.snapshot().results.size, 0); assert.equal(f.calls.length, 5); assert.equal(f.timers.size, 0);
});

test('a fatal concurrent caption failure cancels siblings and prevents later waves', async () => {
  const finish = [], reject = [];
  const f = setup({ read: () => ({ cues: manyCues() }), translate: (segments, jobId) => new Promise((resolve, fail) => {
    finish.push(() => resolve(translated(segments, jobId))); reject.push(fail);
  }) });
  f.session.start(); await f.advance(0); finish[0](); await flush();
  reject[1]({ code: 'OPENAI_REQUEST_TIMEOUT' }); await flush();
  assert.equal(f.session.snapshot().enabled, false); assert.equal(f.session.snapshot().error, 'OPENAI_REQUEST_TIMEOUT');
  assert.ok(f.cancelled.length >= 4); for (const i of [2, 3, 4]) finish[i](); await f.advance(60000);
  assert.equal(f.session.snapshot().results.size, 64); assert.equal(f.calls.length, 5); f.session.dispose();
});

test('a local limit on one caption batch retains siblings and retries only missing text', async () => {
  const f = setup({ read: () => ({ cues: manyCues().slice(0, 320) }), translate: (segments, jobId, n) => {
    if (n === 2) throw { code: 'CLIENT_RATE_LIMIT' }; return translated(segments, jobId);
  } });
  f.session.start(); await f.advance(0); assert.equal(f.calls.length, 5); assert.equal(f.session.snapshot().results.size, 256);
  await f.advance(59999); assert.equal(f.calls.length, 5);
  await f.advance(1); assert.equal(f.calls.length, 6); assert.equal(f.session.snapshot().results.size, 320);
  assert.deepEqual(f.calls[5].segments, f.calls[1].segments); f.session.dispose();
});

test('player loss while awaiting status prevents new caption reads until recovery', async () => {
  let finish;
  const f = setup({ status: settings => new Promise(resolve => { finish = () => resolve(settings); }) });
  f.session.start(); await f.advance(0); f.ctx.suspended = true; finish(); await flush();
  assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.session.snapshot().enabled, true);
  f.ctx.suspended = false; f.session.wake(); await f.advance(0); finish(); await flush();
  assert.equal(f.reads.length, 1); assert.equal(f.calls.length, 1); f.session.dispose();
});
test('updated text at the same timestamp invalidates only its old translation', async () => {
  const f = setup({ read: async n => ({ cues: [cue(0, n === 1 ? 'draft' : 'corrected', n === 1 ? 2 : 3)] }) });
  f.session.start(); await f.advance(10000);
  assert.equal(f.calls.length, 2); const state = f.session.snapshot(); assert.equal(state.cues.length, 1); assert.equal(state.cues[0].end, 3);
  assert.equal(state.results.get(state.cues[0].parts[0]), 'T:corrected'); f.session.dispose();
});

test('transient caption bridge failure recovers on the same ON session without refresh', async () => {
  const f = setup({ read: n => { if (n === 1) throw { code: 'CAPTIONS_BRIDGE_FAILED' }; return { cues: [cue(0, 'ready')] }; } });
  f.session.start(); await f.advance(0); assert.equal(f.session.snapshot().enabled, true); assert.equal(f.calls.length, 0);
  await f.advance(10000); assert.equal(f.calls.length, 1); assert.equal(f.session.snapshot().enabled, true); f.session.dispose();
});
test('OFF cancels translation, drops late output and never polls while disabled', async () => {
  let finish;
  const f = setup({ translate: (segments, jobId) => new Promise(resolve => { finish = () => resolve({ jobId, translations: segments.map(s => ({ id: s.id, text: 'late' })) }); }) });
  f.session.start(); await f.advance(0); f.session.stop(); assert.equal(f.cancelled.length, 1);
  finish(); await f.advance(30000); assert.equal(f.session.snapshot().results.size, 0); assert.equal(f.reads.length, 1); assert.equal(f.timers.size, 0);
});
test('OFF/ON during an active read waits for it to finish without overlapping work', async () => {
  let finish;
  const f = setup({ read: n => n === 1 ? new Promise(resolve => { finish = () => resolve({ cues: [cue(0, 'old')] }); }) : { cues: [cue(5, 'new')] } });
  f.session.start(); await f.advance(0); f.session.stop(); f.session.start(); await f.advance(10000); assert.equal(f.reads.length, 1);
  finish(); await f.advance(0); assert.equal(f.reads.length, 2); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].segments[0].text, 'new'); f.session.dispose();
});
test('temporary read failures back off and recover automatically; cached captions can still translate', async () => {
  const f = setup({ read: n => { if (n < 3) throw { code: 'CAPTIONS_PLAYER_TIMEOUT' }; return { cues: [cue(0, 'recovered')] }; } });
  f.session.start(); await f.advance(20000); assert.equal(f.calls.length, 1); assert.equal(f.session.snapshot().enabled, true); f.session.dispose();
});
test('provider quota waits a minute, while auth and model revision failures turn OFF', async () => {
  const f = setup({ translate: async (segments, jobId, n) => { if (n === 1) throw { code: 'CLIENT_RATE_LIMIT' }; return { jobId, translations: segments.map(s => ({ id: s.id, text: 'ok' })) }; } });
  f.session.start(); await f.advance(59999); assert.equal(f.calls.length, 1); await f.advance(1); assert.equal(f.calls.length, 2);
  f.settings.settingsRevision = 'r2'; await f.advance(5000); assert.equal(f.session.snapshot().enabled, false); assert.equal(f.session.snapshot().error, 'SETTINGS_CHANGED');
  const g = setup({ translate: async () => { throw { code: 'PROVIDER_AUTH' }; } }); g.session.start(); await g.advance(0); assert.equal(g.session.snapshot().enabled, false); assert.equal(g.timers.size, 0);
});

test('Kie fenced subtitle batch applies by ID; invalid batch turns OFF with a visible safe diagnostic and no retries', async () => {
  for (const bad of [false, true]) {
    let apiCalls = 0;
    const provider = createKieProvider({ apiKey: 'DUMMY', model: 'gemini-3-8-flash-openai', fetchImpl: async (_url, options) => {
      apiCalls++;
      const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content[0].text);
      assert.equal(body.response_format.json_schema.strict, true);
      assert.deepEqual(body.response_format.json_schema.schema.properties.translations.items.properties.id.enum, input.segments.map(s => s.id));
      const result = { translations: input.segments.map(s => ({ id: bad ? 'wrong' : s.id, text: `T:${s.text}` })) };
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: `\`\`\`json\n${JSON.stringify(result)}\n\`\`\`` } }] });
    } });
    const f = setup({ translate: (segments, jobId) => provider({ jobId, segments, sourceLanguage: 'en', targetLanguage: 'ko', chars: segments.reduce((n, s) => n + s.text.length, 0) }) });
    f.session.start(); await f.advance(0); await new Promise(resolve => setTimeout(resolve, 0)); await f.advance(60000);
    assert.equal(apiCalls, 1);
    const snapshot = f.session.snapshot();
    if (bad) {
      assert.equal(snapshot.enabled, false); assert.equal(snapshot.error, 'KIE_TRANSLATION_IDS'); assert.equal(snapshot.results.size, 0); assert.equal(f.timers.size, 0);
      assert.ok(globalThis.TranslatorCore.errorMessage(snapshot.error).includes('(KIE_TRANSLATION_IDS)'));
    } else {
      assert.equal(snapshot.enabled, true); assert.equal(snapshot.results.get(snapshot.cues[0].parts[0]), 'T:A');
    }
    f.session.dispose();
  }
});

test('non-format OpenAI errors stop subtitle ON without an automatic retry', async () => {
  for (const code of ['OPENAI_REQUEST_TIMEOUT','OPENAI_NETWORK','OPENAI_UNAVAILABLE','OPENAI_RATE_LIMIT','OPENAI_INCOMPLETE','OPENAI_REFUSAL','OPENAI_TRANSPORT_START_FAILED','OPENAI_TRANSPORT_START_TIMEOUT','OPENAI_TRANSPORT_DISCONNECTED','OPENAI_WORKER_START_FAILED']) {
    const f=setup({translate:async()=>{throw {code};}});f.session.start();await f.advance(60000);
    assert.equal(f.calls.length,1);assert.equal(f.session.snapshot().enabled,false);assert.equal(f.session.snapshot().error,code);
    assert.ok(globalThis.TranslatorCore.errorMessage(code).includes(code));f.session.dispose();
  }
});

test('format failures get three retries, remain ON, skip only failed text and keep translating new cues', async () => {
  const attempts = new Map(); let good = false;
  const f = setup({ read: n => ({ cues: n === 1 ? manyCues().slice(0, 128) : [cue(300, 'new phrase')] }), translate: (segments, jobId) => {
    const key = segments[0].text; attempts.set(key, (attempts.get(key) ?? 0) + 1);
    if (!good && key === 'phrase-0') throw { code: 'OPENAI_RESPONSE_JSON', detail: 'PRIVATE_RAW_DATA' };
    return translated(segments, jobId);
  } });
  f.session.start(); await f.advance(14999); assert.equal(attempts.get('phrase-0'), 3);
  await f.advance(1); assert.equal(attempts.get('phrase-0'), 4);
  assert.equal(f.session.snapshot().enabled, true); assert.equal(f.session.snapshot().failed.size, 64);
  assert.equal(f.session.snapshot().results.size, 64); assert.equal(f.session.snapshot().logs.length, 4);
  assert.equal(f.session.snapshot().logs.at(-1).final, true); assert.ok(!JSON.stringify(f.session.snapshot().logs).includes('PRIVATE_RAW'));
  await f.advance(60000); assert.equal(attempts.get('phrase-0'), 4); assert.equal(attempts.get('new phrase'), 1);
  f.session.stop(); f.session.start(); await f.advance(10000); assert.equal(attempts.get('phrase-0'), 4);
  good = true; f.session.retryFailed(); await f.advance(0); assert.equal(attempts.get('phrase-0'), 5); assert.equal(f.session.snapshot().failed.size, 0); f.session.dispose();
});

test('valid response on last retry clears failure and OFF during retry wait sends no further request', async () => {
  const f = setup({ translate: (segments, jobId, n) => { if (n < 4) return { jobId, translations: [] }; return translated(segments, jobId); } });
  f.session.start(); await f.advance(15000); assert.equal(f.calls.length, 4); assert.equal(f.session.snapshot().results.size, 1); assert.equal(f.session.snapshot().failed.size, 0); f.session.dispose();
  const g = setup({ translate: () => { throw { code: 'INVALID_PROVIDER_RESPONSE' }; } });
  g.session.start(); await g.advance(0); g.session.stop(); await g.advance(60000); assert.equal(g.calls.length, 1); assert.equal(g.timers.size, 0); g.session.dispose();
});

test('Kie disabled state and diagnostics stop continuous subtitles with actionable UI messages', async () => {
  for (const code of ['PROVIDER_DISABLED', 'KIE_RESPONSE_JSON', 'KIE_RESPONSE_ENVELOPE', 'KIE_TRANSLATION_EMPTY', 'KIE_TRANSLATION_TEXT', 'KIE_TRANSLATION_JSON', 'KIE_TRANSLATION_SCHEMA', 'KIE_TRANSLATION_IDS', 'KIE_UPSTREAM_524', 'KIE_REQUEST_TIMEOUT', 'KIE_TRANSPORT_START_TIMEOUT', 'KIE_TRANSPORT_START_FAILED', 'KIE_TRANSPORT_DISCONNECTED', 'KIE_WORKER_START_FAILED']) {
    const f = setup({ translate: async () => { throw { code }; } });
    f.session.start(); await f.advance(60000);
    assert.equal(f.calls.length, 1); assert.equal(f.session.snapshot().enabled, false); assert.equal(f.session.snapshot().error, code);
    if (code === 'PROVIDER_DISABLED') assert.match(globalThis.TranslatorCore.errorMessage(code), /사용이 중지.*Google AI Studio/);
    else assert.ok(globalThis.TranslatorCore.errorMessage(code).includes(`(${code})`));
    f.session.dispose();
  }
});

test('Kie HTTP 500/524 stop subtitle ON without a scheduled repeat or applying a failed result', async () => {
  for (const [status, code] of [[500, 'KIE_HTTP_500'], [524, 'KIE_UPSTREAM_524']]) {
  let apiCalls = 0;
  const provider = createKieProvider({ apiKey: 'DUMMY', model: 'gemini-3-8-flash-openai', fetchImpl: async () => {
    apiCalls++; return Response.json({ error: { message: 'PRIVATE_DETAIL' } }, { status });
  } });
  const f = setup({ translate: (segments, jobId) => provider({ jobId, segments, sourceLanguage: 'en', targetLanguage: 'ko', chars: segments.reduce((n, s) => n + s.text.length, 0) }) });
  f.session.start(); await f.advance(0); await new Promise(resolve => setTimeout(resolve, 0)); await f.advance(60000);
  assert.equal(apiCalls, 1); assert.equal(f.session.snapshot().enabled, false); assert.equal(f.session.snapshot().error, code);
  assert.equal(f.session.snapshot().results.size, 0); assert.equal(f.timers.size, 0);
  assert.ok(globalThis.TranslatorCore.errorMessage(code).includes(`(${code})`)); f.session.dispose();
  }
});
test('hidden/ad suspension and resume preserve ON; explicit OFF/ON reuses translations', async () => {
  const f = setup(); f.ctx.suspended = true; f.session.start(); await f.advance(20000); assert.equal(f.reads.length, 0);
  f.ctx.suspended = false; f.session.wake(); await f.advance(0); assert.equal(f.calls.length, 1);
  f.session.stop(); await f.advance(30000); f.session.start(); await f.advance(0); assert.equal(f.calls.length, 1); assert.equal(f.reads.length, 2); f.session.dispose();
});
test('caption merging enforces total limits and keeps distinct simultaneous cues', () => {
  assert.equal(V.merge([cue(0, 'old')], [cue(0, 'new'), cue(0, 'second')]).length, 2);
  assert.throws(() => V.merge([cue(0, 'x'.repeat(60000))], [cue(3, 'y'.repeat(60000))]), { code: 'CAPTIONS_TOO_LARGE' });
  assert.throws(() => V.merge([], [cue(0, 'bad', -1)]), { code: 'CAPTIONS_INVALID' });
});
test('style settings accept bounded local options and reject CSS, URLs, extra keys and non-numeric values', () => {
  assert.equal(Style.valid(Style.defaults), true);
  for (const patch of [{ font: 'url(https://evil.invalid)' }, { size: 1000 }, { size: '28' }, { vertical: -1 }, { align: 'x' }, { backgroundOpacity: NaN }, { key: 'secret' }]) assert.equal(Style.valid({ ...Style.defaults, ...patch }), false);
  const container = { style: {} }, text = { style: {} }; Style.apply(container, text, { ...Style.defaults, backgroundOpacity: 35, textOpacity: 60, size: 40, vertical: 20, align: 'left', font: 'mono' });
  assert.equal(text.style.backgroundColor, 'rgba(0, 0, 0, 0.35)'); assert.equal(text.style.color, 'rgba(255, 255, 255, 0.6)'); assert.equal(container.style.top, '20%'); assert.equal(container.style.fontSize, '40px');
  assert.deepEqual(Style.normalize({ font: 'remote' }), Style.defaults);
});
