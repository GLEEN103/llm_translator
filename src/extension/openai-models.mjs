import { AppError } from './contract.mjs';
import { readJson } from './google.mjs';

export const OPENAI_BASE = 'https://api.openai.com/v1';
// Audited 2026-09-07: each /api/docs/models/<id> page confirms Responses, vision and
// Structured Outputs. Release dates: API changelog and openai.com/index/gpt-5-6/.
// Only documented snapshots are listed. Never guess support from a model-name prefix.
const families = [
  ['gpt-6-astra', 'GPT-6 Astra', '2026-09-03', 'low'],
  ['gpt-5.6-sol', 'GPT-5.6 Sol', '2026-07-09', 'low'],
  ['gpt-5.6-terra', 'GPT-5.6 Terra', '2026-07-09', 'low'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna', '2026-07-09', 'low'],
  ['gpt-5.5', 'GPT-5.5', '2026-04-23', 'low', '2026-04-23'],
  ['gpt-5.4-mini', 'GPT-5.4 Mini', '2026-03-17', 'low', '2026-03-17'],
  ['gpt-4.1-mini', 'GPT-4.1 Mini', '2025-04-14', null, '2025-04-14'],
  ['gpt-4o-mini', 'GPT-4o Mini', '2024-07-18', null, '2024-07-18']
];
export const OPENAI_MODELS = Object.freeze(families.flatMap(([id, displayName, releaseDate, reasoning, snapshot]) => {
  const entry = { id, displayName, releaseDate, reasoning, family: id.startsWith('gpt-6') ? 'GPT-6' : id.startsWith('gpt-5') ? 'GPT-5' : 'GPT-4',
    images: true, doc: `https://developers.openai.com/api/docs/models/${id}` };
  return [Object.freeze(entry), ...(snapshot ? [Object.freeze({ ...entry, id: `${id}-${snapshot}`, displayName: `${displayName} (${snapshot})` })] : [])];
}));
export const openaiModel = id => OPENAI_MODELS.find(model => model.id === id);
export const sortOpenAIModels = models => [...models].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.id.localeCompare(b.id));

export async function listOpenAIModels({ apiKey, fetchImpl = fetch, signal, timeoutMs = 18000, now = Date.now }) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(`${OPENAI_BASE}/models`, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError([401, 403].includes(response.status) ? 'PROVIDER_AUTH' : response.status === 429 ? 'OPENAI_RATE_LIMIT' : 'OPENAI_UNAVAILABLE');
    }
    const data = await readJson(response);
    if (data?.object !== 'list' || !Array.isArray(data.data) || data.data.length > 5000) throw new AppError('INVALID_MODEL_LIST');
    const models = new Map();
    for (const item of data.data) {
      const model = openaiModel(item?.id);
      if (!model || item.object !== 'model') continue;
      if (item.shutdown_date && (!/^\d{4}-\d{2}-\d{2}$/.test(item.shutdown_date) || item.shutdown_date <= new Date(now()).toISOString().slice(0, 10))) continue;
      models.set(model.id, { ...model });
    }
    return sortOpenAIModels([...models.values()]);
  } catch (error) {
    if (signal?.aborted) throw new AppError('CANCELLED');
    if (controller.signal.aborted) throw new AppError('OPENAI_REQUEST_TIMEOUT');
    if (error instanceof AppError) throw error;
    throw new AppError('OPENAI_NETWORK');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
