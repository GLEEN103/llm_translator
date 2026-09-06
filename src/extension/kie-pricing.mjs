import { AppError } from './contract.mjs';
import { readText } from './google.mjs';
import { KIE_MODELS } from './kie-models.mjs';

export const KIE_PRICING_URL = 'https://api.kie.ai/client/v1/model-pricing/page';
export const PRICE_REFRESH_MS = 300_000;
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[ .-]/g, '') : '';
const number = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
};
const providers = { Gemini: 'Google', GPT: 'OpenAI', Codex: 'OpenAI', Claude: 'Anthropic', Grok: 'Grok' };
export function parseKiePrices(rows) {
  const prices = {};
  for (const model of KIE_MODELS) {
    const aliases = [model.id, model.displayName, ...(model.id === 'gemini-3.1-pro' ? ['Gemini 3.1 Pro- openai'] : [])].map(normalize);
    const matched = rows.filter(row => row && typeof row.modelDescription === 'string' && row.modelDescription.length < 300 &&
      normalize(row.interfaceType) === 'chat' && row.provider === providers[model.family] && aliases.includes(normalize(row.modelDescription.split(',')[0])));
    const result = {};
    for (const direction of ['input', 'output']) {
      const candidates = matched.filter(row => {
        const parts = row.modelDescription.split(',').map(part => part.trim().toLowerCase());
        return parts.length === 3 && parts[1] === 'chat' && parts[2] === direction;
      });
      // Duplicate rows can represent tiers or conflicting promotions. Never choose the cheapest by guesswork.
      if (candidates.length !== 1) { result[direction] = null; continue; }
      const row = candidates[0], unit = String(row.creditUnit ?? '').trim().toLowerCase();
      const credits = number(row.creditPrice), usd = number(row.usdPrice);
      result[direction] = /^(per million(?: tokens)?|per milion tokens|per 1m tokens)$/.test(unit) && credits !== null && usd !== null &&
        ((credits === 0) === (usd === 0)) ? { credits, usd } : null;
    }
    prices[model.id] = result;
  }
  return prices;
}
export async function fetchKiePrices({ fetchImpl = fetch, now = Date.now, signal, timeoutMs = 18000 } = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs), rows = [];
  let total;
  try {
    for (let pageNum = 1; pageNum <= 10; pageNum++) {
      controller.signal.throwIfAborted();
      const response = await fetchImpl(KIE_PRICING_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNum, pageSize: 100, modelDescription: '', interfaceType: 'Chat' }),
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal });
      if (!response.ok) { await response.body?.cancel(); throw new AppError('PRICE_UNAVAILABLE'); }
      const json = JSON.parse(await readText(response, 524288)), data = json?.data;
      if (json.code !== 200 || !Array.isArray(data?.records) || !Number.isSafeInteger(data.total) || data.total < 1 || data.total > 1000 ||
          !Number.isSafeInteger(data.pages) || data.pages < pageNum || data.pages > 10 || data.current !== pageNum ||
          data.records.length < 1 || data.records.length > 100 || (total !== undefined && total !== data.total)) throw new AppError('PRICE_UNAVAILABLE');
      total = data.total; rows.push(...data.records);
      if (pageNum === data.pages) {
        if (rows.length !== total) throw new AppError('PRICE_UNAVAILABLE');
        const prices = parseKiePrices(rows);
        if (!Object.values(prices).some(p => p.input || p.output)) throw new AppError('PRICE_UNAVAILABLE');
        return { prices, fetchedAt: now() };
      }
    }
    throw new AppError('PRICE_UNAVAILABLE');
  } catch { throw new AppError(signal?.aborted ? 'CANCELLED' : 'PRICE_UNAVAILABLE'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function createKiePriceService({ fetchImpl = fetch, now = Date.now } = {}) {
  let snapshot = { prices: {}, fetchedAt: null, error: '' }, pending, lastAttempt = -Infinity;
  return () => {
    if (pending) return pending;
    if (now() - lastAttempt < 30_000) return Promise.resolve({ ...snapshot, retryAt: lastAttempt + 30_000 });
    lastAttempt = now();
    pending = fetchKiePrices({ fetchImpl, now }).then(data => { snapshot = { ...data, error: '' }; })
      .catch(() => { snapshot = { ...snapshot, error: 'PRICE_UNAVAILABLE' }; })
      .then(() => ({ ...snapshot, retryAt: lastAttempt + 30_000 })).finally(() => { pending = null; });
    return pending;
  };
}
