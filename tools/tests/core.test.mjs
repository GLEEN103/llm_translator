import test from 'node:test';
import assert from 'node:assert/strict';
import '../../src/extension/core.js';
import { LIMITS } from '../../src/extension/contract.mjs';
const { splitText, batches, validResult, limits } = globalThis.TranslatorCore;

const Core = globalThis.TranslatorCore;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
test('format retry allows three retries, reports each failure, and never retries other errors', async () => {
  for (const failures of [1, 3, 4]) {
    let calls = 0; const waits = [], logs = [];
    const pending = Core.formatRetry(async () => { if (++calls <= failures) throw { code: 'OPENAI_RESPONSE_JSON' }; return 'valid'; }, () => true,
      { wait: async ms => waits.push(ms), onError: row => logs.push(row) });
    if (failures === 4) await assert.rejects(pending, { code: 'OPENAI_RESPONSE_JSON' }); else assert.equal(await pending, 'valid');
    assert.equal(calls, Math.min(failures + 1, 4)); assert.deepEqual(waits, Array(Math.min(failures, 3)).fill(5000));
    assert.equal(logs.at(-1).final, failures === 4);
  }
  for (const code of ['OPENAI_INCOMPLETE', 'OPENAI_REFUSAL', 'OPENAI_REQUEST_TIMEOUT', 'PROVIDER_AUTH', 'SESSION_BUDGET']) {
    let calls = 0; await assert.rejects(Core.formatRetry(async () => { calls++; throw { code }; }, () => true), { code }); assert.equal(calls, 1);
  }
});

test('local rate waiting does not consume format retry allowance; cancellation stops pending retries', async () => {
  let calls = 0; const logs = [], waits = [];
  await assert.rejects(Core.formatRetry(async () => { calls++; throw { code: calls === 1 ? 'CLIENT_RATE_LIMIT' : 'INVALID_PROVIDER_RESPONSE' }; }, () => true,
    { wait: async ms => waits.push(ms), onError: row => logs.push(row) }), { code: 'INVALID_PROVIDER_RESPONSE' });
  assert.equal(calls, 5); assert.deepEqual(waits, [60000, 5000, 5000, 5000]); assert.equal(logs.length, 4);
  let active = true, attempts = 0;
  await assert.rejects(Core.formatRetry(async () => { attempts++; throw Error('OPENAI_RESPONSE_FORMAT'); }, () => active,
    { wait: async () => { active = false; } }), { code: 'CANCELLED' }); assert.equal(attempts, 1);
});
test('batch scheduler starts five, waits for all out-of-order replies, then rests five seconds', async () => {
  let concurrent = 0, peak = 0;
  const starts = [], finish = new Map(), waits = [];
  const pending = Core.parallelBatches(Array.from({ length: 12 }, (_, i) => i), async i => {
    starts.push(i); peak = Math.max(peak, ++concurrent);
    await new Promise(resolve => finish.set(i, resolve)); concurrent--;
  }, () => true, { wait: async ms => { waits.push(ms); assert.equal(concurrent, 0); } });
  assert.deepEqual(starts, [0, 1, 2, 3, 4]);
  for (const i of [4, 2, 1, 3]) finish.get(i)(); await flush();
  assert.equal(starts.length, 5); assert.deepEqual(waits, []);
  finish.get(0)(); await flush(); assert.equal(starts.length, 10); assert.deepEqual(waits, [5000]);
  for (let i = 5; i < 10; i++) finish.get(i)(); await flush(); assert.equal(starts.length, 12);
  finish.get(11)(); finish.get(10)(); await pending;
  assert.equal(peak, 5); assert.deepEqual(waits, [5000, 5000]); assert.equal(Core.scheduling.concurrent, LIMITS.concurrent);
});

test('cancellation during a wave or its rest never starts the next five', async () => {
  for (const duringRest of [false, true]) {
    let active = true, calls = 0; const finish = [];
    const pending = Core.parallelBatches(Array(10).fill(0), async () => {
      calls++; if (!duringRest) await new Promise(resolve => finish.push(resolve));
    }, () => active, { wait: async () => { active = false; } });
    if (!duringRest) { active = false; finish.forEach(done => done()); }
    await pending; assert.equal(calls, 5);
  }
});

test('scheduler errors settle active work and prevent later waves', async () => {
  let calls = 0, finish;
  const failed = assert.rejects(Core.parallelBatches(Array(6).fill(0), async () => {
    if (++calls === 1) throw Error('failure');
    if (calls === 5) await new Promise(resolve => { finish = resolve; });
  }, () => true), /failure/);
  await flush(); assert.equal(calls, 5); finish(); await failed; assert.equal(calls, 5);
});

