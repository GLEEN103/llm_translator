export const LIMITS = Object.freeze({
  segments: 64, segmentChars: 2400, requestChars: 12000,
  responseBytes: 262_144, translationChars: 48_000, timeoutMs: 25_000,
  concurrent: 5, attemptsPerMinute: 60, sessionChars: 200_000
});
export const LANGUAGES = ['auto', 'ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'de', 'fr', 'es'];
export class AppError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validateRequest(data) {
  if (!exactKeys(data, ['jobId', 'provider', 'model', 'settingsRevision', 'sourceLanguage', 'targetLanguage', 'segments']) ||
      typeof data.settingsRevision !== 'string' || !idPattern.test(data.settingsRevision) ||
      typeof data.jobId !== 'string' || !idPattern.test(data.jobId) || !['google', 'openai', 'kie'].includes(data.provider) ||
      typeof data.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(data.model) ||
      !LANGUAGES.includes(data.sourceLanguage) || !LANGUAGES.slice(1).includes(data.targetLanguage) ||
      !Array.isArray(data.segments) || data.segments.length < 1 || data.segments.length > LIMITS.segments) {
    throw new AppError('INVALID_REQUEST');
  }
  const ids = new Set();
  let chars = 0;
  for (const segment of data.segments) {
    if (!exactKeys(segment, ['id', 'text']) || typeof segment.id !== 'string' || !idPattern.test(segment.id) ||
        ids.has(segment.id) || typeof segment.text !== 'string' || !segment.text.trim() ||
        segment.text.length > LIMITS.segmentChars) throw new AppError('INVALID_SEGMENT');
    ids.add(segment.id);
    chars += segment.text.length;
  }
  if (chars > LIMITS.requestChars) throw new AppError('REQUEST_TOO_LARGE', 413);
  return { ...data, chars };
}
export function validateTranslations(value, segments) {
  if (!exactKeys(value, ['translations']) || !Array.isArray(value.translations) ||
      value.translations.length !== segments.length) throw new AppError('INVALID_PROVIDER_RESPONSE', 502);
  const wanted = new Set(segments.map(segment => segment.id));
  let total = 0;
  for (const item of value.translations) {
    if (!exactKeys(item, ['id', 'text']) || !wanted.delete(item.id) ||
        typeof item.text !== 'string' || !item.text.trim() || item.text.length > LIMITS.translationChars) {
      throw new AppError('INVALID_PROVIDER_RESPONSE', 502);
    }
    total += item.text.length;
  }
  if (wanted.size || total > LIMITS.translationChars) throw new AppError('INVALID_PROVIDER_RESPONSE', 502);
  return value.translations;
}
