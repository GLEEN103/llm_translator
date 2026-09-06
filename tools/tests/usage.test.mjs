import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageStore, numericUsage, summarizeUsage, groupUsage, localDate, daysBefore, filterUsage, USAGE_LIMITS } from '../../src/extension/usage.mjs';
import { tokenText, compactTokens, exactTokenText } from '../../src/extension/usage-ui.mjs';
const metadata = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, cachedContentTokenCount: 30 };
const context = { provider: 'google', model: 'test-model', kind: 'page' };
function fixture() {
  const memory = {}; let time = new Date(2026, 8, 6, 23, 59).getTime(), ids = 0;
  const local = { get: async key => structuredClone({ [key]: memory[key] }), set: async value => { Object.assign(memory, structuredClone(value)); } };
  const options = { now: () => time, uuid: () => `attempt-${++ids}` };
  return { memory, local, options, store: createUsageStore(local, options), tick: ms => { time += ms; } };
}
test('numeric usage whitelists safe counts and preserves missing versus reported zero', () => {
  assert.deepEqual(numericUsage({ ...metadata, candidatesTokenCount: -1, thoughtsTokenCount: 0, totalTokenCount: NaN, cachedContentTokenCount: '30', private: 'SECRET' }), { promptTokenCount: 100, thoughtsTokenCount: 0 });
  assert.deepEqual(numericUsage({ totalTokenCount: Number.MAX_SAFE_INTEGER + 1 }), {});
  assert.equal(localDate(new Date(2026, 0, 1, 0, 0).getTime()), '2026-01-01');
  assert.equal(daysBefore('2026-01-01', 1), '2025-12-31');
  assert.equal(daysBefore('2024-03-01', 1), '2024-02-29');
});
test('concurrent attempts persist once each, aggregate known fields, and omit all sensitive extras', async () => {
  const f = fixture();
  const ids = await Promise.all(Array.from({ length: 32 }, () => f.store.begin({ ...context, apiKey: 'SECRET_KEY', text: 'PRIVATE_TEXT', url: 'PRIVATE_URL' })));
  await Promise.all(ids.map(id => f.store.finish(id, { ...metadata, private: 'PRIVATE_RESPONSE' })));
  await f.store.finish(ids[0], metadata);
  const snapshot = await f.store.snapshot(), sum = summarizeUsage(snapshot.rows);
  assert.equal(sum.attempts, 32); assert.equal(sum.reported, 32); assert.equal(sum.tokens.total, 4160); assert.equal(sum.tokens.input, 3200); assert.equal(sum.tokens.cached, 960);
  assert.equal(snapshot.pending, undefined); assert.equal(f.memory.tokenUsage.pending.length, 0);
  assert.ok(!/PRIVATE|SECRET|attempt-/.test(JSON.stringify(snapshot)));
  assert.ok(!/PRIVATE|SECRET/.test(JSON.stringify(f.memory.tokenUsage)));
});
test('request date is frozen across midnight; restart retains history and interrupted attempts remain unknown', async () => {
  const f = fixture(), id = await f.store.begin(context);
  f.tick(120000); await f.store.finish(id, metadata);
  await f.store.begin({ ...context, kind: 'video' });
  const restored = createUsageStore(f.local, f.options), snapshot = await restored.snapshot();
  assert.equal(snapshot.today, '2026-09-07');
  assert.equal(snapshot.rows.find(r => r.kind === 'page').date, '2026-09-06');
  const today = summarizeUsage(filterUsage(snapshot.rows, { today: snapshot.today, days: 1 }));
  assert.equal(today.attempts, 1); assert.equal(today.unknown, 1); assert.equal(tokenText(today, 'input'), '—');
  assert.equal(summarizeUsage(filterUsage(snapshot.rows, { today: snapshot.today, days: 7, model: 'test-model', kind: 'page' })).tokens.total, 130);
});
test('partial metadata does not become confirmed zero and cached tokens do not inflate total', async () => {
  const f = fixture();
  await f.store.finish(await f.store.begin(context), metadata);
  await f.store.finish(await f.store.begin(context), { promptTokenCount: 0 });
  await f.store.finish(await f.store.begin(context), undefined);
  const sum = summarizeUsage((await f.store.snapshot()).rows);
  assert.equal(sum.unknown, 2); assert.equal(sum.tokens.total, 130); assert.equal(sum.known.input, 2); assert.equal(sum.known.output, 1);
  assert.equal(tokenText(sum, 'input'), '100*'); assert.equal(tokenText(summarizeUsage([]), 'input'), '0');
});
test('clear while requests are in flight prevents late resurrection while new requests still count', async () => {
  const f = fixture(), old = await f.store.begin(context);
  await f.store.clear(); const next = await f.store.begin(context);
  await Promise.all([f.store.finish(old, metadata), f.store.finish(next, metadata)]);
  const sum = summarizeUsage((await f.store.snapshot()).rows);
  assert.equal(sum.attempts, 1); assert.equal(sum.tokens.total, 130);
  await f.store.clear(); assert.deepEqual((await f.store.snapshot()).rows, []);
});
test('start storage failure is explicit; finish storage failure preserves unknown and warns', async () => {
  const f = fixture(), set = f.local.set;
  f.local.set = async () => { throw Error('full'); };
  await assert.rejects(f.store.begin(context), { code: 'USAGE_STORAGE_FAILED' });
  f.local.set = set; const id = await f.store.begin(context);
  f.local.set = async () => { throw Error('full'); }; await f.store.finish(id, metadata);
  f.local.set = set;
  const snapshot = await f.store.snapshot();
  assert.equal(snapshot.writeWarning, true); assert.equal(summarizeUsage(snapshot.rows).unknown, 1);
});
test('retention expires older dates and bounds pending IDs and aggregate rows', async () => {
  const f = fixture(); const id = await f.store.begin(context); await f.store.finish(id, metadata);
  f.tick(366 * 86400000); assert.deepEqual((await f.store.snapshot()).rows, []); assert.deepEqual(f.memory.tokenUsage.rows, []);
  for (let i = 0; i < 130; i++) await f.store.begin(context);
  assert.equal(f.memory.tokenUsage.pending.length, 128); assert.equal(summarizeUsage((await f.store.snapshot()).rows).unknown, 130);
  const row = f.memory.tokenUsage.rows[0];
  f.memory.tokenUsage.rows = Array.from({ length: USAGE_LIMITS.rows + 5 }, (_, i) => ({ ...structuredClone(row), model: `model-${i}` }));
  assert.equal((await f.store.snapshot()).rows.length, USAGE_LIMITS.rows);
});


