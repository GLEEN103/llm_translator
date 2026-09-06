import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleProvider, GOOGLE_BASE } from '../../src/extension/google.mjs';
import { AppError, LIMITS, validateRequest, validateTranslations } from '../../src/extension/contract.mjs';

const request = () => ({ jobId: 'job-1', provider: 'google', model: 'test-model', settingsRevision: 'revision-1', sourceLanguage: 'auto', targetLanguage: 'ko', segments: [{ id: 's1', text: 'Hello world' }] });
const goodResponse = (translations = [{ id: 's1', text: '안녕하세요' }]) => new Response(JSON.stringify({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ translations }) }] } }],
  usageMetadata: { promptTokenCount: 10, totalTokenCount: 20, privateField: 'do-not-return' }
}));
test('contract rejects extra metadata, credentials, providers, languages and duplicate IDs', () => {
  assert.equal(validateRequest(request()).chars, 11);
  for (const value of [{ ...request(), url: 'https://private.invalid' }, { ...request(), apiKey: 'fake-key' },
    { ...request(), provider: 'unsupported' }, { ...request(), targetLanguage: 'auto' }, { ...request(), jobId: 123 },
    { ...request(), settingsRevision: '' }, { ...request(), segments: [request().segments[0], request().segments[0]] },
    { ...request(), segments: [{ id: 's1', text: 'x'.repeat(2401) }] }]) assert.throws(() => validateRequest(value), AppError);
});
test('response contract rejects missing, duplicate, unknown, blank and excessive translations', () => {
  for (const translations of [[], [{ id: 'other', text: 'hello' }], [{ id: 's1', text: '' }],
    [{ id: 's1', text: 'x'.repeat(LIMITS.translationChars + 1) }], [{ id: 's1', text: 'a' }, { id: 's1', text: 'b' }]]) assert.throws(() => validateTranslations({ translations }, request().segments), AppError);
});

test('many elements use one structured request and reversed responses retain IDs', async () => {
  let calls = 0;
  const segments = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, text: `Source ${i}` }));
  const translate = createGoogleProvider({ apiKey: 'dummy-key', model: 'test-model', fetchImpl: async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body), schema = payload.generationConfig.responseJsonSchema;
    assert.deepEqual(JSON.parse(payload.contents[0].parts[0].text).segments, segments);
    assert.equal(schema.properties.translations.minItems, 40); assert.equal(schema.properties.translations.maxItems, 40);
    assert.deepEqual(schema.properties.translations.items.properties.id.enum, segments.map(item => item.id));
    return goodResponse([...segments].reverse().map(item => ({ id: item.id, text: `Result ${item.id}` })));
  } });
  const result = await translate(validateRequest({ ...request(), segments }));
  assert.equal(calls, 1); assert.equal(result.translations.length, 40);
  const byId = new Map(result.translations.map(item => [item.id, item.text]));
  for (const item of segments) assert.equal(byId.get(item.id), `Result ${item.id}`);
});
test('Google adapter uses fixed HTTPS, key header and minimal text payload without cookies', async () => {
  let captured;
  const translate = createGoogleProvider({ apiKey: 'dummy-key', model: 'test-model', fetchImpl: async (url, options) => { captured = { url, options }; return goodResponse(); } });
  const result = await translate(validateRequest(request()));
  assert.equal(captured.url, `${GOOGLE_BASE}/models/test-model:generateContent`);
  assert.equal(captured.options.headers['x-goog-api-key'], 'dummy-key');
  assert.equal(captured.options.redirect, 'error'); assert.equal(captured.options.credentials, 'omit');
  const payload = JSON.parse(captured.options.body);
  assert.deepEqual(Object.keys(JSON.parse(payload.contents[0].parts[0].text)), ['sourceLanguage', 'targetLanguage', 'segments']);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.equal(result.translations[0].text, '안녕하세요'); assert.equal(result.usage.privateField, undefined);
});
test('provider rejects incomplete and malformed output', async () => {
  for (const response of [new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] })),
    new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: {} } }] })),
    goodResponse([{ id: 'unknown', text: 'bad' }]), new Response('not json')]) {
    const translate = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => response });
    await assert.rejects(translate(validateRequest(request())), AppError);
  }
});
test('auth errors are sanitized and never retried', async () => {
  let calls = 0;
  const translate = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => { calls++; return new Response('SECRET BODY', { status: 403 }); } });
  await assert.rejects(translate(validateRequest(request())), { code: 'PROVIDER_AUTH' }); assert.equal(calls, 1);
});
test('rate limit retries once and awaits quota accounting before each attempt', async () => {
  let calls = 0, charges = 0;
  const translate = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => {
    calls++; assert.equal(charges, calls); return calls === 1 ? new Response('', { status: 429 }) : goodResponse();
  } });
  await translate(validateRequest(request()), { beforeAttempt: async () => { await Promise.resolve(); charges++; } });
  assert.equal(calls, 2); assert.equal(charges, 2);
});
test('oversized streaming output is cancelled', async () => {
  const translate = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => new Response('x'.repeat(LIMITS.responseBytes + 1)) });
  await assert.rejects(translate(validateRequest(request())), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
});
test('timeout, cancellation and network errors remain distinct', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('private detail')), { once: true }));
  const translate = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', timeoutMs: 10, fetchImpl });
  await assert.rejects(translate(validateRequest(request())), { code: 'PROVIDER_TIMEOUT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(translate(validateRequest(request()), { signal: controller.signal }), { code: 'CANCELLED' });
  const network = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => { throw new Error('private detail'); } });
  await assert.rejects(network(validateRequest(request())), { code: 'PROVIDER_NETWORK' });
});


