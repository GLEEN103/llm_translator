import { AppError } from './contract.mjs';
import './video-core.js';
import { readYouTubePlayerCaptions } from './youtube-player-captions.mjs';

export function youtubeId(value) {
  try {
    const url = new URL(value);
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    return url.origin === 'https://www.youtube.com' && !url.username && !url.password && /^[\w-]{11}$/.test(id ?? '') ? id : null;
  } catch { return null; }
}

// Serialized by chrome.scripting. No extension secrets, grants or closure variables.
export async function readYouTubePage(videoId, trackIndex = null) {
  const failure = error => ({ error });
  const selectPlayer = () => {
    if (!new URL(location.href).pathname.startsWith('/shorts/')) return document.getElementById('movie_player');
    const candidates = [...document.querySelectorAll('#shorts-player, ytd-reel-video-renderer .html5-video-player')];
    const area = node => {
      const video = node.querySelector('video'); if (!video?.getClientRects().length) return 0;
      const r = video.getBoundingClientRect();
      return Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
    };
    return candidates.filter(p => area(p) > 0).sort((a, b) => area(b) - area(a))[0];
  };

  const currentId = () => {
    const url = new URL(location.href);
    if (url.origin !== 'https://www.youtube.com' || url.username || url.password) return null;
    return url.pathname === '/watch' ? url.searchParams.get('v') : /^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  };
  try {
    if (currentId() !== videoId) return failure('VIDEO_CHANGED');
    const player = selectPlayer();
    if (player?.classList.contains('ad-showing')) return failure('VIDEO_AD');
    const response = player?.getPlayerResponse?.() ?? globalThis.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId !== videoId) return failure('VIDEO_CHANGED');
    if (response.videoDetails.isLive === true || response.playabilityStatus?.liveStreamability) return failure('VIDEO_LIVE');
    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return failure('CAPTIONS_EMPTY');
    if (tracks.length > 200) return failure('CAPTIONS_INVALID');
    if (trackIndex === null) return { videoId, tracks: tracks.map((track, index) => ({ index,
      label: String(track.name?.simpleText ?? track.name?.runs?.map(run => run.text).join('') ?? track.languageCode ?? '').slice(0, 160),
      language: String(track.languageCode ?? '').slice(0, 40), automatic: track.kind === 'asr' })) };
    if (!Number.isInteger(trackIndex) || !tracks[trackIndex]) return failure('CAPTIONS_INVALID');
    const source = tracks[trackIndex].baseUrl;
    if (typeof source !== 'string' || source.length > 16384) return failure('CAPTIONS_INVALID');
    const url = new URL(source);
    if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/api/timedtext' || url.username || url.password ||
        url.searchParams.get('v') !== videoId) return failure('CAPTIONS_INVALID');
    url.searchParams.set('fmt', 'json3'); url.searchParams.delete('tlang');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const fetched = await fetch(url.href, { credentials: 'same-origin', redirect: 'error', signal: controller.signal });
      if (!fetched.ok || !fetched.body) return failure('CAPTIONS_UNAVAILABLE');
      if (Number(fetched.headers.get('content-length')) > 2097152) return failure('CAPTIONS_TOO_LARGE');
      const reader = fetched.body.getReader(), decoder = new TextDecoder(); let raw = '', bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 2097152) { await reader.cancel(); return failure('CAPTIONS_TOO_LARGE'); }
          raw += decoder.decode(value, { stream: true });
        }
      } finally { reader.releaseLock(); }
      raw += decoder.decode();
      const after = player?.getPlayerResponse?.() ?? globalThis.ytInitialPlayerResponse;
      if (selectPlayer() !== player || currentId() !== videoId || after?.videoDetails?.videoId !== videoId) return failure('VIDEO_CHANGED');
      if (!raw.trim()) return failure('CAPTIONS_DIRECT_EMPTY');
      return { videoId, raw };
    } finally { clearTimeout(timer); }
  } catch { return failure('CAPTIONS_UNAVAILABLE'); }
}

export async function loadYouTubeCaptions({ chrome, tabId, documentId, videoId, trackIndex = null }) {
  if (!/^[\w-]{11}$/.test(videoId ?? '') || (trackIndex !== null && (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= 200))) throw new AppError('CAPTIONS_INVALID');
  async function execute(func) {
    let timer;
    try {
      const [entry] = await Promise.race([chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, world: 'MAIN',
        func, args: [videoId, trackIndex] }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 16000); })]);
      return entry;
    } catch { throw new AppError('CAPTIONS_BRIDGE_FAILED'); }
    finally { clearTimeout(timer); }
  }
  let entry = await execute(readYouTubePage);
  if (entry?.documentId !== documentId) throw new AppError('VIDEO_CHANGED');
  if (trackIndex !== null && ['CAPTIONS_DIRECT_EMPTY', 'CAPTIONS_UNAVAILABLE'].includes(entry?.result?.error)) entry = await execute(readYouTubePlayerCaptions);
  const data = entry?.result;
  if (entry?.documentId !== documentId) throw new AppError('VIDEO_CHANGED');
  if (data?.error) throw new AppError(['VIDEO_CHANGED', 'VIDEO_AD', 'VIDEO_LIVE', 'CAPTIONS_EMPTY', 'CAPTIONS_INVALID', 'CAPTIONS_TOO_LARGE', 'CAPTIONS_PLAYER_UNAVAILABLE', 'CAPTIONS_PLAYER_TIMEOUT'].includes(data.error) ? data.error : 'CAPTIONS_UNAVAILABLE');
  if (data?.videoId !== videoId) throw new AppError('VIDEO_CHANGED');
  if (trackIndex === null) {
    if (!Array.isArray(data.tracks) || !data.tracks.length || data.tracks.length > 200 || data.tracks.some((t, i) =>
      t?.index !== i || typeof t.label !== 'string' || t.label.length > 160 || typeof t.language !== 'string' || t.language.length > 40 || typeof t.automatic !== 'boolean')) throw new AppError('CAPTIONS_INVALID');
    return { videoId, tracks: data.tracks.map(t => ({ index: t.index, label: t.label, language: t.language, automatic: t.automatic })) };
  }
  if (typeof data.raw !== 'string' || new TextEncoder().encode(data.raw).length > 2097152) throw new AppError('CAPTIONS_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(data.raw); } catch { throw new AppError('CAPTIONS_INVALID'); }
  try { return { videoId, cues: globalThis.TranslatorVideoCore.parse(parsed), ...(data.source === 'player' ? { source: 'player', playerTrackChanged: data.playerTrackChanged === true } : {}) }; }
  catch (error) { throw new AppError(['CAPTIONS_TOO_LARGE', 'CAPTIONS_EMPTY'].includes(error.code) ? error.code : 'CAPTIONS_INVALID'); }
}