test('compact tokens round unit boundaries without changing stored totals or unknown indicators', async () => {
  for (const [value, expected] of [[0,'0'],[999,'999'],[1000,'1K'],[10000,'10K'],[3400000,'3.4M'],[999949,'999.9K'],[999950,'1M'],[1000000000,'1B'],[1000000000000,'1T']]) assert.equal(compactTokens(value), expected);
  const f = fixture(); await f.store.finish(await f.store.begin(context), { promptTokenCount: 3400123 });
  const summary = summarizeUsage((await f.store.snapshot()).rows);
  assert.equal(tokenText(summary,'input'),'3.4M'); assert.equal(exactTokenText(summary,'input'),'3,400,123 토큰'); assert.equal(summary.tokens.input,3400123);
});
test('usage keeps the same model id separate across providers and filters by provider', async () => {
  const f = fixture(); for (const provider of ['google','kie']) await f.store.finish(await f.store.begin({ ...context, provider }), metadata);
  const snapshot = await f.store.snapshot(); assert.equal(snapshot.rows.length,2);
  assert.equal(summarizeUsage(filterUsage(snapshot.rows,{today:snapshot.today,provider:'kie'})).tokens.total,130);
});


test('model table merges all dates/functions and never merges two providers with the same model name', async () => {
  const f=fixture();await f.store.finish(await f.store.begin(context),metadata);f.tick(120000);
  await f.store.finish(await f.store.begin({...context,kind:'selection'}),metadata);
  await f.store.finish(await f.store.begin({...context,provider:'kie'}),metadata);
  const rows=(await f.store.snapshot()).rows, models=groupUsage(rows,'model');
  assert.equal(models.length,2);assert.equal(models.find(m=>m.name==='google:test-model').tokens.total,260);
  assert.equal(models.find(m=>m.name==='kie:test-model').tokens.total,130);assert.equal(groupUsage(rows,'date').length,2);
});
