import { AppError } from './contract.mjs';
import { readText } from './google.mjs';
import { sortModels } from './model-releases.mjs';

export const KIE_BASE = 'https://api.kie.ai';
export const KIE_INDEX = 'https://docs.kie.ai/llms.txt';
// Audited API routes only. Remote document text cannot select a credential destination.
export const KIE_MODELS = [
  ['gemini-2.5-flash', 'Gemini 2.5 Flash', 'Gemini', 'chat', '/gemini-2.5-flash/v1/chat/completions', 'market/gemini/gemini-2-5-flash', true],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro', 'Gemini', 'chat', '/gemini-2.5-pro/v1/chat/completions', 'market/gemini/gemini-2-5-pro', true],
  ['gemini-3-pro', 'Gemini 3 Pro', 'Gemini', 'chat', '/gemini-3-pro/v1/chat/completions', 'market/gemini/gemini-3-pro', true],
  ['gemini-3.1-pro', 'Gemini 3.1 Pro', 'Gemini', 'chat', '/gemini-3.1-pro/v1/chat/completions', 'market/gemini/gemini-3-1-pro', false],
  ['gemini-3-flash', 'Gemini 3 Flash', 'Gemini', 'chat', '/gemini-3-flash/v1/chat/completions', 'market/gemini/gemini-3-flash', false],
  // 3.8 mentions response_format in its example; use Kie's OpenAI schema shape (see plan 0025).
  ['gemini-3-8-flash-openai', 'Gemini 3.8 Flash', 'Gemini', 'chat', '/gemini-3-8-flash-openai/v1/chat/completions', 'market/gemini/gemini-3-8-flash-openai', true],
  ['gpt-5-2', 'GPT 5.2', 'GPT', 'chat', '/gpt-5-2/v1/chat/completions', 'market/chat/gpt-5-2', false],
  ['gpt-5-5', 'GPT 5.5', 'GPT', 'responses', '/codex/v1/responses', 'market/chat/gpt-5-5', false],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6', 'Claude', 'messages', '/claude/v1/messages', 'market/claude/claude-sonnet-4-6', false],
  ['claude-opus-4-7', 'Claude Opus 4.7', 'Claude', 'messages', '/claude/v1/messages', 'market/claude/claude-opus-4-7', false],
  ...[['gpt-5-4', 'GPT 5.4'], ['gpt-5-6-luna', 'GPT 5.6 Luna'], ['gpt-5-6-terra', 'GPT 5.6 Terra'], ['gpt-5-6-sol', 'GPT 5.6 Sol'], ['gpt-6-astra', 'GPT 6 Astra']]
    .map(([id, name]) => [id, name, 'GPT', 'responses', '/codex/v1/responses', `market/chat/${id}`, false]),
  ...['gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.4-codex']
    .map(id => [id, id.replace('gpt-', 'GPT ').replace('-codex', ' Codex'), 'Codex', 'responses', '/api/v1/responses', 'market/codex/gpt-codex', false]),
  ...[['claude-opus-4-8', 'Claude Opus 4.8', 'claude-opus-4-8'], ['claude-fable-5', 'Claude Fable 5', 'cluade-fable-5'],
    ['claude-sonnet-5', 'Claude Sonnet 5', 'cluade-sonnet-5'], ['claude-haiku-4-5', 'Claude Haiku 4.5', 'claude-haiku-4-5'],
    ['claude-opus-4-5', 'Claude Opus 4.5', 'claude-opus-4-5'], ['claude-opus-4-6', 'Claude Opus 4.6', 'claude-opus-4-6'],
    ['claude-opus-5', 'Claude Opus 5', 'claude-opus-5'], ['claude-sonnet-4-5', 'Claude Sonnet 4.5', 'claude-sonnet-4-5']]
    .map(([id, name, doc]) => [id, name, 'Claude', 'messages', '/claude/v1/messages', `market/claude/${doc}`, false]),
  ...['5', '6', '7'].map(minor => [`gemini-3-${minor}-flash-openai`, `Gemini 3.${minor} Flash`, 'Gemini', 'chat', `/gemini-3-${minor}-flash-openai/v1/chat/completions`, `market/gemini/gemini-3-${minor}-flash-openai`, false]),
  ...['3', '5', '6'].map(minor => [`grok-4-${minor}`, `Grok 4.${minor}`, 'Grok', 'responses', '/grok/v1/responses', `market/grok/grok-4-${minor}`, false])
].map(([id, displayName, family, format, path, doc, schema]) => Object.freeze({ id, displayName, family, format, path, schema, provider: 'kie', image: false, doc: `https://docs.kie.ai/${doc}.md` }));
export const kieModel = id => KIE_MODELS.find(model => model.id === id);
export function parseKieModels(text) {
  const urls = new Set([...text.matchAll(/\]\((https:\/\/docs\.kie\.ai\/[^\s)]+)\)/g)].map(match => match[1]));
  return sortModels(KIE_MODELS.filter(model => urls.has(model.doc)).map(({ id, displayName, family, provider, image }) => ({ id, displayName, family, provider, image })));
}
export async function listKieModels({ fetchImpl = fetch, signal, timeoutMs = 18000 }) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(KIE_INDEX, { method: 'GET', signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok) { await response.body?.cancel(); throw new AppError('MODEL_CATALOG_UNAVAILABLE'); }
    const models = parseKieModels(await readText(response, 524288));
    if (!models.length) throw new AppError('NO_MODELS');
    return models;
  } catch (error) {
    if (signal?.aborted) throw new AppError('CANCELLED');
    if (controller.signal.aborted) throw new AppError('PROVIDER_TIMEOUT');
    if (error instanceof AppError) throw error;
    throw new AppError('MODEL_CATALOG_UNAVAILABLE');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
