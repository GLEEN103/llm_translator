(() => {
  if (globalThis.TranslatorImageUI) return;
  const DOM = globalThis.TranslatorImageDOM, Core = globalThis.TranslatorCore;
  let current;
  const el = (tag, text, attrs = {}) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  async function send(state, message) {
    let timer;
    try {
      const response = await Promise.race([chrome.runtime.sendMessage({ ...message, grant: state.grant, imageToken: state.token }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('WORKER_INTERRUPTED')), message.type === 'TRANSLATE_IMAGE' && state.provider === 'openai' ? 200000 : 29000); })]);
      if (!response?.ok) throw new Error(response?.error ?? 'WORKER_INTERRUPTED');
      return response.data;
    } finally { clearTimeout(timer); }
  }
  function close(state) {
    state.closed = true; state.generation++;
    void send(state, { type: 'RELEASE_IMAGE' }).catch(() => {});
    state.cleanup?.(); state.image = null; state.snapshot = null; state.host.remove();
    if (current === state) current = null;
  }
  function position(state) {
    if (!state.snapshot || state.closed) return;
    if (!DOM.unchanged(state.snapshot)) { close(state); return; }
    const rect = state.snapshot.element.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 240), 520, Math.max(1, innerWidth - 16));
    state.host.style.setProperty('width', `${width}px`, 'important');
    state.host.style.setProperty('left', `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`, 'important');
    state.host.style.setProperty('top', `${Math.max(8, Math.min(rect.top, innerHeight - state.host.getBoundingClientRect().height - 8))}px`, 'important');
    state.host.style.setProperty('visibility', state.capturing || rect.bottom < 0 || rect.top > innerHeight ? 'hidden' : 'visible', 'important');
  }
  function controls(state) {
    state.target.disabled = state.running; state.start.disabled = state.running || !state.snapshot;
    state.start.textContent = state.completed ? '다시 번역' : '재시도';
  }
  async function run(state) {
    if (state.running || state.closed || !state.snapshot || current !== state) return;
    state.running = true; state.completed = false; controls(state);
    const generation = ++state.generation, live = () => current === state && !state.closed && generation === state.generation;
    state.status.textContent = '이미지 확인 중…'; state.result.textContent = ''; state.original.textContent = '';
    try {
      const status = await send(state, { type: 'CONTENT_STATUS' });
      if (!live()) return;
      if (!status.consentAccepted || !status.configured) throw new Error(status.consentAccepted ? 'NOT_CONFIGURED' : 'CONSENT_REQUIRED');
      state.provider = status.provider;
      if (status.provider === 'kie') throw new Error('PROVIDER_IMAGE_UNSUPPORTED');
      if (!DOM.unchanged(state.snapshot)) throw new Error('IMAGE_CHANGED');
      if (!state.image) {
        state.image = DOM.encode(state.snapshot);
        if (!state.image) {
          state.capturing = true; position(state);
          // Allow the hidden overlay to leave the compositor before capture.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          if (!live()) return;
          try { state.image = await send(state, { type: 'CAPTURE_IMAGE' }); }
          finally { state.capturing = false; position(state); }
        }
      }
      if (!live()) return;
      if (!DOM.unchanged(state.snapshot)) throw new Error('IMAGE_CHANGED');
      state.status.textContent = `이미지 인식·번역 중 · ${status.model}`;
      const jobId = crypto.randomUUID();
      state.logError ??= Core.createErrorLog(state.status.parentElement);
      const result = await Core.formatRetry(async () => {
        if (!DOM.unchanged(state.snapshot)) throw new Error('IMAGE_CHANGED');
        const response = await send(state, { type: 'TRANSLATE_IMAGE', body: { jobId, model: status.model, settingsRevision: status.settingsRevision,
          targetLanguage: state.target.value, image: state.image } });
        if (live() && (response?.jobId !== jobId || typeof response.noText !== 'boolean' || !['translation', 'recognizedText'].every(key => typeof response[key] === 'string' && response[key].length <= 24000) ||
          (response.noText ? response.translation !== '' || response.recognizedText !== '' : !response.translation.trim() || !response.recognizedText.trim()))) throw new Error('INVALID_PROVIDER_RESPONSE');
        return response;
      }, live, { onError: record => state.logError(record), onWait: () => { if (live()) state.status.textContent = '요청 한도 대기 중 · 자동으로 이어서 번역합니다.'; } });
      if (!live()) return;
      if (!DOM.unchanged(state.snapshot)) throw new Error('IMAGE_CHANGED');
      if (result?.jobId !== jobId || typeof result.noText !== 'boolean' || !['translation', 'recognizedText'].every(key => typeof result[key] === 'string' && result[key].length <= 24000) ||
          (result.noText ? result.translation !== '' || result.recognizedText !== '' : !result.translation.trim() || !result.recognizedText.trim())) throw new Error('INVALID_PROVIDER_RESPONSE');
      state.result.textContent = result.noText ? '이미지에서 읽을 수 있는 문자를 찾지 못했습니다.' : result.translation;
      state.original.textContent = result.recognizedText;
      state.status.textContent = result.noText ? '인식 완료 · 문자 없음' : '이미지 번역 완료'; state.completed = true;
    } catch (error) {
      if (live()) state.status.textContent = Core.errorMessage(error.message === 'PROVIDER_MODEL_OR_REQUEST' ? 'IMAGE_MODEL_UNSUPPORTED' : error.message);
    } finally {
      if (live()) { state.running = false; controls(state); position(state); }
    }
  }
  function open(message) {
    if (current) close(current);
    let snapshot, failure;
    try { snapshot = DOM.find(message.srcUrl); } catch (error) { failure = error.message; }
    const host = el('div', undefined, { 'data-llm-translator-root': '', 'data-image-translation-overlay': '' });
    host.style.cssText = 'all:initial!important;position:fixed!important;top:12px!important;left:12px!important;width:min(440px,calc(100vw - 24px))!important;z-index:2147483647!important;display:block!important;';
    const root = host.attachShadow({ mode: 'closed' });
    root.append(el('style', ':host{all:initial}*{box-sizing:border-box}.panel{font:14px/1.55 system-ui;color:#172a46;background:#fff;border:1px solid #bfd1e7;border-radius:8px;padding:12px;box-shadow:0 8px 32px #10213b40;max-height:70vh;overflow:auto}h2{font-size:16px;margin:0 0 8px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button,select{font:inherit;border:1px solid #b6c7df;background:#fff;color:#20395e;border-radius:5px;padding:5px 8px}button{cursor:pointer}button:disabled{opacity:.5}button:focus-visible,select:focus-visible{outline:3px solid #88aff1}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;max-height:35vh;overflow:auto;margin:10px 0}p{font-size:12px;margin:8px 0}summary{cursor:pointer}'));
    const panel = el('section', undefined, { class: 'panel', role: 'region', 'aria-label': '이미지 번역 오버레이' }); root.append(panel);
    const target = el('select', undefined, { 'aria-label': '이미지 번역 목표 언어' });
    for (const [value, label] of [['ko','한국어'],['en','영어'],['ja','일본어'],['zh-CN','중국어 간체'],['zh-TW','중국어 번체'],['de','독일어'],['fr','프랑스어'],['es','스페인어']]) target.append(el('option', label, { value }));
    target.value = globalThis.TranslatorTargetLanguage?.() ?? 'ko';
    const start = el('button', '재시도'), dismiss = el('button', '닫기', { 'aria-label': '이미지 번역 닫기' });
    const row = el('div', undefined, { class: 'row' }); row.append(target, start, dismiss);
    const result = el('pre', '', { 'aria-live': 'polite' }), status = el('p', '', { role: 'status' });
    const original = el('pre', ''), details = el('details'); details.append(el('summary','인식한 원문'), original);
    panel.append(el('h2', '이미지 번역'), row, result, status, details);
    document.documentElement.append(host);
    const state = { host, target, start, result, original, status, snapshot, grant: message.grant, token: message.imageToken, generation: 0 };
    current = state;
    let frame;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = null; position(state); }); };
    const observer = new MutationObserver(schedule); observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    state.cleanup = () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
    dismiss.addEventListener('click', event => { if (event.isTrusted) close(state); });
    start.addEventListener('click', event => { if (event.isTrusted) void run(state); });
    target.addEventListener('change', event => { if (event.isTrusted) void run(state); });
    if (failure) { status.textContent = Core.errorMessage(failure); controls(state); return; }
    position(state); void run(state);
  }
  globalThis.TranslatorImageUI = Object.freeze({ captureGeometry: token => {
    if (!current || current.closed || !current.capturing || token !== current.token) return null;
    try { return DOM.geometry(current.snapshot); } catch { return null; }
  } });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message.type !== 'OPEN_IMAGE') return;
    open(message); respond({ opened: true });
  });
  window.addEventListener('pagehide', () => { if (current) close(current); });
})();
