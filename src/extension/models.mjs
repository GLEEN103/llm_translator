import { AppError, LIMITS } from './contract.mjs';
import { GOOGLE_BASE, readJson } from './google.mjs';
import { sortModels } from './model-releases.mjs';

export async function listGoogleModels({ apiKey, fetchImpl = fetch, signal, timeoutMs = 18_000 }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const models = new Map(), seenTokens = new Set();
  let pageToken = '';
  try {
    for (let page = 0; page < 20; page++) {
      controller.signal.throwIfAborted();
      const url = new URL(`${GOOGLE_BASE}/models`);
      url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetchImpl(url.href, {
        method: 'GET', headers: { 'x-goog-api-key': apiKey }, signal: controller.signal,
        redirect: 'error', credentials: 'omit', cache: 'no-store'
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError([400, 401, 403].includes(response.status) ? 'PROVIDER_AUTH' :
          response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_UNAVAILABLE');
      }
      const data = await readJson(response);
      if (!data || !Array.isArray(data.models ?? [])) throw new AppError('INVALID_MODEL_LIST');
      for (const item of data.models ?? []) {
        if (!item || typeof item.name !== 'string' || !/^models\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(item.name) ||
            !Array.isArray(item.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent')) continue;
        const id = item.name.slice(7);
        models.set(id, { id, displayName: typeof item.displayName === 'string' ? item.displayName.slice(0, 200) : id });
      }
      pageToken = data.nextPageToken ?? '';
      if (typeof pageToken !== 'string' || pageToken.length > 4096 || seenTokens.has(pageToken)) throw new AppError('INVALID_MODEL_LIST');
      if (!pageToken) return sortModels([...models.values()]);
      seenTokens.add(pageToken);
    }
    throw new AppError('INVALID_MODEL_LIST');
  } catch (error) {
    if (signal?.aborted) throw new AppError('CANCELLED');
    if (controller.signal.aborted) throw new AppError('PROVIDER_TIMEOUT');
    if (error instanceof AppError) throw error;
    throw new AppError('PROVIDER_NETWORK');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
