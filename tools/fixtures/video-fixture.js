(() => {
  const id = 'a'.repeat(32), listeners = [], player = document.getElementById('movie_player') ?? document.getElementById('shorts-player');
  let video = document.querySelector('video');
  let targetId = 'abcdefghijk'; const shorts = location.pathname.startsWith('/shorts/'); let calls = 0, cancelled = 0, lastBatch = 0, reads = 0, laterLoaded = false;
  let appearance = JSON.parse(sessionStorage.getItem('fixture-video-appearance') ?? 'null');
  const status = document.getElementById('status');
  const update = () => { status.textContent = `모의 번역 요청 ${calls}회 · 자막 확인 ${reads}회 · 취소 ${cancelled}회 · 최근 배치 ${lastBatch}개 · 후속 구간 ${laterLoaded ? '로드됨' : '미로드'} · 실제 API 호출 0회\n시간 ${video.currentTime.toFixed(2)}초 · ${video.paused ? '일시정지' : '재생 중'} · 배속 ${video.playbackRate}`; };
  const cues = globalThis.TranslatorVideoCore.parse({ events: [
    { tStartMs: 0, dDurationMs: 2500, segs: [{ utf8: 'Welcome to caption translation.' }] },
    { tStartMs: 3000, dDurationMs: 2500, segs: [{ utf8: 'Captions follow the video clock.' }] },
    { tStartMs: 9000, dDurationMs: 2500, segs: [{ utf8: 'Automatically loaded caption.' }] }
  ] });
  globalThis.chrome = { runtime: { id, onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async message => {
    if (message.type === 'OPEN_VIDEO_INLINE') {
      if (document.getElementById('inline-hang').checked) return new Promise(() => {});
      if (document.getElementById('inline-error').checked) return { ok: false, error: 'WORKER_INTERRUPTED' };
      if (document.getElementById('inline-settings').checked) return { ok: true, data: { opened: false, needsSettings: true } };
      const opened = open();
      if (document.getElementById('inline-reply-delay')?.checked) await new Promise(resolve => setTimeout(resolve, 4000));
      return opened ? { ok: true, data: { opened: true } } : { ok: false, error: 'CAPTIONS_UNAVAILABLE' };
    }
    if (message.type === 'VIDEO_STYLE_GET') return { ok: true, data: appearance };
    if (message.type === 'VIDEO_STYLE_SET') { appearance = message.style; sessionStorage.setItem('fixture-video-appearance', JSON.stringify(appearance)); return { ok: true, data: appearance }; }
    if (message.type === 'CONTENT_STATUS') return { ok: true, data: { configured: true, consentAccepted: true, model: 'mock-model', settingsRevision: 'mock-revision' } };
    if (message.type === 'VIDEO_TRACKS') return document.getElementById('no-captions').checked ? { ok: false, error: 'CAPTIONS_EMPTY' } : { ok: true, data: { videoId: targetId, tracks: [
      { index: 0, label: 'English', language: 'en', automatic: false }, { index: 1, label: 'English', language: 'en', automatic: true }] } };
    if (message.type === 'VIDEO_CAPTIONS') { reads++; update(); return { ok: true, data: { videoId: targetId, cues: structuredClone(laterLoaded ? cues.slice(2) : cues.slice(0, 2)) } }; }
    if (message.type === 'CANCEL') { cancelled++; update(); return { ok: true, data: {} }; }
    if (message.type === 'TRANSLATE') {
      calls++; lastBatch = message.body.segments.length; update();
      const delay = document.getElementById('delay').checked, fail = document.getElementById('fail').checked;
      await new Promise(resolve => setTimeout(resolve, delay ? 4000 : 80));
      if (fail) return { ok: false, error: 'PROVIDER_UNAVAILABLE' };
      return { ok: true, data: { jobId: message.body.jobId, translations: [...message.body.segments].reverse().map(segment => ({ id: segment.id,
        text: message.body.targetLanguage === 'ja' ? `日本語の字幕: ${segment.text}` : segment.text.startsWith('Automatically') ? '새로 로드된 구간도 자동으로 번역됩니다.' : segment.text.startsWith('Welcome') ? '자막 번역에 오신 것을 환영합니다.' : '자막은 영상 재생 시간에 맞춰 표시됩니다. <b>텍스트</b>' })) } };
    }
    return { ok: false, error: 'INVALID_REQUEST' };
  } } };
  const open = () => {
    history.replaceState(null, '', shorts ? `/shorts/${targetId}` : `/watch?v=${targetId}`);
    let opened = false;
    for (const listener of listeners) listener({ type: 'OPEN_VIDEO', grant: 'fixture-grant', videoId: targetId }, { id }, result => { opened = result.opened; });
    if (document.getElementById('swap-on-open')?.checked) setTimeout(replaceVideo, 30);
    return opened;
  };
  const failOnce = document.createElement('button'); failOnce.textContent = '다음 패널 초기화 1회 실패';
  failOnce.id = 'init-failure'; document.getElementById('open').before(failOnce);
  failOnce.onclick = () => {
    const original = globalThis.TranslatorVideoStyle;
    globalThis.TranslatorVideoStyle = { ...original, apply() {
      globalThis.TranslatorVideoStyle = original; throw Error('Simulated panel initialization failure');
    } };
  };
  const delayed = document.createElement('label'), delayedInput = document.createElement('input');
  delayedInput.type = 'checkbox'; delayedInput.id = 'inline-reply-delay'; delayed.append(delayedInput, '열린 뒤 응답 지연 4초');
  document.getElementById('open').before(delayed);
  function replaceVideo() {
    const old = video, next = old.cloneNode(true); old.pause(); old.replaceWith(next); video = next;
    next.addEventListener('loadedmetadata', update, { once: true }); update();
  }
  const swapping = document.createElement('label'), swapInput = document.createElement('input'); swapInput.type = 'checkbox'; swapInput.id = 'swap-on-open';
  swapping.append(swapInput, '첫 열기 직후 video 교체'); document.getElementById('open').before(swapping);
  for (const [name, action] of [
    ['같은 영상 video 교체', replaceVideo],
    ['video 1초 분리', () => { const old = video; old.remove(); setTimeout(() => player.append(old), 1000); }],
    ['video 크기 0 전환', () => { video.style.width = video.style.width === '0px' ? '' : '0px'; video.style.height = video.style.width; }],
    ['같은 영상 탐색 이벤트', () => { window.dispatchEvent(new Event('yt-navigate-start')); window.dispatchEvent(new Event('yt-navigate-finish')); }]
  ]) { const node = document.createElement('button'); node.textContent = name; node.onclick = action; document.getElementById('open').before(node); }
  const lifecycleChecks = document.createElement('button'); lifecycleChecks.textContent = '재생 시작 수명 회귀 검사';
  const lifecycleResults = document.createElement('pre'); lifecycleResults.id = 'lifecycle-results';
  document.getElementById('open').before(lifecycleChecks, lifecycleResults);
  lifecycleChecks.onclick = async () => {
    const results = [], check = (name, ok) => results.push(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
    const pause = () => new Promise(resolve => setTimeout(resolve, 350));
    swapInput.checked = false;
    const existing = () => document.querySelector('[data-llm-translator-root="video"]');
    check('OPEN 수락', open()); await pause(); const host = existing();
    replaceVideo(); await pause(); check('같은 영상 교체 후 동일 패널 유지', existing() === host && !!host);
    const old = video; old.remove(); await pause();
    check('video 부재 중 패널 표시', existing() === host && host.style.visibility === 'visible');
    check('대기 중 토글 숨김', globalThis.TranslatorVideoPanel.toggle(targetId) && !globalThis.TranslatorVideoPanel.isOpen(targetId));
    check('대기 중 토글 복원', globalThis.TranslatorVideoPanel.toggle(targetId) && globalThis.TranslatorVideoPanel.isOpen(targetId));
    player.append(old); await pause(); video.style.width = '0px'; video.style.height = '0px'; await pause();
    check('0 크기 패널 숨김 방지', existing() === host && host.style.visibility === 'visible');
    video.style.width = ''; video.style.height = ''; await pause();
    window.dispatchEvent(new Event('yt-navigate-start')); window.dispatchEvent(new Event('yt-navigate-finish')); await pause();
    check('같은 ID 탐색 이벤트 후 유지', existing() === host);
    history.replaceState(null, '', shorts ? '/shorts/other_video' : '/watch?v=other_video'); await pause();
    check('다른 ID에서 이전 패널 제거', !existing());
    history.replaceState(null, '', shorts ? `/shorts/${targetId}` : `/watch?v=${targetId}`);
    video.remove(); check('video 없는 최초 OPEN 수락', open()); await pause();
    check('video 없는 최초 UI 표시', Boolean(existing()) && existing().style.visibility === 'visible');
    player.append(video); await pause();
    lifecycleResults.textContent = results.join('\n');
  };
  if (!shorts) {
    const scrollTest = document.createElement('button'); scrollTest.textContent = '영상 위로 벗어나게 스크롤'; scrollTest.id = 'offscreen-player';
    scrollTest.onclick = () => {
      if (!document.getElementById('fixture-gap')) {
        const gap = document.createElement('div'); gap.id = 'fixture-gap'; gap.style.height = '1000px'; player.after(gap);
      }
      document.querySelector('ytd-watch-metadata').scrollIntoView({ block: 'start' });
    };
    document.getElementById('open').before(scrollTest);
  }
  document.getElementById('open').onclick = open;
  document.getElementById('load-later').onclick = () => { laterLoaded = true; update(); };
  document.getElementById('seek-later').onclick = () => { video.pause(); video.currentTime = 10; };
  for (const [name, time] of [['seek-one', 1], ['seek-two', 4], ['seek-gap', 8]]) document.getElementById(name).onclick = () => { video.pause(); video.currentTime = time; };
  document.getElementById('play').onclick = () => { void video.play(); };
  document.getElementById('pause').onclick = () => video.pause();
  document.getElementById('speed').onclick = () => { video.playbackRate = video.playbackRate === 1 ? 2 : 1; };
  document.getElementById('fullscreen').onclick = () => { void player.requestFullscreen(); };
  document.getElementById('ad').onclick = () => player.classList.toggle('ad-showing');
  document.getElementById('navigate').onclick = () => { targetId = targetId === 'abcdefghijk' ? 'other_video' : 'abcdefghijk'; history.replaceState(null, '', shorts ? `/shorts/${targetId}` : `/watch?v=${targetId}`); window.dispatchEvent(new Event('yt-navigate-start')); window.dispatchEvent(new Event('yt-navigate-finish')); };
  for (const event of ['timeupdate', 'seeked', 'ratechange', 'play', 'pause']) video.addEventListener(event, update);
  // Local 12-second silent WAV; actual browser media clock/seeking, no codec download.
  const length = 8000 * 12, buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })); video.src = url;
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 450; const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#152538'; ctx.fillRect(0, 0, 800, 450); ctx.fillStyle = '#d3e9ff'; ctx.font = '30px sans-serif'; ctx.fillText('LOCAL CAPTION TEST', 42, 100); ctx.font = '20px sans-serif'; ctx.fillText('Timed text / pause / seek / speed / overlay', 42, 145); video.poster = canvas.toDataURL();
  video.addEventListener('loadedmetadata', () => { document.getElementById('checks').textContent = Number.isFinite(video.duration) && video.duration === 12 ? 'PASS: 기기 내 미디어 로드 · 실제 재생 길이 12초' : 'FAIL: 미디어 시계 로드'; update(); }, { once: true });
  window.addEventListener('pagehide', () => URL.revokeObjectURL(url), { once: true }); update();
})();
