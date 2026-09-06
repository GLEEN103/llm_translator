import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheScope, cachedEntries, mergeCache, CACHE_LIMITS } from '../../src/extension/page-cache.mjs';

test('page cache isolates exact URL, model, revision and language pair', () => {
  const request = { model: 'model', settingsRevision: 'revision', sourceLanguage: 'auto', targetLanguage: 'ko' };
  const scope = cacheScope('https://example.invalid/a', request);
  const record = mergeCache(null, scope, [{ id: 'one', text: 'Hello' }], [{ id: 'one', text: '안녕' }]);
  assert.equal(cachedEntries(record, scope).get('Hello'), '안녕');
  for (const field of Object.keys(request)) assert.equal(cachedEntries(record, cacheScope('https://example.invalid/a', { ...request, [field]: 'changed' })).size, 0);
  assert.equal(cachedEntries(record, cacheScope('https://example.invalid/b', request)).size, 0);
});

test('page cache merges by source text and response ID with bounded size', () => {
  const record = mergeCache(null, 'scope', [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], [{ id: 'b', text: '둘' }, { id: 'a', text: '하나' }]);
  assert.deepEqual(record.entries, [['A', '하나'], ['B', '둘']]);
  const updated = mergeCache(record, 'scope', [{ id: 'new-id', text: 'A' }], [{ id: 'new-id', text: '다시' }]);
  assert.deepEqual(updated.entries, [['A', '다시'], ['B', '둘']]);
  assert.equal(mergeCache(null, 'scope', [{ id: 'a', text: 'a' }], [{ id: 'a', text: 'x'.repeat(CACHE_LIMITS.chars) }]), null);
  const full = { scope: 'scope', entries: Array.from({ length: CACHE_LIMITS.entries }, (_, i) => [String(i), 'value']) };
  assert.equal(mergeCache(full, 'scope', [{ id: 'a', text: 'extra' }], [{ id: 'a', text: 'value' }]), null);
});
