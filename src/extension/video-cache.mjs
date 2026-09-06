// Trusted local data only. Never store keys, source text, raw responses or URLs.
export const VIDEO_CACHE_LIMITS = Object.freeze({ videos: 30, bytes: 4 * 1024 * 1024, entries: 10000 });
const storageKey = 'videoTranslationCache';
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
const empty = () => ({ version: 1, videos: [] });
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(text))))].map(b => b.toString(16).padStart(2, '0')).join('');
const scope = request => JSON.stringify([request.provider, request.model, request.sourceLanguage, request.targetLanguage]);
function valid(data) {
  return data?.version === 1 && Array.isArray(data.videos) && data.videos.length <= VIDEO_CACHE_LIMITS.videos && size(data) <= VIDEO_CACHE_LIMITS.bytes &&
    new Set(data.videos.map(v => v.id)).size === data.videos.length && data.videos.every(v => /^[\w-]{11}$/.test(v.id) && Array.isArray(v.entries) && v.entries.length <= VIDEO_CACHE_LIMITS.entries &&
      new Set(v.entries.map(e => e[0])).size === v.entries.length && v.entries.every(e => Array.isArray(e) && e.length === 2 && /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(e[0]) && typeof e[1] === 'string' && e[1].trim() && e[1].length <= 48000));
}
export function createVideoCache(area) {
  let state, warning = false, epoch = 0, serial = Promise.resolve();
  const locked = task => { const result = serial.then(task); serial = result.catch(() => {}); return result; };
  async function load() {
    if (state) return;
    try {
      const data = (await area.get(storageKey))[storageKey], accepted = data && valid(data);
      state = accepted ? { version: 1, videos: data.videos.map(v => ({ id: v.id, entries: v.entries.map(([key, text]) => [key, text]) })) } : empty();
      warning = Boolean(data && !accepted);
    }
    catch { state = empty(); warning = true; }
  }
  async function persist() {
    try { await area.set({ [storageKey]: state }); warning = false; return false; }
    catch { warning = true; return true; }
  }
  return Object.freeze({
    async get(videoId, request) {
      const prefix = await digest(scope(request));
      const keys = await Promise.all(request.segments.map(async s => [s.text, `${prefix}:${await digest(s.text)}`]));
      return locked(async () => {
        await load(); const video = state.videos.find(v => v.id === videoId), stored = new Map(video?.entries ?? []), entries = new Map();
        for (const [text, key] of keys) if (stored.has(key)) entries.set(text, stored.get(key));
        if (entries.size) { state.videos = state.videos.filter(v => v !== video); state.videos.push(video); await persist(); }
        return { entries, keys: new Map(keys), epoch, warning };
      });
    },
    put(videoId, ticket, segments, translations) {
      return locked(async () => {
        await load(); if (ticket.epoch !== epoch) return false;
        const video = state.videos.find(v => v.id === videoId) ?? { id: videoId, entries: [] };
        const entries = new Map(video.entries), byId = new Map(translations.map(t => [t.id, t.text]));
        for (const segment of segments) {
          const key = ticket.keys.get(segment.text); if (!key || !byId.has(segment.id)) continue;
          entries.delete(key); entries.set(key, byId.get(segment.id));
        }
        let trimmed = false;
        while (entries.size > VIDEO_CACHE_LIMITS.entries) { entries.delete(entries.keys().next().value); trimmed = true; }
        video.entries = [...entries]; state.videos = state.videos.filter(v => v !== video); state.videos.push(video);
        while (state.videos.length > VIDEO_CACHE_LIMITS.videos) state.videos.shift();
        while (size(state) > VIDEO_CACHE_LIMITS.bytes && state.videos.length > 1) { state.videos.shift(); trimmed = true; }
        while (size(state) > VIDEO_CACHE_LIMITS.bytes && video.entries.length) { video.entries.shift(); trimmed = true; }
        return (await persist()) || trimmed;
      });
    },
    summary() { return locked(async () => { await load(); return { videos: state.videos.length, bytes: size(state), maxVideos: VIDEO_CACHE_LIMITS.videos, maxBytes: VIDEO_CACHE_LIMITS.bytes, warning }; }); },
    clear() { return locked(async () => { epoch++; await area.remove(storageKey); state = empty(); warning = false; return { cleared: true }; }); }
  });
}
