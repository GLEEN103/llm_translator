(() => {
  if (globalThis.TranslatorYouTubeLauncher || window.top !== window) return;
  function currentVideoId() {
    const url = new URL(location.href);
    return url.origin === 'https://www.youtube.com' && !url.username && !url.password ? globalThis.TranslatorYouTubeDOM.videoId() : null;
  }
  function install({ getVideoId = currentVideoId } = {}) {
    let host, button, notice, videoId, pending = false, disposed = false, timer, interval, noticeTimer, generation = 0;
    const visible = node => node && node.getClientRects().length && node.getBoundingClientRect().width > 0;
    const remove = () => { host?.remove(); host = null; videoId = null; pending = false; generation++; clearTimeout(noticeTimer); };
    function create(id) {
      videoId = id; host = document.createElement('span'); host.setAttribute('data-llm-translator-root', 'youtube-launcher');
      host.style.cssText = 'all:initial;display:inline-flex!important;align-items:center;position:relative;z-index:1;flex:0 0 auto;margin:0 8px;vertical-align:middle;pointer-events:auto!important;';
      const shadow = host.attachShadow({ mode: 'closed' }), style = document.createElement('style');
      style.textContent = `button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;font:500 14px/20px system-ui;height:40px;white-space:nowrap;margin:0;border:0;border-radius:999px;padding:0 16px;background:var(--launcher-bg,#f2f2f2);color:var(--launcher-fg,#0f0f0f);cursor:pointer;pointer-events:auto;appearance:none}button:hover{background:var(--launcher-hover,#e5e5e5)}button:focus-visible{outline:2px solid #3ea6ff;outline-offset:2px}button:disabled{opacity:.65;cursor:wait}p{position:absolute;z-index:1000;top:calc(100% + 4px);right:0;width:240px;box-sizing:border-box;margin:0;padding:10px;border-radius:8px;background:#182131;color:#fff;box-shadow:0 3px 12px #0005;font:13px/1.5 system-ui;white-space:normal}[hidden]{display:none}`;
      button = document.createElement('button'); button.type = 'button'; button.textContent = '자막 번역'; button.title = 'YouTube 자막 번역 설정 열기/숨기기';
      notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.hidden = true;
      button.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        event.preventDefault(); event.stopPropagation();
        if (getVideoId() !== id) return;
        // Reopening an existing panel is local UI work, independent of worker startup/reinjection.
        if (globalThis.TranslatorVideoPanel?.toggle(id)) { notice.hidden = true; refresh(); return; }
        if (pending) return;
        pending = true; button.disabled = true; button.textContent = '여는 중…'; notice.hidden = true;
        const run = generation; let requestTimer;
        try {
          const result = await Promise.race([chrome.runtime.sendMessage({ type: 'OPEN_VIDEO_INLINE', videoId: id }),
            new Promise((_, reject) => { requestTimer = setTimeout(() => reject({ code: 'OPEN_TIMEOUT' }), 20000); })]);
          if (disposed || generation !== run || getVideoId() !== id) return;
          if (!result?.ok) throw { code: result?.error };
          if (result.data?.needsSettings) showNotice('열린 확장 설정에서 API 키와 전송 동의를 확인한 뒤 다시 눌러 주세요.');
        } catch (error) {
          if (disposed || generation !== run || getVideoId() !== id) return;
          showNotice(['VIDEO_CHANGED', 'PAGE_CHANGED'].includes(error?.code) ? '영상이 변경되었습니다. 현재 영상에서 다시 눌러 주세요.' :
            ['PANEL_OPEN_TIMEOUT', 'OPEN_TIMEOUT'].includes(error?.code) ? '패널 열기가 지연되었습니다. 버튼을 다시 눌러 재시도하세요.' : '번역 패널을 열지 못했습니다. 버튼을 다시 눌러 재시도하세요. 계속 실패하면 확장과 페이지를 새로고침해 주세요.');
        } finally {
          clearTimeout(requestTimer);
          if (generation === run && !disposed) { pending = false; button.disabled = false; refresh(); }
        }
      });
      shadow.append(style, button, notice);
    }
    function showNotice(text) {
      notice.textContent = text; notice.hidden = false; clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => { if (notice) notice.hidden = true; }, 8000);
    }
    function refresh() {
      timer = null; if (disposed) return;
      const id = getVideoId(), surface = globalThis.TranslatorYouTubeDOM.surface();
      const shorts = location.pathname.startsWith('/shorts/');
      if (!id) { if (host) remove(); return; }
      const row = shorts ? [...document.querySelectorAll('ytd-shorts reel-action-bar-view-model'), ...(surface?.scope?.querySelectorAll('#actions') ?? [])].find(node => globalThis.TranslatorYouTubeDOM.area(node) > 0) :
        [...document.querySelectorAll('ytd-watch-metadata #top-level-buttons-computed, ytd-video-primary-info-renderer #top-level-buttons-computed')].find(visible);
      if (!row) { if (host) remove(); return; }
      if (videoId !== id) remove();
      if (!host) create(id);
      const panelOpen = globalThis.TranslatorVideoPanel?.isOpen(id);
      button.setAttribute('aria-expanded', String(panelOpen === true));
      button.disabled = pending && panelOpen == null;
      const like = row.querySelector('like-button-view-model, segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer, #segmented-like-button, #like-button');
      let anchor = like;
      while (anchor && anchor.parentElement !== row) anchor = anchor.parentElement;
      if (anchor) { if (anchor.nextElementSibling !== host) anchor.after(host); }
      else if (host.parentElement !== row || row.lastElementChild !== host) row.append(host);
      const reference = like?.querySelector('button') ?? [...row.querySelectorAll('button')].find(visible);
      const computed = reference ? getComputedStyle(reference) : null;
      const bounded = (value, min, max, fallback) => { const n = parseFloat(value); return Number.isFinite(n) && n >= min && n <= max ? n : fallback; };
      const height = bounded(reference?.offsetHeight, 28, 64, 40);
      button.style.height = `${height}px`;
      button.style.width = shorts ? `${height}px` : '';
      button.style.padding = shorts ? '0' : '0 16px';
      host.style.margin = shorts ? '8px 0' : '0 8px';
      button.setAttribute('aria-label', shorts ? 'Shorts 자막 번역' : '자막 번역');
      if (!pending || panelOpen != null) button.textContent = shorts ? '번역' : '자막 번역';
      button.style.fontSize = `${bounded(computed?.fontSize, 12, 28, 14)}px`;
      button.style.fontFamily = computed?.fontFamily || 'system-ui'; button.style.fontWeight = computed?.fontWeight || '500';
      const dark = document.documentElement.hasAttribute('dark') || document.body?.hasAttribute('dark');
      host.style.setProperty('--launcher-fg', dark ? '#f1f1f1' : '#0f0f0f');
      host.style.setProperty('--launcher-bg', dark ? '#272727' : '#f2f2f2');
      host.style.setProperty('--launcher-hover', dark ? '#3f3f3f' : '#e5e5e5');
    }
    const schedule = () => { if (!disposed && timer == null) timer = setTimeout(refresh, 250); };
    const observer = new MutationObserver(schedule);
    const themeObserver = new MutationObserver(schedule);
    const resume = () => { if (disposed) return; observer.observe(document.documentElement, { childList: true, subtree: true });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['dark', 'class', 'style'] });
      if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['dark', 'class', 'style'] });
      clearInterval(interval); interval = setInterval(schedule, 2000); schedule(); };
    const pause = () => { observer.disconnect(); themeObserver.disconnect(); clearInterval(interval); clearTimeout(timer); timer = null; remove(); };
    window.addEventListener('yt-navigate-finish', schedule); window.addEventListener('popstate', schedule);
    window.addEventListener('pageshow', resume); window.addEventListener('pagehide', pause);
    resume();
    return { refresh, dispose() { disposed = true; pause(); window.removeEventListener('yt-navigate-finish', schedule); window.removeEventListener('popstate', schedule); window.removeEventListener('pageshow', resume); window.removeEventListener('pagehide', pause); } };
  }
  globalThis.TranslatorYouTubeLauncher = Object.freeze({ install, currentVideoId });
  if (location.origin === 'https://www.youtube.com') install();
})();
