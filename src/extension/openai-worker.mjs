import { AppError } from './contract.mjs';
import { OPENAI_BASE, openaiModel } from './openai-models.mjs';
import { readText } from './google.mjs';

const urls = new Set([OPENAI_BASE + '/responses']);
export async function workerFetch(message, { fetchImpl = fetch, signal } = {}) {
  if (!urls.has(message?.url) || typeof message.authorization !== 'string' || !/^Bearer [\x21-\x7e]{1,2048}$/.test(message.authorization) ||
      typeof message.body !== 'string' || new TextEncoder().encode(message.body).length > 6 * 1024 * 1024) throw new AppError('INVALID_REQUEST');
  let payload; try { payload = JSON.parse(message.body); } catch { throw new AppError('INVALID_REQUEST'); }
  if (!openaiModel(payload?.model) || payload.store !== false || payload.stream !== false || payload.tools || payload.previous_response_id || payload.conversation) throw new AppError('INVALID_REQUEST');
  const image = payload.input?.some(item => item.content?.some(part => part.type === 'input_image'));
  if (!image && new TextEncoder().encode(message.body).length > 131072) throw new AppError('INVALID_REQUEST');
  const response = await fetchImpl(message.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: message.authorization },
    body: message.body, signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
  return { status: response.status, contentType: (response.headers.get('content-type') ?? '').slice(0, 256), text: await readText(response) };
}
// A fresh dedicated worker is created for each request and terminated by its owner afterwards.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.onmessage = async event => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180_000);
    try { self.postMessage({ type: 'result', ...(await workerFetch(event.data, { signal: controller.signal })) }); }
    catch (error) { self.postMessage({ type: 'error', code: controller.signal.aborted ? 'OPENAI_REQUEST_TIMEOUT' : error instanceof AppError ? error.code : 'OPENAI_NETWORK' }); }
    finally { clearTimeout(timer); }
  };
}
