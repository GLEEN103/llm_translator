import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKiePrices, fetchKiePrices, createKiePriceService, KIE_PRICING_URL } from '../../src/extension/kie-pricing.mjs';
const row = (direction = 'Input', values = {}) => ({ modelDescription: `gpt-5.5, Chat, ${direction}`, interfaceType: 'chat', provider: 'OpenAI', creditPrice: '280', usdPrice: '1.4', creditUnit: 'per million tokens', ...values });
const page = (records, values = {}) => Response.json({ code: 200, data: { records, total: records.length, pages: 1, current: 1, ...values } });
test('pricing keeps published USD conversion and credits, never reapplies comparison discounts', () => {
  const prices = parseKiePrices([row('Input', { discountRate: 72, falPrice: '5', anchor: 'https://evil.invalid' }), row('Output', { creditPrice: '1680', usdPrice: '8.4' }), row('Cached Input', { creditPrice: '28', usdPrice: '.14' })]);
  assert.deepEqual(prices['gpt-5-5'], { input: { credits: 280, usd: 1.4 }, output: { credits: 1680, usd: 8.4 } });
  assert.ok(!JSON.stringify(prices).includes('evil'));
  assert.deepEqual(parseKiePrices([row('Input', { creditPrice: '140', usdPrice: '0.7' })])['gpt-5-5'].input, { credits: 140, usd: .7 });
  assert.equal(parseKiePrices([row('Input', { usdPrice: '2.8' })])['gpt-5-5'].input.usd, 2.8);
});
test('pricing uses audited aliases and exact directions, excludes cache and wrong provider/modality/tier', () => {
  const aliases = [row('Input', { modelDescription: 'Gemini 3.1 Pro- openai, chat, input', provider: 'Google', creditUnit: 'per million' }), row('Output', { modelDescription: 'Claude-fable-5 , chat, Output', provider: 'Anthropic', creditUnit: 'per milion tokens' })];
  assert.equal(parseKiePrices(aliases)['gemini-3.1-pro'].input.usd, 1.4);
  assert.equal(parseKiePrices(aliases)['claude-fable-5'].output.usd, 1.4);
  for (const bad of [row('Cached Input'), row('Cache Writes'), row('Input >200K'), row('Input', { provider: 'Google' }), row('Input', { interfaceType: 'video' }), row('Input', { modelDescription: 'gpt-5.5-new, Chat, Input' })]) assert.equal(parseKiePrices([bad])['gpt-5-5'].input, null);
  assert.equal(parseKiePrices([row(), row('Input', { usdPrice: '0.1' })])['gpt-5-5'].input, null);
});
test('unknown units and malformed numbers do not become free or guessed prices', () => {
  for (const values of [{ creditUnit: '' }, { creditUnit: 'per thousand tokens' }, { usdPrice: '' }, { usdPrice: null }, { usdPrice: '-1' }, { usdPrice: '1e4' }, { creditPrice: true }, { creditPrice: 1e10 }, { usdPrice: 0 }, { usdPrice: Infinity }]) assert.equal(parseKiePrices([row('Input', values)])['gpt-5-5'].input, null);
  assert.deepEqual(parseKiePrices([row('Input', { creditPrice: '0', usdPrice: '0' })])['gpt-5-5'].input, { credits: 0, usd: 0 });
  assert.equal(parseKiePrices([null, {}, row('Output')])['gpt-5-5'].input, null);
});
test('public pricing paginates without credentials, content, keys, redirects or HTTP cache', async () => {
  let calls = 0;
  const result = await fetchKiePrices({ now: () => 12345, fetchImpl: async (url, options) => {
    assert.equal(url, KIE_PRICING_URL); assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), { pageNum: ++calls, pageSize: 100, modelDescription: '', interfaceType: 'Chat' });
    return page([row(calls === 1 ? 'Input' : 'Output')], { current: calls, pages: 2, total: 2 });
  } });
  assert.equal(calls, 2); assert.equal(result.fetchedAt, 12345); assert.equal(result.prices['gpt-5-5'].output.usd, 1.4);
});
test('pricing rejects incomplete pagination, oversized or non-price responses, timeout and cancellation', async () => {
  for (const response of [page([row()], { total: 2 }), page([row()], { pages: 11 }), page([row()], { current: 2 }), page([row()], { total: 1001 }), page([row('Cached Input')]), new Response('private', { status: 403 }), new Response('x'.repeat(524289)), new Response('{}')]) await assert.rejects(fetchKiePrices({ fetchImpl: async () => response }), { code: 'PRICE_UNAVAILABLE' });
  await assert.rejects(fetchKiePrices({ timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', reject)) }), { code: 'PRICE_UNAVAILABLE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchKiePrices({ signal: controller.signal, fetchImpl: async () => { throw Error('must not fetch'); } }), { code: 'CANCELLED' });
});
test('price refresh coalesces concurrent callers, throttles, applies changes, labels failed old values and recovers', async () => {
  let time = 1000, calls = 0, usdPrice = '1.4', fail = false;
  const service = createKiePriceService({ now: () => time, fetchImpl: async () => { calls++; return fail ? new Response('', { status: 503 }) : page([row('Input', { usdPrice })]); } });
  const [a, b] = await Promise.all([service(), service()]); assert.deepEqual(a, b); assert.equal(calls, 1);
  await service(); assert.equal(calls, 1);
  time += 30_000; usdPrice = '0.7'; const sale = await service(); assert.equal(sale.prices['gpt-5-5'].input.usd, .7);
  time += 30_000; fail = true; const old = await service(); assert.equal(old.error, 'PRICE_UNAVAILABLE'); assert.equal(old.fetchedAt, sale.fetchedAt); assert.deepEqual(old.prices, sale.prices);
  time += 30_000; fail = false; const recovered = await service(); assert.equal(recovered.error, ''); assert.equal(recovered.fetchedAt, time);
});
