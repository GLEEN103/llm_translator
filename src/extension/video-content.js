(() => {
  if (globalThis.__translatorVideoInstalled) return;
  globalThis.__translatorVideoInstalled = true;
  const Core = globalThis.TranslatorCore, Video = globalThis.TranslatorVideoCore;
  let state;
  const languageNames = [['ko', '한국어'], ['en', 'English'], ['ja', '日本語'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español']];
  function videoId() {
    return globalThis.TranslatorYouTubeDOM.videoId();
  }
  function send(s, type, extra = {}) {
    return Core.requestMessage(chrome.runtime, { type, grant: s.grant, ...extra });
  }
  function cancel(s) {
    s.generation++; s.session?.stop();
  }
  function close(s) {
    if (state !== s) return;
    cancel(s); s.session?.dispose(); flushStyle(s); cancelAnimationFrame(s.frame); s.events.abort(); s.mediaEvents?.abort(); s.host.remove(); state = null;
    s.cues = []; s.segments = []; s.results.clear();
  }
  function reset(s) {
    cancel(s); s.session?.reset(); s.cues = []; s.ends = []; s.segments = []; s.results.clear(); s.caption.textContent = ''; s.caption.hidden = true;
    s.sourceNote.textContent = ''; s.status.textContent = '자막과 목표 언어를 선택하고 번역을 ON으로 켜세요.';
  }
  function render(s) {
    if (state !== s) return;
    const binding = s.binding.poll();
    if (binding.ended) { close(s); return; }
    const wasReady = s.surfaceReady; s.surfaceReady = binding.ready;
    if (binding.ready && (s.video !== binding.video || s.player !== binding.player)) {
      s.mediaEvents?.abort(); s.mediaEvents = new AbortController(); s.video = binding.video; s.player = binding.player;
      s.video.addEventListener('seeked', () => s.session.wake(), { signal: s.mediaEvents.signal });
    }
    if (!binding.ready) { s.mediaEvents?.abort(); s.video = null; s.player = null; }
    if (binding.ready && !wasReady) {
      if (s.revealWhenReady && !s.panel.hidden) s.showPanel();
      s.session.wake();
    }
    const width = Math.min(390, Math.max(160, innerWidth - 24));
    const rect = binding.ready ? s.video.getBoundingClientRect() : { left: Math.max(12, innerWidth - width - 12), top: 12, width, height: Math.max(180, Math.min(560, innerHeight - 24)) };
    // Fixed positioning follows theatre mode/scroll without modifying the player layout.
    const geometry = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
    if (s.geometry !== geometry) {
      Object.assign(s.host.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      s.geometry = geometry;
    }
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen && (!s.video || fullscreen.contains(s.video)) && fullscreen !== s.video ? fullscreen : document.documentElement;
    if (s.host.parentNode !== parent) parent.append(s.host);
    s.host.style.visibility = 'visible';
    s.start.disabled = !s.running && (!binding.ready || !s.track.options.length);
    if (!binding.ready) {
      s.caption.hidden = true; s.timing.textContent = '영상 플레이어 준비 중 · 설정 UI는 계속 사용할 수 있습니다.';
      s.frame = requestAnimationFrame(() => render(s)); return;
    }
    if (!s.running && !s.track.options.length && !s.loadingTracks && s.trackAttempts < 3 && Date.now() >= s.nextTracks) void loadTracks(s);
    const ad = s.player.classList.contains('ad-showing') || s.player.classList.contains('ad-interrupting');
    const active = Video.active(s.cues, s.ends, s.video.currentTime);
    const hasFailure = active.some(c => c.parts.some(id => s.failed?.has(id)));
    const ready = active.length && active.every(c => c.parts.every(id => s.results.has(id) || s.failed?.has(id)));
    const caption = ready ? active.map(c => c.parts.map(id => s.failed?.has(id) ? '[번역 오류]' : s.results.get(id)).join(' ')).join('\n') : '';
    if (s.caption.textContent !== caption) s.caption.textContent = caption;
    // Keep large/multi-line captions inside the video at extreme positions.
    const half = s.captionBox.getBoundingClientRect().height / 2;
    const center = Math.max(half + 4, Math.min(rect.height - half - 4, rect.height * s.appearance.vertical / 100));
    const top = `${center}px`; if (s.captionBox.style.top !== top) s.captionBox.style.top = top;
    s.caption.hidden = s.displaySuppressed || !s.visible || ad || !s.video.readyState || s.video.ended || s.video.seeking || !caption || document.pictureInPictureElement === s.video;
    s.host.style.visibility = rect.width < 80 || rect.height < 60 ? 'hidden' : 'visible';
    const note = ad ? '광고 재생 중 · 번역 자막 숨김' : document.pictureInPictureElement === s.video ? 'PIP 창은 자막 오버레이를 지원하지 않습니다.' :
      hasFailure ? '현재 구간 번역 실패 · 오류 로그를 확인하세요.' : active.length && !ready && s.cues.length && s.running ? '현재 구간 번역 준비 중…' : '';
    if (s.timing.textContent !== note) s.timing.textContent = note;
    s.frame = requestAnimationFrame(() => render(s));
  }
  async function loadTracks(s) {
    if (s.loadingTracks) return;
    if (!s.surfaceReady) { s.status.textContent = '영상이 준비되면 자막 목록을 자동으로 확인합니다.'; return; }
    s.trackAttempts++;
    s.loadingTracks = true;
    reset(s); s.start.disabled = true; s.reload.disabled = true;
    const generation = s.generation;
    s.status.textContent = 'YouTube 자막 목록을 불러오는 중…'; s.track.replaceChildren();
    try {
      const data = await send(s, 'VIDEO_TRACKS', { videoId: s.videoId });
      if (state !== s || generation !== s.generation) return;
      for (const track of [...data.tracks].sort((a, b) => Number(a.automatic) - Number(b.automatic))) {
        const option = document.createElement('option'); option.value = String(track.index);
        option.textContent = `${track.label || track.language}${track.automatic ? ' (자동 생성)' : ' (제작자 자막)'}`; s.track.append(option);
      }
      s.status.textContent = '번역 OFF · ON으로 켜면 새 자막을 자동 확인하고 미번역 텍스트를 설정한 번역 공급자로 전송합니다.';
      s.start.disabled = false;
    } catch (error) { if (state === s && generation === s.generation) s.status.textContent = Core.errorMessage(error.code); }
    finally { s.loadingTracks = false; s.nextTracks = Date.now() + 1000 * s.trackAttempts; if (state === s) s.reload.disabled = false; }
  }
  function attachSession(s) {
    s.session = globalThis.TranslatorVideoSession.create({
      context: () => ({ time: s.video?.currentTime ?? 0, suspended: !s.surfaceReady || document.hidden || s.player?.classList.contains('ad-showing') || s.player?.classList.contains('ad-interrupting') }),
      status: () => send(s, 'CONTENT_STATUS'),
      read: async () => {
        const data = await send(s, 'VIDEO_CAPTIONS', { videoId: s.videoId, trackIndex: Number(s.track.value) });
        if (state === s && s.running) s.sourceNote.textContent = data.playerTrackChanged ? 'YouTube 원문 자막이 선택한 트랙으로 바뀔 수 있습니다.' : '';
        return data;
      },
      translate: (segments, settings, jobId) => send(s, 'TRANSLATE', { mode: 'video', videoId: s.videoId, body: {
        jobId, provider: settings.provider, model: settings.model, settingsRevision: settings.settingsRevision,
        sourceLanguage: 'auto', targetLanguage: s.target.value, segments
      } }),
      cancel: jobId => { void send(s, 'CANCEL', { jobId }).catch(() => {}); },
      change: data => {
        if (state !== s) return;
        s.running = data.enabled; s.visible = data.enabled; s.cues = data.cues; s.segments = data.segments; s.results = data.results; s.ends = Video.index(data.cues);
        s.failed = data.failed;
        for (const record of data.logs) if (record.sequence > (s.lastLog ?? 0)) { s.logError(record); s.lastLog = record.sequence; }
        s.retryFailed.disabled = !data.failed.size || data.phase === 'translating' || data.phase === 'reading';
        s.cacheNote.textContent = data.cacheWarning ? '영상 캐시 용량 제한 또는 저장 오류로 일부 번역이 보존되지 않을 수 있습니다. 현재 결과는 유지됩니다.' : '최근 30개 영상의 번역을 이 기기에 저장해 재사용합니다. API 설정에서 삭제할 수 있습니다.';
        s.start.textContent = data.enabled ? '번역 ON' : '번역 OFF'; s.start.setAttribute('aria-pressed', String(data.enabled));
        s.reload.disabled = data.enabled;
        if (!data.enabled) { s.caption.hidden = true; s.status.textContent = data.error ? Core.errorMessage(data.error) + ' · 번역을 OFF로 전환했습니다.' : '번역 OFF · 자막과 목표 언어를 선택하고 ON으로 켜세요.'; }
        else if (data.error) s.status.textContent = Core.errorMessage(data.error) + ' · ON 유지, 잠시 후 자동 재시도합니다.';
        else if (data.phase === 'suspended') s.status.textContent = !s.surfaceReady ? '번역 ON · 플레이어가 준비되면 자동으로 계속합니다.' : '번역 ON · 숨겨진 탭 또는 광고가 끝나면 자동으로 계속합니다.';
        else if (data.phase === 'reading') s.status.textContent = '번역 ON · 새로 로드된 자막 확인 중…';
        else if (data.phase === 'translating') s.status.textContent = '번역 ON · ' + data.results.size + '/' + data.segments.length + '개 문장 번역 중…';
        else s.status.textContent = '번역 ON · ' + data.results.size + '/' + data.segments.length + '개 문장 준비 · 새 구간을 자동 확인합니다.';
        if (data.failed.size) s.status.textContent += ` · ${data.failed.size}구간 오류 (자동 요청 제외)`;
      }
    });
  }
  function styleControls(s) {
    const Style = globalThis.TranslatorVideoStyle;
    s.appearance = Style.normalize(); s.styleEdits = 0; s.styleWrites = Promise.resolve();
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '자막 세부 설정'; details.append(summary);
    const controls = new Map();
    s.styleStatus = document.createElement('p'); s.styleStatus.className = 'timing';
    const apply = () => { Style.apply(s.captionBox, s.caption, s.appearance); Style.apply(s.previewBox, s.preview, s.appearance); s.previewBox.style.top = 'auto'; s.previewBox.style.transform = 'none'; };
    function refresh() { for (const [key, record] of controls) { record.input.value = String(s.appearance[key]); if (record.output) record.output.textContent = record.input.value + record.unit; } apply(); }
    function save() {
      const value = { ...s.appearance }, edit = ++s.styleEdits;
      apply(); s.styleStatus.textContent = '표시 설정 저장 중…';
      clearTimeout(s.styleTimer);
      s.pendingStyle = { value, edit };
      s.styleTimer = setTimeout(() => flushStyle(s), 300);
    }
    function range(key, label, min, max, unit) {
      const row = document.createElement('label'); row.textContent = label + ' ';
      const output = document.createElement('output'), input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = '1'; input.setAttribute('aria-label', label);
      input.addEventListener('input', event => { if (!event.isTrusted) return; s.appearance[key] = Number(input.value); output.textContent = input.value + unit; save(); });
      row.append(output, input); controls.set(key, { input, output, unit }); details.append(row);
    }
    function select(key, label, choices) {
      const row = document.createElement('label'); row.textContent = label;
      const input = document.createElement('select'); input.setAttribute('aria-label', label);
      for (const [value, name] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = name; input.append(option); }
      input.addEventListener('change', event => { if (!event.isTrusted) return; s.appearance[key] = input.value; save(); });
      row.append(input); controls.set(key, { input }); details.append(row);
    }
    range('backgroundOpacity', '배경 불투명도', 0, 100, '%'); range('textOpacity', '글자 불투명도', 0, 100, '%');
    select('font', '서체', [['system', '시스템 기본'], ['sans', '고딕'], ['serif', '명조'], ['mono', '고정폭']]);
    range('size', '글씨 크기', 12, 64, 'px'); range('vertical', '세로 위치 (위 → 아래)', 5, 95, '%');
    select('align', '가로 정렬', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]);
    const previewLabel = document.createElement('p'); previewLabel.textContent = '미리보기';
    s.previewBox = document.createElement('div'); s.previewBox.className = 'style-preview'; s.preview = document.createElement('span'); s.preview.textContent = '번역 자막 미리보기'; s.previewBox.append(s.preview);
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '표시 설정 기본값'; reset.addEventListener('click', event => { if (!event.isTrusted) return; s.appearance = Style.normalize(); refresh(); save(); });
    details.append(previewLabel, s.previewBox, reset, s.styleStatus); refresh();
    void send(s, 'VIDEO_STYLE_GET').then(value => { if (state === s && s.styleEdits === 0) { s.appearance = Style.normalize(value); refresh(); } }).catch(() => { if (state === s) s.styleStatus.textContent = '저장한 표시 설정을 읽지 못해 기본값을 사용합니다.'; });
    return details;
  }
  function flushStyle(s) {
    clearTimeout(s.styleTimer);
    const pending = s.pendingStyle; if (!pending) return; s.pendingStyle = null;
    s.styleWrites = s.styleWrites.catch(() => {}).then(() => send(s, 'VIDEO_STYLE_SET', { style: pending.value })).then(() => {
      if (state === s && s.styleEdits === pending.edit) s.styleStatus.textContent = '이 브라우저에 저장됨';
    }).catch(() => { if (state === s) s.styleStatus.textContent = '표시 설정 저장에 실패했습니다. 현재 창에는 적용했습니다.'; });
  }
  function currentPanel(id) {
    return Boolean(state && state.videoId === id && videoId() === id && state.host.isConnected);
  }
  function restore(id) {
    if (!currentPanel(id)) return false;
    state.showPanel();
    if (!state.running && !state.track.options.length && !state.loadingTracks) void loadTracks(state);
    return true;
  }
  // Shared only with this extension's isolated-world launcher; never expose session data.
  function toggle(id) {
    if (!currentPanel(id)) return false;
    if (state.panel.hidden) restore(id); else state.panel.hidden = true;
    return true;
  }
  globalThis.TranslatorVideoPanel = Object.freeze({ restore, toggle,
    isOpen: id => currentPanel(id) ? !state.panel.hidden : null });
  function open(message) {
    if (state?.grant === message.grant && restore(message.videoId)) {
      return true;
    }
    if (state) close(state);
    if (videoId() !== message.videoId) return false;
    const host = document.createElement('div'); host.setAttribute('data-llm-translator-root', 'video');
    host.style.cssText = 'all:initial;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = `
      :host{color-scheme:dark} *{box-sizing:border-box} [hidden]{display:none!important}
      .panel{position:absolute;z-index:1;top:10px;right:10px;width:min(370px,calc(100% - 20px));max-height:65%;overflow:auto;background:rgba(18,23,32,.92);color:#fff;border:1px solid #78839a;border-radius:10px;padding:12px;font:13px/1.45 system-ui;pointer-events:auto;box-shadow:0 4px 18px #0005}
      header{display:flex;align-items:center;justify-content:space-between;gap:8px} strong{font-size:14px} button,select{font:inherit;color:#fff;border:1px solid #718096;border-radius:6px;background:#25334c;padding:5px 8px;max-width:100%} button{cursor:pointer} button:disabled{opacity:.5;cursor:default} select{width:100%;margin:4px 0 8px} label{display:block} .actions{display:flex;flex-wrap:wrap;gap:6px} p{margin:8px 0 0;white-space:pre-wrap} .caption{position:absolute;bottom:14%;left:5%;width:90%;text-align:center;white-space:pre-wrap;font:600 clamp(16px,2.3vw,28px)/1.45 system-ui;color:#fff;pointer-events:none;text-shadow:0 1px 3px #000}
      .caption{max-height:80%;overflow:hidden;overflow-wrap:anywhere}.caption span,.style-preview span{background:rgba(0,0,0,.72);padding:4px 10px;border-radius:5px;box-decoration-break:clone;-webkit-box-decoration-break:clone} .timing{color:#ffdda0;font-size:12px}
      details{margin-top:10px;border-top:1px solid #718096;padding-top:8px}summary{cursor:pointer;font-weight:600;margin-bottom:8px}input[type=range]{display:block;width:100%;margin:6px 0 12px}output{float:right}.style-preview{position:relative;margin:6px 0 12px;background:#47637c;padding:12px 4px;overflow-wrap:anywhere;line-height:1.45}
    `; shadow.append(style);
    const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label', 'YouTube 자막 번역');
    const header = document.createElement('header'), title = document.createElement('strong'); title.textContent = 'YouTube 자막 번역'; header.append(title);
    function button(text, callback) { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', event => { if (event.isTrusted) callback(); }); return node; }
    const s = { host, panel, player: null, video: null, binding: globalThis.TranslatorYouTubeDOM.createBinding(message.videoId), surfaceReady: false, trackAttempts: 0, nextTracks: 0,
      videoId: message.videoId, grant: message.grant, generation: 0, running: false, visible: false, cues: [], ends: [], segments: [], results: new Map(), events: new AbortController() }; state = s;
    const compact = button('접기', () => { body.hidden = !body.hidden; compact.textContent = body.hidden ? '설정' : '접기'; });
    header.style.flexWrap = 'wrap';
    header.append(compact, button('닫기', () => { panel.hidden = true; })); panel.append(header);
    const body = document.createElement('div');
    s.showPanel = () => {
      panel.hidden = false; s.displaySuppressed = false; body.hidden = false; compact.textContent = '접기'; panel.scrollTop = 0;
      s.revealWhenReady = !s.surfaceReady;
      const rect = s.video?.getBoundingClientRect();
      if (rect && (rect.top < 0 || rect.top + Math.min(rect.height, 160) > innerHeight || rect.right <= 0 || rect.left >= innerWidth))
        s.video.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      s.start.focus({ preventScroll: true });
    };
    const trackLabel = document.createElement('label'); trackLabel.textContent = '원문 자막'; s.track = document.createElement('select'); s.track.setAttribute('aria-label', '원문 자막'); trackLabel.append(s.track);
    const targetLabel = document.createElement('label'); targetLabel.textContent = '목표 언어'; s.target = document.createElement('select'); s.target.setAttribute('aria-label', '자막 목표 언어');
    for (const [code, name] of languageNames) { const option = document.createElement('option'); option.value = code; option.textContent = name; s.target.append(option); }
    s.target.value = globalThis.TranslatorTargetLanguage?.() ?? 'ko'; targetLabel.append(s.target);
    const actions = document.createElement('div'); actions.className = 'actions';
    s.start = button('번역 OFF', () => { if (s.running) s.session.stop(); else s.session.start(); }); s.start.disabled = true; s.start.setAttribute('aria-pressed', 'false');
    s.reload = button('목록 새로고침', () => { s.trackAttempts = 0; void loadTracks(s); }); actions.append(s.start, s.reload,
      button('패널·자막 숨기기', () => { panel.hidden = true; s.displaySuppressed = true; s.caption.hidden = true; }));
    s.retryFailed = button('실패 구간 재시도', () => s.session.retryFailed()); s.retryFailed.disabled = true; actions.append(s.retryFailed);
    s.status = document.createElement('p'); s.status.setAttribute('role', 'status'); s.timing = document.createElement('p'); s.timing.className = 'timing';
    s.sourceNote = document.createElement('p'); s.sourceNote.className = 'timing';
    s.cacheNote = document.createElement('p');
    body.append(trackLabel, targetLabel, actions, s.status, s.timing, s.sourceNote, s.cacheNote); panel.append(body);
    s.logError = Core.createErrorLog(body);
    const caption = document.createElement('div'); s.captionBox = caption; caption.className = 'caption'; s.caption = document.createElement('span'); s.caption.hidden = true; caption.append(s.caption);
    body.append(styleControls(s)); attachSession(s);
    shadow.append(panel, caption); document.documentElement.append(host);
    for (const select of [s.track, s.target]) select.addEventListener('change', event => { if (event.isTrusted) { const resume = s.running; reset(s); if (resume) s.session.start(); } });
    document.addEventListener('visibilitychange', () => s.session.wake(), { signal: s.events.signal });
    window.addEventListener('pagehide', () => close(s), { signal: s.events.signal });
    window.addEventListener('yt-navigate-finish', () => { if (videoId() !== s.videoId) close(s); }, { signal: s.events.signal });
    s.showPanel(); void loadTracks(s); render(s);
    return true;
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== 'OPEN_VIDEO') return;
    try { const opened = open(message); respond?.({ opened }); }
    catch {
      // Initialization may fail partway through; never leave a poisoned singleton for subsequent clicks.
      if (state) close(state);
      respond?.({ opened: false });
    }
  });
})();
