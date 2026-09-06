(() => {
  if (globalThis.TranslatorYouTubeDOM) return;
  function videoId(value = location.href) {
    try {
      const u = new URL(value), id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/shorts\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
      return /^[\w-]{11}$/.test(id ?? '') ? id : null;
    } catch { return null; }
  }
  function area(node) {
    if (!node?.getClientRects().length) return 0;
    const r = node.getBoundingClientRect();
    return Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
  }
  function surface() {
    const shorts = location.pathname.startsWith('/shorts/');
    const players = shorts ? [...document.querySelectorAll('#shorts-player, ytd-reel-video-renderer .html5-video-player')] : [document.getElementById('movie_player')];
    const choices = players.filter(Boolean).map(player => ({ player, video: player.querySelector('video'), shorts, scope: player.closest('ytd-reel-video-renderer') }));
    return choices.filter(item => item.video && (!shorts || area(item.video) > 0)).sort((a, b) => area(b.video) - area(a.video))[0] ?? null;
  }
  function createBinding(expectedId, { now = Date.now } = {}) {
    let candidate, since = 0;
    return { poll() {
      if (videoId() !== expectedId) return { ended: true, ready: false };
      const item = surface(), rect = item?.video.getBoundingClientRect();
      if (!item?.video.isConnected || !item.player.isConnected || !rect || rect.width < 80 || rect.height < 60) {
        candidate = null; return { ended: false, ready: false };
      }
      if (candidate?.video !== item.video || candidate?.player !== item.player) { candidate = item; since = now(); }
      return { ended: false, ready: now() - since >= 200, ...item };
    } };
  }
  globalThis.TranslatorYouTubeDOM = Object.freeze({ videoId, surface, area, createBinding });
})();
