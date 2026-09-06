import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImage, validateImageRequest, validateImageResult, IMAGE_LIMITS } from '../../src/extension/image-contract.mjs';
import { createGoogleProvider } from '../../src/extension/google.mjs';
import { captureImage, validateGeometry } from '../../src/extension/image-capture.mjs';

const image = () => ({ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8O0AAAAASUVORK5CYII=' });
const request = () => ({ jobId: 'image-job', model: 'test-model', settingsRevision: 'rev', targetLanguage: 'ko', image: image() });
const response = value => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const good = { recognizedText: 'Hello', translation: '안녕', noText: false };

test('image contract accepts bounded PNG, rejects remote URLs, excess fields, MIME and invalid bytes', () => {
  assert.deepEqual(validateImageRequest(request()), request());
  for (const change of [{ url: 'https://private.invalid' }, { targetLanguage: 'auto' }, { model: '../outside' }, { image: { ...image(), url: 'extra' } },
    { image: { mimeType: 'image/svg+xml', data: image().data } }, { image: { mimeType: 'image/png', data: 'AAAA' } }]) assert.throws(() => validateImageRequest({ ...request(), ...change }));
  const bytes = Buffer.from(image().data, 'base64'); bytes.writeUInt32BE(2049, 16);
  assert.throws(() => validateImage({ ...image(), data: bytes.toString('base64') }), { code: 'IMAGE_TOO_LARGE' });
  assert.throws(() => validateImage({ ...image(), data: 'A'.repeat(Math.ceil(IMAGE_LIMITS.bytes / 3) * 4 + 4) }));
});

test('image response requires coherent transcription, translation and noText', () => {
  assert.deepEqual(validateImageResult(good), good);
  assert.deepEqual(validateImageResult({ recognizedText: '', translation: '', noText: true }), { recognizedText: '', translation: '', noText: true });
  for (const value of [{ ...good, noText: true }, { ...good, translation: '' }, { ...good, recognizedText: 'x'.repeat(24001) }, { ...good, extra: 'html' }, { ...good, noText: 'false' }]) assert.throws(() => validateImageResult(value));
});

test('Google image call sends inline pixels and target language only, with structured OCR and translation in one request', async () => {
  let calls = 0;
  const translate = createGoogleProvider({ apiKey: 'DUMMY_KEY', model: 'test-model', imageMode: true, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'DUMMY_KEY'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.contents[0].parts, [{ text: JSON.stringify({ targetLanguage: 'ko' }) }, { inlineData: image() }]);
    assert.deepEqual(payload.generationConfig.responseJsonSchema.required, ['recognizedText', 'translation', 'noText']);
    assert.ok(payload.systemInstruction.parts[0].text.includes('untrusted'));
    return response(good);
  } });
  const result = await translate(validateImageRequest(request()));
  assert.deepEqual(result, { jobId: 'image-job', ...good }); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes('DUMMY_KEY')); assert.ok(!JSON.stringify(result).includes(image().data));
});

test('Google image branch rejects malformed output and preserves no-text results', async () => {
  const noText = { recognizedText: '', translation: '', noText: true };
  const provider = value => createGoogleProvider({ apiKey: 'DUMMY', model: 'test-model', imageMode: true, fetchImpl: async () => response(value) });
  assert.equal((await provider(noText)(request())).noText, true);
  await assert.rejects(provider({ ...good, imageUrl: 'https://untrusted.invalid' })(request()), { code: 'INVALID_PROVIDER_RESPONSE' });
});

const geometry = { x: 10, y: 20, width: 200, height: 100, viewportWidth: 800, viewportHeight: 600 };
test('capture geometry rejects partial viewport crops and non-finite dimensions', () => {
  assert.deepEqual(validateGeometry(geometry), geometry);
  for (const change of [{ x: -1 }, { y: NaN }, { width: 0 }, { height: 1000 }, { viewportWidth: 0 }]) assert.throws(() => validateGeometry({ ...geometry, ...change }));
});

function captureFixture({ changedTab = false, changedGeometry = false, changedDocument = false } = {}) {
  let queries = 0, geometries = 0, crops = 0, captures = 0;
  const chrome = {
    tabs: { query: async () => [{ id: changedTab && ++queries > 1 ? 9 : 7, url: 'https://example.invalid' }],
      captureVisibleTab: async (windowId, options) => { captures++; assert.equal(windowId, 3); assert.equal(options.format, 'png'); return 'LOCAL_FULL_SCREEN'; } },
    scripting: { executeScript: async input => {
      assert.deepEqual(input.target, { tabId: 7, documentIds: ['document'] }); assert.deepEqual(input.args, ['token']);
      return [{ documentId: changedDocument ? 'other' : 'document', result: { ...geometry, x: changedGeometry && ++geometries > 1 ? 11 : 10 } }];
    } }
  };
  const run = () => captureImage({ chrome, tabId: 7, windowId: 3, documentId: 'document', token: 'token', crop: async (screen, box) => {
    crops++; assert.equal(screen, 'LOCAL_FULL_SCREEN'); assert.deepEqual(box, geometry); return image();
  } });
  return { run, crops: () => crops, captures: () => captures };
}
test('capture returns only cropped image after active-tab and document checks', async () => {
  const f = captureFixture(); assert.deepEqual(await f.run(), image()); assert.equal(f.captures(), 1); assert.equal(f.crops(), 1);
});
test('capture refuses tab switches, layout changes and document changes before exposing screenshot pixels', async () => {
  for (const setting of [{ changedTab: true }, { changedGeometry: true }, { changedDocument: true }]) {
    const f = captureFixture(setting); await assert.rejects(f.run(), { code: 'PAGE_CHANGED' }); assert.equal(f.crops(), 0);
  }
});
