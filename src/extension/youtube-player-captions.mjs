// Runs as one bounded MAIN-world call. Only the current video's selected captions
// are observed; no request headers, cookies, tokens or URLs leave this function.
export async function readYouTubePlayerCaptions(videoId, trackIndex) {
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

  let player;
  const current = () => {
    try {
      const u = new URL(location.href);
      const id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/shorts\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
      return u.origin === 'https://www.youtube.com' && !u.username && !u.password && id === videoId &&
        (!player || (selectPlayer() === player && (player.getPlayerResponse?.() ?? globalThis.ytInitialPlayerResponse)?.videoDetails?.videoId === videoId));
    } catch { return false; }
  };
  try {
    if (!current()) return failure('VIDEO_CHANGED');
    player = selectPlayer();
    const response = player?.getPlayerResponse?.() ?? globalThis.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId !== videoId) return failure('VIDEO_CHANGED');
    if (response.videoDetails.isLive === true || response.playabilityStatus?.liveStreamability) return failure('VIDEO_LIVE');
    if (player?.classList.contains('ad-showing')) return failure('VIDEO_AD');
    const track = response.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[trackIndex];
    if (!track || typeof player?.setOption !== 'function') return failure('CAPTIONS_PLAYER_UNAVAILABLE');
    const base = new URL(track.baseUrl);
    if (base.origin !== 'https://www.youtube.com' || base.username || base.password || base.pathname !== '/api/timedtext' || base.searchParams.get('v') !== videoId) return failure('CAPTIONS_INVALID');
    const matches = value => {
      try {
        const u = new URL(value, location.href);
        return u.origin === base.origin && !u.username && !u.password && u.pathname === base.pathname &&
          u.searchParams.get('v') === videoId && u.searchParams.get('lang') === base.searchParams.get('lang') &&
          u.searchParams.get('kind') === base.searchParams.get('kind') && u.searchParams.get('variant') === base.searchParams.get('variant') &&
          !u.searchParams.has('tlang');
      } catch { return false; }
    };
    const identity = t => t && typeof t.languageCode === 'string' ? `${t.languageCode}:${t.kind ?? ''}:${t.vssId ?? ''}:${t.translationLanguage?.languageCode ?? ''}` : '';
    let previous;
    try { const value = player.getOption?.('captions', 'track'); previous = value && typeof value === 'object' ? { ...value } : value; } catch { /* restoration is optional */ }
    const ccPressed = player.querySelector?.('.ytp-subtitles-button')?.getAttribute('aria-pressed');
    let moduleWasOff = false;
    try { moduleWasOff = typeof player.getOptions === 'function' && !player.getOptions().includes('captions'); } catch {}
    const wasOff = ccPressed === 'false' || (ccPressed !== 'true' && (moduleWasOff || (previous !== undefined && !identity(previous))));
    const desired = { languageCode: track.languageCode, ...(track.kind ? { kind: track.kind } : {}), ...(track.vssId ? { vssId: track.vssId } : {}) };
    const isDesired = t => t?.languageCode === desired.languageCode && !t.translationLanguage?.languageCode &&
      (!t.kind || t.kind === (desired.kind ?? '')) && (!t.vssId || !desired.vssId || t.vssId === desired.vssId);
    const originalFetch = globalThis.fetch, proto = globalThis.XMLHttpRequest?.prototype;
    const originalOpen = proto?.open, originalSend = proto?.send;
    const opened = new WeakMap(), listeners = new Map(), readers = new Set();
    let alive = true, timer, navigation, triggerTimer, recoveryTimer, chosenIdentity = '', userChanged = false, selecting = false, reloaded = false, loadedByUs = false;
    return await new Promise(resolve => {
      const userControl = event => {
        if (event.isTrusted && event.target?.closest?.('.ytp-subtitles-button, .ytp-settings-menu')) userChanged = true;
      };
      function finish(result) {
        if (!alive) return;
        alive = false; clearTimeout(timer); clearTimeout(triggerTimer); clearTimeout(recoveryTimer); clearInterval(navigation);
        document.removeEventListener?.('click', userControl, true);
        if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
        if (proto?.open === wrappedOpen) proto.open = originalOpen;
        if (proto?.send === wrappedSend) proto.send = originalSend;
        for (const [xhr, listener] of listeners) xhr.removeEventListener('loadend', listener);
        listeners.clear();
        for (const reader of readers) { void reader.cancel().catch(() => {}); } readers.clear();
        // Do not undo a subsequent user track change. If introspection is missing,
        // leave the chosen source track visible and report that to the overlay.
        let restored = false;
        if (current() && !userChanged && (previous !== undefined || wasOff)) {
          try {
            const active = player.getOption?.('captions', 'track');
            const owned = chosenIdentity ? identity(active) === chosenIdentity :
              (selecting && isDesired(active)) || (wasOff && loadedByUs && (!identity(active) || isDesired(active)));
            if (owned) {
              if (wasOff && typeof player.unloadModule === 'function') player.unloadModule('captions');
              else player.setOption('captions', 'track', wasOff ? {} : previous);
              restored = true;
            }
          } catch { /* surface the possible UI change without leaking page errors */ }
        }
        resolve({ ...result, ...(!result.error ? { source: 'player', playerTrackChanged: !restored } : {}) });
      }
      function accept(raw) {
        if (!alive) return;
        if (!current()) { finish(failure('VIDEO_CHANGED')); return; }
        if (typeof raw !== 'string' || !raw.trim()) return;
        if (new TextEncoder().encode(raw).length > 2097152) { finish(failure('CAPTIONS_TOO_LARGE')); return; }
        if (raw.trimStart().startsWith('<')) {
          try {
            // DOMParser is local and does not execute scripts or load resources.
            if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('invalid');
            const xml = new DOMParser().parseFromString(raw, 'text/xml');
            if (xml.querySelector('parsererror')) throw new Error('invalid');
            const root = xml.documentElement;
            const modern = root.tagName === 'timedtext', legacy = root.tagName === 'transcript';
            if (!modern && !legacy) throw new Error('invalid');
            const nodes = [...xml.querySelectorAll(modern ? 'body > p' : 'transcript > text')];
            if (!nodes.length) return;
            if (nodes.length > 5000) { finish(failure('CAPTIONS_TOO_LARGE')); return; }
            const number = (node, name) => node.hasAttribute(name) ? Number(node.getAttribute(name)) : NaN;
            const events = nodes.filter(node => node.textContent.trim()).map(node => ({ tStartMs: number(node, modern ? 't' : 'start') * (modern ? 1 : 1000),
              ...(modern && !node.hasAttribute('d') && node.getAttribute('a') === '1' ? {} : { dDurationMs: number(node, modern ? 'd' : 'dur') * (modern ? 1 : 1000) }),
              segs: [{ utf8: node.textContent }],
              ...(modern && node.hasAttribute('w') ? { wWinId: node.getAttribute('w') } : {}),
              ...(modern && node.getAttribute('a') === '1' ? { aAppend: 1 } : {}) }));
            if (events.some(e => !Number.isFinite(e.tStartMs) || (e.dDurationMs !== undefined && !Number.isFinite(e.dDurationMs)))) throw new Error('invalid');
            if (!events.length) return;
            raw = JSON.stringify({ events });
          } catch { finish(failure('CAPTIONS_INVALID')); return; }
        }
        if (!raw.trimStart().startsWith('{')) { finish(failure('CAPTIONS_INVALID')); return; }
        try {
          const data = JSON.parse(raw);
          if (!Array.isArray(data.events)) { finish(failure('CAPTIONS_INVALID')); return; }
          if (!data.events.some(event => event?.segs?.some(segment => typeof segment?.utf8 === 'string' && segment.utf8.trim()))) return;
        } catch { finish(failure('CAPTIONS_INVALID')); return; }
        finish({ videoId, raw });
      }
      async function copyResponse(response) {
        let reader;
        try {
          if (!alive || !response.ok || !matches(response.url)) return;
          if (Number(response.headers.get('content-length')) > 2097152) { finish(failure('CAPTIONS_TOO_LARGE')); return; }
          reader = response.clone().body?.getReader(); if (!reader) return; readers.add(reader);
          const decoder = new TextDecoder(); let raw = '', bytes = 0;
          while (alive) {
            const { done, value } = await reader.read(); if (done) break;
            bytes += value.byteLength;
            if (bytes > 2097152) { finish(failure('CAPTIONS_TOO_LARGE')); return; }
            raw += decoder.decode(value, { stream: true });
          }
          if (alive) accept(raw + decoder.decode());
        } catch { /* keep waiting for a successful native caption response */ }
        finally { if (reader) { readers.delete(reader); try { reader.releaseLock(); } catch {} } }
      }
      function wrappedFetch(...args) {
        const pending = Reflect.apply(originalFetch, this, args);
        try {
          if (alive && matches(typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url)) {
            void pending.then(copyResponse, () => {});
          }
        } catch { /* observation must not break the page's request */ }
        return pending;
      }
      function wrappedOpen(method, url, ...args) {
        // Delete old state if an XMLHttpRequest instance is reused for another URL.
        opened.delete(this);
        if (alive && String(method).toUpperCase() === 'GET' && matches(url)) opened.set(this, true);
        return Reflect.apply(originalOpen, this, [method, url, ...args]);
      }
      function wrappedSend(...args) {
        if (alive && opened.has(this)) {
          const xhr = this;
          const listener = () => {
            listeners.delete(xhr);
            if (!alive || xhr.status !== 200 || !matches(xhr.responseURL)) return;
            try {
              if (!xhr.responseType || xhr.responseType === 'text') accept(xhr.responseText);
              else if (xhr.responseType === 'json') accept(JSON.stringify(xhr.response));
              else if (xhr.responseType === 'arraybuffer') {
                if (xhr.response.byteLength > 2097152) finish(failure('CAPTIONS_TOO_LARGE'));
                else accept(new TextDecoder().decode(xhr.response));
              }
            } catch { /* ignore unreadable responses without interfering with the player */ }
          };
          if (listeners.has(xhr)) xhr.removeEventListener('loadend', listeners.get(xhr));
          listeners.set(xhr, listener); xhr.addEventListener('loadend', listener, { once: true });
        }
        return Reflect.apply(originalSend, this, args);
      }
      timer = setTimeout(() => finish(failure('CAPTIONS_PLAYER_TIMEOUT')), 12000);
      navigation = setInterval(() => { if (!current()) finish(failure('VIDEO_CHANGED')); }, 250);
      try {
        document.addEventListener?.('click', userControl, true);
        if (typeof originalFetch === 'function') globalThis.fetch = wrappedFetch;
        if (proto) { proto.open = wrappedOpen; proto.send = wrappedSend; }
        if ((moduleWasOff || typeof player.getOptions !== 'function') && typeof player.loadModule === 'function') { loadedByUs = true; player.loadModule('captions'); }
        const trigger = () => {
          if (!alive || !current() || userChanged) return;
          try {
            if (typeof player.getOptions === 'function' && !player.getOptions().includes('captions')) {
              triggerTimer = setTimeout(trigger, 250); return;
            }
            const selected = player.getOption?.('captions', 'track');
            if (chosenIdentity && identity(selected) !== chosenIdentity) { userChanged = true; return; }
            if (!selecting) {
              selecting = true;
              player.setOption('captions', 'track', desired);
            }
            // A module name alone does not mean the asynchronous track selection
            // has finished. Reload only after our chosen track is actually active.
            const active = player.getOption?.('captions', 'track');
            if (typeof player.getOption === 'function' && !isDesired(active)) {
              if (identity(active) && identity(active) !== identity(previous)) { userChanged = true; return; }
              triggerTimer = setTimeout(trigger, 250); return;
            }
            chosenIdentity = identity(active);
            if (!reloaded) { reloaded = true; player.setOption('captions', 'reload', true); }
            if (alive) triggerTimer = setTimeout(trigger, 250);
          } catch { finish(failure('CAPTIONS_PLAYER_UNAVAILABLE')); }
        };
        // One bounded module reset clears an unresponsive cold-start/cache state.
        // It never reloads the video and never overwrites a detected user change.
        recoveryTimer = setTimeout(() => {
          if (!alive || !current() || userChanged || typeof player.unloadModule !== 'function' || typeof player.loadModule !== 'function') return;
          try {
            const active = identity(player.getOption?.('captions', 'track'));
            if (chosenIdentity ? active !== chosenIdentity : active && active !== identity(previous) && active !== identity(desired)) return;
            clearTimeout(triggerTimer); chosenIdentity = ''; selecting = false; reloaded = false;
            player.unloadModule('captions'); loadedByUs = true; player.loadModule('captions');
            triggerTimer = setTimeout(trigger, 250);
          } catch { finish(failure('CAPTIONS_PLAYER_UNAVAILABLE')); }
        }, 4000);
        // Caption module initialization is asynchronous on some player versions.
        triggerTimer = setTimeout(trigger, 250);
      } catch { finish(failure('CAPTIONS_PLAYER_UNAVAILABLE')); }
    });
  } catch { return failure('CAPTIONS_PLAYER_UNAVAILABLE'); }
}
