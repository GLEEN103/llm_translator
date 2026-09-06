import test from 'node:test';
import assert from 'node:assert/strict';
import { sortModels, releaseDates } from '../../src/extension/model-releases.mjs';
import { listGoogleModels } from '../../src/extension/models.mjs';

test('official launch dates sort by year then date, before model names', () => {
  const result = sortModels(['unknown-2099', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-1.5-pro-002', 'gemini-3.1-pro-preview']
    .map(id => ({ id, releaseDate: '2099-12-31' })));
  assert.deepEqual(result.map(item => item.id), ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-1.5-pro-002', 'unknown-2099']);
  assert.equal(result.at(-1).releaseDate, null);
});
test('ties are deterministic; unknown models and moving aliases never invent dates', () => {
  const input = ['gemini-pro-latest', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'unknown-a', 'gemini-3-pro-preview', 'constructor'];
  const a = sortModels(input.map(id => ({ id })));
  const b = sortModels(input.reverse().map(id => ({ id })));
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice(0, 2).map(item => item.id), ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
  assert.ok(a.slice(2).every(item => item.releaseDate === null));
  for (const date of Object.values(releaseDates)) assert.equal(new Date(date).toISOString().slice(0, 10), date);
});
test('API model response dates and name ordering cannot override verified release data', async () => {
  const result = await listGoogleModels({ apiKey: 'DUMMY_ONLY_123456789', fetchImpl: async () => Response.json({
    models: ['gemini-2.5-flash', 'gemini-3.8-flash'].map(id => ({ name: `models/${id}`, releaseDate: '2099-01-01', supportedGenerationMethods: ['generateContent'] }))
  }) });
  assert.equal(result[0].id, 'gemini-3.8-flash');
  assert.equal(result[0].releaseDate, '2026-09-02');
});
