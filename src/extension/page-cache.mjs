// Trusted, tab-scoped session data. Keys/credentials are never included.
export const CACHE_LIMITS = Object.freeze({ entries: 500, chars: 1_000_000 });
export function cacheScope(url, request) {
  return JSON.stringify([url, request.provider ?? 'google', request.model, request.settingsRevision, request.sourceLanguage, request.targetLanguage]);
}
export function cachedEntries(record, scope) {
  return new Map(record?.scope === scope ? record.entries : []);
}
export function mergeCache(record, scope, segments, translations) {
  const entries = cachedEntries(record, scope);
  const byId = new Map(translations.map(item => [item.id, item.text]));
  for (const segment of segments) entries.set(segment.text, byId.get(segment.id));
  if (entries.size > CACHE_LIMITS.entries || [...entries].reduce((total, [source, target]) => total + source.length + target.length, 0) > CACHE_LIMITS.chars) return null;
  return { scope, entries: [...entries] };
}