test('local busy/rate rejection waits outside requests; provider failures are never retried', async () => {
  const waits = [], notices = []; let attempts = 0;
  const result = await Core.localRetry(async () => {
    attempts++; if (attempts === 1) throw { code: 'CLIENT_BUSY' };
    if (attempts === 2) throw Error('CLIENT_RATE_LIMIT'); return 'ok';
  }, () => true, { wait: async ms => waits.push(ms), onWait: code => notices.push(code) });
  assert.equal(result, 'ok'); assert.deepEqual(waits, [1000, 60000]); assert.deepEqual(notices, ['CLIENT_BUSY', 'CLIENT_RATE_LIMIT']);
  for (const code of ['OPENAI_REQUEST_TIMEOUT', 'OPENAI_NETWORK', 'WORKER_INTERRUPTED', 'PROVIDER_AUTH']) {
    let calls = 0;
    await assert.rejects(Core.localRetry(async () => { calls++; throw { code }; }, () => true), { code });
    assert.equal(calls, 1);
  }
});

test('OFF during local rate waiting cancels promptly without another message', async () => {
  let active = true, calls = 0, elapsed = 0;
  await assert.rejects(Core.localRetry(async () => { calls++; throw { code: 'CLIENT_RATE_LIMIT' }; }, () => active, {
    wait: (ms, valid) => Core.waitActive(ms, valid, async slice => { elapsed += slice; active = false; })
  }), { code: 'CANCELLED' });
  assert.equal(calls, 1); assert.equal(elapsed, 250);
});
test('message deadlines allow Kie translation 190 seconds but retain other message limits', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [message, duration] of [[{ type: 'TRANSLATE', body: { provider: 'kie' } }, 190000],
    [{ type: 'TRANSLATE', body: { provider: 'openai' } }, 200000],
    [{ type: 'TRANSLATE', body: { provider: 'google' } }, 29000], [{ type: 'VIDEO_CAPTIONS' }, 40000], [{ type: 'CONTENT_STATUS' }, 29000]]) {
    let done = false;
    const pending = assert.rejects(globalThis.TranslatorCore.requestMessage({ sendMessage: () => new Promise(() => {}) }, message), { code: 'WORKER_INTERRUPTED' }).then(() => { done = true; });
    await Promise.resolve(); t.mock.timers.tick(duration - 1); await Promise.resolve(); assert.equal(done, false);
    t.mock.timers.tick(1); await pending;
  }
});
test('split preserves exact text, whitespace and surrogate pairs', () => {
  const source = ('Hello world.\n日本語 한국어 😀 ').repeat(1000);
  const parts = splitText(source);
  assert.equal(parts.join(''), source);
  for (const part of parts) { assert.ok(part.length <= limits.segmentChars); assert.ok(!/[\uD800-\uDBFF]$/.test(part)); }
  assert.deepEqual(splitText(''), []);
  assert.equal(splitText('x'.repeat(2399) + '😀abc').join(''), 'x'.repeat(2399) + '😀abc');
});
test('batch limits are satisfied without missing segments', () => {
  const segments = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, text: 'x'.repeat(i % 2 ? 2300 : 10) }));
  const grouped = batches(segments);
  assert.deepEqual(grouped.flat(), segments);
  for (const batch of grouped) { assert.ok(batch.length <= LIMITS.segments); assert.ok(batch.reduce((sum, item) => sum + item.text.length, 0) <= LIMITS.requestChars); }
});

test('forty short elements share one request and 65 elements require only two', () => {
  const segments = Array.from({ length: 65 }, (_, i) => ({ id: `s${i}`, text: `Short sentence ${i}.` }));
  assert.equal(batches(segments.slice(0, 40)).length, 1);
  assert.deepEqual(batches(segments).map(batch => batch.length), [64, 1]);
  assert.equal(limits.segments, LIMITS.segments); assert.equal(limits.requestChars, LIMITS.requestChars);
  assert.equal(batches(Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, text: 'x'.repeat(2400) }))).length, 2);
});
test('late job responses, duplicate IDs and invalid translations are rejected', () => {
  const segments = [{ id: 's1', text: 'Hello' }, { id: 's2', text: 'World' }];
  const valid = { jobId: 'new', translations: [{ id: 's2', text: '세계' }, { id: 's1', text: '안녕' }] };
  assert.equal(validResult(valid, 'new', segments), true);
  assert.equal(validResult(valid, 'old', segments), false);
  assert.equal(validResult({ ...valid, translations: [valid.translations[0], valid.translations[0]] }, 'new', segments), false);
  assert.equal(validResult({ ...valid, translations: [{ id: 's1', text: '' }] }, 'new', segments), false);
});