test('usage is captured before candidate validation, including incomplete and invalid output', async () => {
  for (const response of [goodResponse([{ id: 'wrong', text: 'bad' }]), Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { totalTokenCount: 99 } })]) {
    const records = [];
    const provider = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => response });
    await assert.rejects(provider(validateRequest(request()), { onAttempt: () => 'id', onUsage: (id, usage) => records.push({ id, usage }) }));
    assert.equal(records.length, 1); assert.equal(records[0].id, 'id'); assert.ok(records[0].usage.totalTokenCount > 0); assert.equal(records[0].usage.privateField, undefined);
  }
});

test('every HTTP retry gets one usage completion, including error response metadata', async () => {
  const records = []; let starts = 0, calls = 0;
  const provider = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => ++calls === 1 ? Response.json({ usageMetadata: { totalTokenCount: 4 } }, { status: 503 }) : goodResponse() });
  await provider(validateRequest(request()), { onAttempt: () => ++starts, onUsage: (id, usage) => records.push({ id, usage }) });
  assert.equal(starts, 2); assert.deepEqual(records.map(r => [r.id, r.usage.totalTokenCount]), [[1, 4], [2, 20]]);
});

test('failed starts do not send HTTP; network failure and cancellation finalize unknown usage', async () => {
  let calls = 0, done = 0;
  const provider = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => { calls++; throw Error('network'); } });
  await assert.rejects(provider(validateRequest(request()), { onAttempt: () => { throw new AppError('USAGE_STORAGE_FAILED'); }, onUsage: () => done++ }), { code: 'USAGE_STORAGE_FAILED' });
  assert.equal(calls, 0); assert.equal(done, 0);
  await assert.rejects(provider(validateRequest(request()), { onAttempt: () => 'net', onUsage: (id, usage) => { assert.equal(id, 'net'); assert.deepEqual(usage, {}); done++; } }), { code: 'PROVIDER_NETWORK' });
  const controller = new AbortController();
  const cancel = createGoogleProvider({ apiKey: 'dummy', model: 'test-model', fetchImpl: async () => { controller.abort(); throw Error('aborted'); } });
  await assert.rejects(cancel(validateRequest(request()), { signal: controller.signal, onUsage: (_id, usage) => { assert.deepEqual(usage, {}); done++; } }), { code: 'CANCELLED' });
  assert.equal(done, 2);
});
