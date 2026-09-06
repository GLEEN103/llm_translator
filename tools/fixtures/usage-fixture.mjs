import { createBroker } from '/broker.mjs';
import { createUsageStore } from '/usage.mjs';
// Public mock data only. This fixture never loads credentials or calls a provider.
const key = 'token-usage-ui-fixture', id = 'a'.repeat(32);
const memory = JSON.parse(sessionStorage.getItem(key) ?? '{}'), session = {};
let failRead = false;
const area = (values, persist = false) => ({
  setAccessLevel: async () => {},
  get: async key => structuredClone({ [key]: values[key] }),
  set: async value => { Object.assign(values, structuredClone(value)); if (persist) sessionStorage.setItem(key, JSON.stringify(values)); },
  remove: async keys => { for (const key of [].concat(keys)) delete values[key]; }
});
const local = area(memory, true);
let time = Date.now();
const store = createUsageStore(local, { now: () => time });
async function seed() {
  await store.clear();
  for (const row of [
    [0, 'gemini-2.5-flash', 'page', 2000, 400, 100, 2500, 800],
    [0, 'gemini-2.5-flash', 'image', 600, 100, 0, 700, 0],
    [0, 'test-model', 'video', 30],
    [0, 'gpt-5-5', 'page', 3400123, 10000, 0, 3410123, 1000],
    [1, 'gemini-2.5-flash', 'page', 1000, 200, 50, 1250, 200],
    [40, 'test-model', 'selection', 10000, 2000, 500, 12500, 3000]
  ]) {
    const [days, model, kind, promptTokenCount, candidatesTokenCount, thoughtsTokenCount, totalTokenCount, cachedContentTokenCount] = row;
    const day = new Date(); day.setDate(day.getDate() - days); time = day.getTime();
    await store.finish(await store.begin({ provider: model.startsWith('gpt-') ? 'kie' : 'google', model, kind }), { promptTokenCount, candidatesTokenCount, thoughtsTokenCount, totalTokenCount, cachedContentTokenCount });
  }
  time = Date.now();
}
if (!memory.tokenUsage) await seed();
const mock = { runtime: { id, getURL: file => `chrome-extension://${id}/${file}`, getManifest: () => ({ version: '0.13.0' }), openOptionsPage: async () => { location.href = '/options-preview'; } },
  storage: { local, session: area(session) }, tabs: { create: async () => { location.href = '/statistics.html'; } } };
const broker = createBroker({ chrome: mock, fetchImpl: async () => { throw Error('No external calls permitted'); } });
const popup = location.pathname === '/popup-preview';
mock.runtime.sendMessage = async message => {
  if (failRead && message.type === 'USAGE_GET') return { ok: false, error: 'USAGE_STORAGE_FAILED' };
  try { return { ok: true, data: await broker.handle(message, { id, url: mock.runtime.getURL(popup ? 'popup.html' : 'statistics.html') }) }; }
  catch (error) { return { ok: false, error: error.code }; }
};
globalThis.chrome = mock;
// Keep the mock popup compact without a first-install consent wall.
await local.set({ textConsent: { version: '0.13.0' } });
const fixture = document.createElement('aside'); fixture.id = 'fixture-controls';
const label = document.createElement('p'); label.textContent = '모의 통계 · 실제 API 호출 0회'; fixture.append(label);
const seedButton = document.createElement('button'); seedButton.textContent = '모의 기록 다시 채우기'; seedButton.onclick = async () => { await seed(); location.reload(); }; fixture.append(seedButton);
const failButton = document.createElement('button'); failButton.textContent = '조회 오류 전환'; failButton.onclick = () => { failRead = !failRead; }; fixture.append(failButton);
document.body.append(fixture);
if (popup) { await import('/popup.js'); await import('/popup-usage.mjs'); }
else await import('/statistics.mjs');
