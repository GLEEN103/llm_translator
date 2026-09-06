import test from 'node:test';
import assert from 'node:assert/strict';
import { listGoogleModels } from '../../src/extension/models.mjs';
const apiKey = 'DUMMY_NOT_A_REAL_API_KEY_123456';
const model = (id, methods = ['generateContent']) => ({ name: `models/${id}`, displayName: 'Example', supportedGenerationMethods: methods });

test('model list paginates, filters methods, deduplicates and keeps credentials out of URL/body', async () => {
  const calls = [];
  const result = await listGoogleModels({ apiKey, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.headers['x-goog-api-key'], apiKey); assert.ok(!url.includes(apiKey));
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    return Response.json(calls.length === 1 ? { models: [model('b'), model('embedding', ['embedContent']), model('../evil')], nextPageToken: 'next +/&' } : { models: [model('a'), model('b')] });
  } });
  assert.deepEqual(result.map(item => item.id), ['a', 'b']);
  assert.equal(new URL(calls[1]).searchParams.get('pageToken'), 'next +/&');
  assert.equal(new URL(calls[1]).origin, 'https://generativelanguage.googleapis.com');
});
test('empty model lists are represented without invented defaults', async () => {
  assert.deepEqual(await listGoogleModels({ apiKey, fetchImpl: async () => Response.json({}) }), []);
});
test('malformed pages and repeated pagination tokens fail closed', async () => {
  for (const data of [null, { models: {} }, { models: [], nextPageToken: 'loop' }]) {
    await assert.rejects(listGoogleModels({ apiKey, fetchImpl: async () => Response.json(data) }), { code: 'INVALID_MODEL_LIST' });
  }
});
test('model errors are sanitized and never include provider error body', async () => {
  for (const [status, code] of [[403, 'PROVIDER_AUTH'], [429, 'PROVIDER_RATE_LIMIT'], [500, 'PROVIDER_UNAVAILABLE']]) {
    await assert.rejects(listGoogleModels({ apiKey, fetchImpl: async () => new Response(apiKey, { status }) }), { code });
  }
});
test('model lookup handles timeout, cancellation, oversized response and network failure', async () => {
  const hanging = async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  await assert.rejects(listGoogleModels({ apiKey, timeoutMs: 5, fetchImpl: hanging }), { code: 'PROVIDER_TIMEOUT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(listGoogleModels({ apiKey, signal: controller.signal, fetchImpl: hanging }), { code: 'CANCELLED' });
  await assert.rejects(listGoogleModels({ apiKey, fetchImpl: async () => new Response('x'.repeat(270000)) }), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  await assert.rejects(listGoogleModels({ apiKey, fetchImpl: async () => { throw Error(apiKey); } }), { code: 'PROVIDER_NETWORK' });
});
