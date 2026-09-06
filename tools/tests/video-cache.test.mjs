import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoCache, VIDEO_CACHE_LIMITS } from '../../src/extension/video-cache.mjs';
const videoId = 'abcdefghijk';
const request = (text = 'original', patch = {}) => ({ provider: 'google', model: 'test-model', sourceLanguage: 'auto', targetLanguage: 'ko', settingsRevision: 'r1', segments: [{ id: 's1', text }], ...patch });
function fixture(memory = {}) {
  const area = { get: async key => structuredClone({ [key]: memory[key] }), set: async value => Object.assign(memory, structuredClone(value)), remove: async key => { delete memory[key]; } };
  return { area, memory, cache: createVideoCache(area) };
}
async function save(cache, id = videoId, req = request(), text = '번역') {
  const ticket = await cache.get(id, req); return cache.put(id, ticket, req.segments, req.segments.map(s => ({ id: s.id, text })));
}
test('video translations survive recreation, match exact source/model/language and ignore key revisions', async () => {
  const f = fixture(); await save(f.cache);
  const cache = createVideoCache(f.area);
  assert.equal((await cache.get(videoId, request('original', { settingsRevision: 'r2' }))).entries.get('original'), '번역');
  for (const patch of [{ provider: 'openai' }, { model: 'other' }, { targetLanguage: 'ja' }, { sourceLanguage: 'en' }]) assert.equal((await cache.get(videoId, request('original', patch))).entries.size, 0);
  assert.equal((await cache.get(videoId, request('changed'))).entries.size, 0); assert.equal((await cache.get('other_video', request())).entries.size, 0);
  const stored = JSON.stringify(f.memory); assert.ok(!stored.includes('original')); assert.ok(!stored.includes('settingsRevision')); assert.ok(stored.includes('번역'));
});
test('exact UTF16 source hashing does not merge replacement characters with lone surrogates', async () => {
  const f = fixture(); await save(f.cache, videoId, request('\ud800'));
  assert.equal((await f.cache.get(videoId, request('\ufffd'))).entries.size, 0);
});
test('LRU retains 30 distinct videos; variants share one video slot and access updates recency', async () => {
  const f = fixture(), id = i => String(i).padStart(11, '0');
  for (let i = 0; i < 30; i++) await save(f.cache, id(i));
  await f.cache.get(id(0), request()); await save(f.cache, id(0), request('original', { targetLanguage: 'ja' }));
  await save(f.cache, id(30)); assert.equal((await f.cache.summary()).videos, 30);
  assert.equal((await f.cache.get(id(1), request())).entries.size, 0); assert.equal((await f.cache.get(id(0), request())).entries.size, 1);
});
test('concurrent batch completions merge, cache clear invalidates old tickets and new writes still work', async () => {
  const f = fixture(); await Promise.all(Array.from({ length: 5 }, (_, i) => save(f.cache, videoId, request(`part-${i}`))));
  for (let i = 0; i < 5; i++) assert.equal((await f.cache.get(videoId, request(`part-${i}`))).entries.size, 1);
  const ticket = await f.cache.get(videoId, request()); await f.cache.clear();
  await f.cache.put(videoId, ticket, request().segments, [{ id: 's1', text: 'late' }]); assert.equal((await f.cache.summary()).videos, 0);
  await save(f.cache); assert.equal((await f.cache.summary()).videos, 1);
});
test('byte cap limits a large video and storage errors return warnings without losing current results', async () => {
  const f = fixture(); let trimmed = false;
  for (let i = 0; i < 40; i++) trimmed = (await save(f.cache, videoId, request(`part-${i}`), '한'.repeat(40000))) || trimmed;
  assert.ok(trimmed); assert.ok((await f.cache.summary()).bytes <= VIDEO_CACHE_LIMITS.bytes);
  f.area.set = async () => { throw Error('quota'); };
  assert.equal(await save(f.cache, videoId, request('new')), true); assert.equal((await f.cache.get(videoId, request('new'))).entries.get('new'), '번역');
  assert.equal((await f.cache.summary()).warning, true);
});
test('malformed local cache and failed storage reads never expose arbitrary content', async () => {
  const f = fixture({ videoTranslationCache: { version: 1, videos: [{ id: videoId, entries: [['not-hash', 'PRIVATE']] }] } });
  assert.equal((await f.cache.get(videoId, request())).entries.size, 0); assert.equal((await f.cache.summary()).warning, true);
  const bad = fixture(); bad.area.get = async () => { throw Error('unavailable'); };
  assert.equal((await bad.cache.get(videoId, request())).warning, true);
});
