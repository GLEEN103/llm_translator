import { KIE_MODELS, KIE_INDEX } from '/kie-models.mjs';
import { KIE_PRICING_URL } from '/kie-pricing.mjs';
import { createBroker } from '/broker.mjs';
// Dummy-only browser fixture. Even the metadata API is replaced with local responses.
const memory = {}, consentMemory = JSON.parse(sessionStorage.getItem('fixture-v04-local') ?? '{}'), id = 'a'.repeat(32);
const area = (values, persist = false) => ({
  setAccessLevel: async () => {},
  remove: async keys => { for (const key of [].concat(keys)) delete values[key]; if (persist) sessionStorage.setItem('fixture-v04-local', JSON.stringify(values)); },
  get: async key => structuredClone({ [key]: values[key] }),
  set: async value => { Object.assign(values, structuredClone(value)); if (persist) sessionStorage.setItem('fixture-v04-local', JSON.stringify(values)); }
});
const mockChrome = { runtime: { id, getURL: file => `chrome-extension://${id}/${file}`, getManifest: () => ({ version: '0.14.1' }) },
  storage: { session: area(memory), local: area(consentMemory, true) } };
let calls = 0;
const broker = createBroker({ chrome: mockChrome, fetchImpl: async (_url, options) => {
  if (_url === KIE_PRICING_URL) {
    if (options.headers.Authorization || options.credentials !== 'omit') throw Error('Price lookup must be public');
    if (document.getElementById('fixture-price-mode').value === 'fail') return new Response('', { status: 503 });
    const multiplier = document.getElementById('fixture-price-mode').value === 'sale' ? 0.5 : 1;
    const provider = { Gemini: 'Google', GPT: 'OpenAI', Codex: 'OpenAI', Claude: 'Anthropic', Grok: 'Grok' };
    const records = KIE_MODELS.flatMap(m => ['Input', 'Output'].map((direction, i) => ({ modelDescription: `${m.displayName}, chat, ${direction}`, interfaceType: 'chat', provider: provider[m.family], creditPrice: String((i + 1) * 100 * multiplier), usdPrice: String((i + 1) * 0.5 * multiplier), creditUnit: 'per million tokens' })));
    for (const row of records) {
      if (document.getElementById('fixture-price-mode').value === 'missing' && row.provider === 'OpenAI') row.creditUnit = '';
      if (document.getElementById('fixture-price-mode').value === 'long') row.usdPrice = row.modelDescription.endsWith('Input') ? '0.000056' : '1000000000';
    }
    return Response.json({ code: 200, data: { records, total: records.length, pages: 1, current: 1 } });
  }
  if (options.method !== 'GET') throw Error('No real provider calls allowed');
  calls++;
  await new Promise(resolve => setTimeout(resolve, 400));
  if (_url === KIE_INDEX) { if (options.headers) throw Error('Catalog must not receive a key'); return new Response(KIE_MODELS.map(m => '[' + m.id + '](' + m.doc + ')').join('\n')); }
  const key = options.headers['x-goog-api-key'];
  if (key.includes('FAIL')) return new Response('', { status: 403 });
  return Response.json({ models: key.includes('EMPTY') ? [] : [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (모의)', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash (모의)', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/test-model', displayName: '출시일 미확인 모의 모델', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }
  ] });
} });
mockChrome.runtime.sendMessage = async message => {
  try {
    const data = await broker.handle(message, { id, url: mockChrome.runtime.getURL('options.html') });
    document.getElementById('fixture-status').textContent = `모의 모델 조회 ${calls}회 · 실제 API 호출 0회 · 저장 모델 ${Object.keys(consentMemory.modelProfiles?.entries ?? {}).length}개`;
    return { ok: true, data };
  } catch (error) { return { ok: false, error: error.code ?? 'WORKER_INTERRUPTED' }; }
};
globalThis.chrome = mockChrome;
const badge = document.createElement('p'); badge.id = 'fixture-status'; badge.textContent = '모의 설정 화면 · 실제 API 키를 입력하지 마세요.';
document.querySelector('main').prepend(badge);
const priceMode = document.createElement('select'); priceMode.id = 'fixture-price-mode'; priceMode.setAttribute('aria-label', '모의 가격 상태');
for (const [value, name] of [['normal', '모의 정상 가격'], ['sale', '모의 50% 가격 변경'], ['fail', '모의 조회 실패'], ['missing', '모의 가격 미확인'], ['long', '모의 긴 가격']]) priceMode.append(new Option(name, value));
badge.after(priceMode);
const themeMode = document.createElement('select'); themeMode.id = 'fixture-theme'; themeMode.setAttribute('aria-label', '모의 테마');
for (const [value, name] of [['auto', '기기 테마'], ['light', '라이트 검증'], ['dark', '다크 검증']]) themeMode.append(new Option(name, value));
priceMode.after(themeMode);
// Exercise the exact production media-rule declarations without changing OS/browser settings.
const darkRules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter(rule => rule instanceof CSSMediaRule && rule.conditionText === '(prefers-color-scheme: dark)');
themeMode.addEventListener('change', () => { for (const rule of darkRules) rule.media.mediaText = themeMode.value === 'auto' ? '(prefers-color-scheme: dark)' : themeMode.value === 'dark' ? 'all' : 'not all'; });
await import('/options.js');
document.getElementById('api-key').value = 'DUMMY_NOT_A_REAL_API_KEY_123456';
