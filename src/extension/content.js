(() => {
  if (globalThis.__localTranslatorInstalled) return;
  globalThis.__localTranslatorInstalled = true;
  const Core = globalThis.TranslatorCore, DOM = globalThis.TranslatorDOM;
  let pageState = null, selectionState = null;
  globalThis.TranslatorTargetLanguage = () => pageState?.target.value ?? 'ko';
  const active = state => !state.disposed && (pageState === state || selectionState === state);
  const style = `:host{all:initial}*{box-sizing:border-box}.panel{font:14px/1.6 system-ui,sans-serif;color:#172a46;background:#fff;border:1px solid #ccd7e6;border-radius:12px;box-shadow:0 12px 48px #10213b40;padding:20px;max-height:85vh;overflow:auto}h2{font-size:19px;margin:0 0 8px}p{margin:8px 0}small{color:#53647d}button,select{font:inherit;border:1px solid #b6c7df;border-radius:6px;padding:7px 10px;background:white;color:#20395e}button{cursor:pointer}button.primary{background:#285fbd;color:#fff;border-color:#285fbd}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #88aff1;outline-offset:2px}.row{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}label{display:block;margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:#f4f7fc;border-radius:6px;padding:10px;max-height:240px;overflow:auto}.status{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}progress{width:100%}.warning{color:#875008}.consent{display:flex;align-items:flex-start;gap:8px}.consent input{margin-top:5px}`;
  function el(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }
  async function send(state, message) {
    try { return await Core.requestMessage(chrome.runtime, { ...message, grant: state.grant }); }
    catch (error) { throw new Error(error.code ?? 'WORKER_INTERRUPTED'); }
  }
  function cancel(state) {
    state.generation++; state.running = false;
    for (const jobId of state.jobs ?? []) void send(state, { type: 'CANCEL', jobId }).catch(() => {});
    state.jobs?.clear();
    state.status.textContent = Core.errorMessage('CANCELLED');
    controls(state);
  }
  function dispose(state) {
    state.disposed = true;
    cancel(state);
    state.cleanup?.();
    for (const entry of state.snapshot?.entries ?? []) DOM.restore(entry);
    state.cache.clear(); state.results.clear(); state.host.remove();
    if (pageState === state) pageState = null;
    if (selectionState === state) selectionState = null;
  }
  function controls(state) {
    const actionable = state.snapshot?.entries.some(entry => !['done', 'stale'].includes(entry.status));
    state.start.disabled = state.running || !state.ready || !actionable;
    state.cancel.disabled = !state.running;
    state.target.disabled = state.running || state.started;
    state.source.disabled = state.running || state.started;
    state.start.textContent = state.started ? '남은 구간 재시도' : '번역 시작';
    if (state.toggle) {
      state.toggle.textContent = `번역본 ${state.visible ? 'ON' : 'OFF'}`;
      state.toggle.setAttribute('aria-pressed', String(state.visible));
    }
  }
  function refreshEntry(state, entry) {
    if (entry.status === 'done' || entry.status === 'stale') return;
    if (!DOM.unchanged(entry)) { entry.status = 'stale'; return; }
    if (entry.segments.every(segment => state.results.has(segment.id))) {
      const translated = entry.segments.map(segment => state.results.get(segment.id)).join('');
      entry.targetLanguage = state.target.value;
      entry.translated = translated;
      if (state.snapshot.mode === 'page') {
        entry.status = (!state.visible || DOM.apply(entry, translated)) ? 'done' : 'stale';
      } else {
        entry.status = 'done'; entry.translated = translated;
      }
    }
  }
  function progress(state) {
    for (const entry of state.snapshot.entries) refreshEntry(state, entry);
    const done = state.snapshot.entries.filter(entry => entry.status === 'done').length;
    const failed = state.snapshot.entries.filter(entry => entry.status === 'failed').length;
    const stale = state.snapshot.entries.filter(entry => entry.status === 'stale').length;
    state.progress.max = state.snapshot.entries.length; state.progress.value = done;
    state.status.textContent = `${state.running ? '번역 중' : '번역 결과'} · ${done}/${state.snapshot.entries.length}구간 완료` +
      (failed ? ` · ${failed}구간 실패` : '') + (stale ? ` · 원문 변경 ${stale}구간 제외` : '') +
      (state.lastError ? `\n${state.running && ['CLIENT_BUSY', 'CLIENT_RATE_LIMIT'].includes(state.lastError) ? '요청 한도 대기 중 · 자동으로 이어서 번역합니다.' : Core.errorMessage(state.lastError)}` : '') +
      (state.cacheWarning ? '\n탭 저장소가 가득 찼거나 저장에 실패했습니다. 현재 페이지에서는 결과를 유지하지만 새로고침 후 다시 요청할 수 있습니다.' : '');
    if (state.snapshot.mode === 'selection') {
      state.result.textContent = state.snapshot.entries.map(entry => entry.status === 'done' ? entry.translated : '[아직 번역되지 않은 구간]').join('\n\n');
    }
  }
  async function run(state) {
    if (state.running || !state.ready || !active(state)) return;
    state.running = true; state.started = true; state.lastError = '';
    const generation = ++state.generation;
    const jobs = state.jobs = new Set();
    let halted = false;
    const validRun = () => active(state) && generation === state.generation;
    const running = () => validRun() && !halted;
    state.logError ??= Core.createErrorLog(state.status.parentElement);
    controls(state);
    // Deduplication is scoped to this snapshot and immutable language/model settings.
    const representatives = new Map();
    const owners = new Map();
    for (const entry of state.snapshot.entries) {
      if (['done', 'stale'].includes(entry.status)) continue;
      if (!DOM.unchanged(entry)) { entry.status = 'stale'; continue; }
      entry.status = 'pending';
      for (const segment of entry.segments) {
        if (state.results.has(segment.id)) continue;
        if (state.cache.has(segment.text)) { state.results.set(segment.id, state.cache.get(segment.text)); continue; }
        if (!representatives.has(segment.text)) representatives.set(segment.text, segment);
        const representative = representatives.get(segment.text);
        if (!owners.has(representative.id)) owners.set(representative.id, []);
        owners.get(representative.id).push({ entry, segment });
      }
    }
    progress(state);
    const batches = Core.batches([...representatives.values()]);
    await Core.parallelBatches(batches, async batch => {
      if (!running()) return;
      const valid = batch.filter(segment => owners.get(segment.id).some(({ entry }) => DOM.unchanged(entry)));
      if (!valid.length) { progress(state); return; }
      const jobId = crypto.randomUUID(); jobs.add(jobId);
      try {
        const result = await Core.formatRetry(async () => {
          const response = await send(state, { type: 'TRANSLATE', mode: state.snapshot.mode, body: {
          jobId, provider: state.provider, model: state.model, settingsRevision: state.settingsRevision, sourceLanguage: state.source.value,
          targetLanguage: state.target.value, segments: valid.map(({ id, text }) => ({ id, text }))
          } });
          if (running() && !Core.validResult(response, jobId, valid)) throw new Error('INVALID_PROVIDER_RESPONSE');
          return response;
        }, running, { onError: record => state.logError({ ...record, count: valid.length }), onWait: code => { if (running()) { state.lastError = code; progress(state); } } });
        if (!running()) return;
        if (!Core.validResult(result, jobId, valid)) throw new Error('INVALID_PROVIDER_RESPONSE');
        if (['CLIENT_BUSY', 'CLIENT_RATE_LIMIT'].includes(state.lastError)) state.lastError = '';
        state.cacheWarning ||= result.cacheWarning;
        for (const item of result.translations) {
          const source = valid.find(segment => segment.id === item.id);
          state.cache.set(source.text, item.text);
          for (const { entry, segment } of owners.get(item.id)) {
            if (DOM.unchanged(entry)) state.results.set(segment.id, item.text);
            else entry.status = 'stale';
          }
        }
      } catch (error) {
        if (!running()) return;
        state.lastError = error.message;
        for (const segment of valid) for (const { entry } of owners.get(segment.id)) if (entry.status !== 'stale') entry.status = 'failed';
        // Configuration, quota and connectivity failures halt the queue to avoid repeated cost/errors.
        if (!Core.isFormatError(error.message) && !['PROVIDER_INCOMPLETE', 'PROVIDER_RESPONSE_TOO_LARGE'].includes(error.message)) {
          halted = true;
          for (const pending of jobs) if (pending !== jobId) void send(state, { type: 'CANCEL', jobId: pending }).catch(() => {});
        }
      } finally {
        jobs.delete(jobId);
      }
      if (validRun()) progress(state);
    }, running);
    if (!active(state) || generation !== state.generation) return;
    state.running = false;
    progress(state); controls(state);
    state.reposition?.();
  }
  async function open(mode, grant, selectionText) {
    if (pageState) pageState.grant = grant;
    if (selectionState) selectionState.grant = grant;
    if (mode === 'selection') { await openSelection(grant, selectionText); return; }
    if (pageState) { expand(pageState); return; }
    let snapshot, extractionError;
    try { snapshot = DOM.collect('page'); } catch (error) { extractionError = error.message; }
    const host = el('div', undefined, { 'data-llm-translator-root': '' });
    host.style.cssText = 'all:initial!important;position:fixed!important;top:18px!important;right:18px!important;width:min(420px,calc(100vw - 24px))!important;z-index:2147483647!important;display:block!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(el('style', style));
    const panel = el('section', undefined, { class: 'panel', role: 'dialog', 'aria-label': '텍스트 번역' }); shadow.append(panel);
    panel.append(el('h2', '페이지 본문 번역'));
    const status = el('p', '설정 확인 중…', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const source = el('select', undefined, { 'aria-label': '원문 언어' }), target = el('select', undefined, { 'aria-label': '목표 언어' });
    const languages = [['auto', '자동 감지'], ['ko', '한국어'], ['en', '영어'], ['ja', '일본어'], ['zh-CN', '중국어 간체'], ['zh-TW', '중국어 번체'], ['de', '독일어'], ['fr', '프랑스어'], ['es', '스페인어']];
    for (const [value, label] of languages) { source.append(el('option', label, { value })); if (value !== 'auto') target.append(el('option', label, { value })); }
    target.value = 'ko';
    panel.append(el('p', '원문 언어 → 목표 언어')); const languageRow = el('div', undefined, { class: 'row' }); languageRow.append(source, target); panel.append(languageRow);
    const unique = snapshot ? [...new Map(snapshot.entries.flatMap(entry => entry.segments).map(segment => [segment.text, segment])).values()] : [];
    panel.append(el('p', snapshot ? `${snapshot.entries.length}개 원문 구간 · ${snapshot.chars.toLocaleString()}자 · 묶음 요청 ${Core.batches(unique).length}개` : extractionError));
    if (snapshot?.truncated) panel.append(el('p', '페이지가 커서 일부 구간만 수집했습니다. 아래 원문을 확인하세요.', { class: 'warning' }));
    const preview = el('details'); preview.append(el('summary', '전송 대상 원문 확인'), el('pre', snapshot?.entries.map(entry => entry.text).join('\n\n') ?? '')); panel.append(preview);
    const start = el('button', '번역 시작', { class: 'primary', disabled: '' });
    const cancelButton = el('button', '취소', { disabled: '' });
    const close = el('button', '패널 닫기');
    const toggle = el('button', '번역본 ON', { 'aria-pressed': 'true' });
    const reset = el('button', '새 번역');
    const row = el('div', undefined, { class: 'row' }); row.append(start, cancelButton, toggle, reset, close); panel.append(row);
    const progressBar = el('progress', undefined, { max: '1', value: '0', 'aria-label': '번역 진행' }); panel.append(progressBar, status);
    panel.append(el('small', '번역본 ON/OFF는 추가 요청 없이 전환합니다. 패널을 닫아도 결과는 탭 종료 전까지 보관합니다. 다른 본문·언어·모델을 사용하려면 새 번역을 누르세요.'));
    const dock = el('button', '본문 번역 열기', { class: 'primary', hidden: '' }); shadow.append(dock);
    document.documentElement.append(host);
    const state = { host, snapshot, grant, source, target, start, cancel: cancelButton, status, progress: progressBar,
      panel, dock, toggle, visible: true, generation: 0, running: false, ready: false, started: false, cache: new Map(), results: new Map() };
    pageState = state;
    start.addEventListener('click', event => { if (event.isTrusted) void run(state); });
    cancelButton.addEventListener('click', event => { if (event.isTrusted) cancel(state); });
    close.addEventListener('click', event => { if (event.isTrusted) { panel.hidden = true; dock.hidden = false; host.style.setProperty('width', 'auto', 'important'); dock.focus(); } });
    dock.addEventListener('click', event => { if (event.isTrusted) expand(state); });
    toggle.addEventListener('click', event => {
      if (!event.isTrusted) return;
      state.visible = !state.visible;
      for (const entry of state.snapshot?.entries ?? []) {
        if (!state.visible) DOM.restore(entry);
        else if (entry.status === 'done' && !DOM.apply(entry, entry.translated)) entry.status = 'stale';
      }
      if (state.snapshot) progress(state); controls(state);
    });
    reset.addEventListener('click', event => { if (event.isTrusted) { const grant = state.grant; dispose(state); void open('page', grant); } });
    if (!snapshot) { status.textContent = '대상을 다시 선택한 뒤 확장 버튼에서 시작하세요.'; controls(state); return; }
    try {
      const connection = await send(state, { type: 'CONTENT_STATUS' });
      if (!active(state)) return;
      state.ready = connection.configured && connection.consentAccepted;
      state.model = connection.model; state.provider = connection.provider;
      state.settingsRevision = connection.settingsRevision;
      status.textContent = !connection.consentAccepted ? Core.errorMessage('CONSENT_REQUIRED') : connection.configured ? `준비됨 · ${Core.providerName(connection.provider)} · ${connection.model}` : Core.errorMessage('NOT_CONFIGURED');
    } catch (error) { if (active(state)) status.textContent = Core.errorMessage(error.message); }
    controls(state);
  }
  function expand(state) {
    state.panel.hidden = false; state.dock.hidden = true;
    state.host.style.setProperty('width', 'min(420px,calc(100vw - 24px))', 'important');
    state.toggle.focus();
  }
  async function openSelection(grant, text) {
    if (selectionState) dispose(selectionState);
    const range = DOM.selectionAnchor(text);
    const host = el('div', undefined, { 'data-llm-translator-root': '', 'data-translation-overlay': '' });
    host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;display:block!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.append(el('style', style + '.panel{padding:10px 12px;border-radius:6px;max-height:55vh}.row{margin:4px 0}pre{background:transparent;padding:0;margin:4px 0;max-height:35vh}.status{font-size:12px;margin:3px 0}button{font-size:12px;padding:3px 7px}[hidden]{display:none!important}'));
    const panel = el('section', undefined, { class: 'panel', role: 'region', 'aria-label': '선택 영역 번역 오버레이' }); shadow.append(panel);
    const result = el('pre', '번역 중…', { 'aria-live': 'polite' });
    const status = el('p', '선택한 원문을 번역합니다.', { class: 'status', role: 'status' });
    const start = el('button', '재시도', { hidden: '' }), close = el('button', '닫기', { 'aria-label': '선택 번역 닫기' });
    const row = el('div', undefined, { class: 'row' }); row.append(start, close); panel.append(result, status, row);
    document.documentElement.append(host);
    let snapshot;
    try { snapshot = DOM.collectSelection(text); } catch { /* Show a local selection error without sending source. */ }
    if (snapshot && range) { snapshot.entries[0].range = range; snapshot.entries[0].rangeText = range.toString(); }
    const state = { host, snapshot, grant, source: { value: pageState?.source.value ?? 'auto' }, target: { value: pageState?.target.value ?? 'ko' },
      start, cancel: el('button'), progress: el('progress'), status, result,
      generation: 0, running: false, ready: false, started: false, cache: new Map(), results: new Map() };
    selectionState = state;
    const position = () => {
      if (!range || !snapshot) return;
      if (!DOM.unchanged(snapshot.entries[0])) { dispose(state); return; }
      const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
      const rect = rects.find(rect => rect.bottom > 0 && rect.top < innerHeight) ?? rects[0];
      if (!rect) { host.style.setProperty('visibility', 'hidden', 'important'); return; }
      const width = Math.min(Math.max(range.getBoundingClientRect().width, 240), 520, Math.max(1, innerWidth - 16));
      const left = Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - width - 8));
      host.style.setProperty('width', `${width}px`, 'important');
      host.style.setProperty('left', `${left}px`, 'important');
      const top = Math.max(8, Math.min(rect.top, innerHeight - host.getBoundingClientRect().height - 8));
      host.style.setProperty('top', `${top}px`, 'important');
      host.style.setProperty('visibility', rect.bottom < 0 || rect.top >= innerHeight ? 'hidden' : 'visible', 'important');
    };
    state.reposition = position;
    let frame;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = null; position(); }); };
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    const observer = new MutationObserver(schedule); observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    state.cleanup = () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
    close.addEventListener('click', event => { if (event.isTrusted) dispose(state); });
    start.addEventListener('click', event => { if (event.isTrusted) void run(state); });
    if (!range || !snapshot) {
      host.style.setProperty('left', '12px', 'important'); host.style.setProperty('bottom', '12px', 'important');
      host.style.setProperty('width', 'min(360px,calc(100vw - 24px))', 'important');
      result.textContent = '원문 위치를 확인할 수 없습니다.'; status.textContent = '번역할 텍스트를 다시 선택한 뒤 우클릭하세요.';
      return;
    }
    position();
    try {
      const connection = await send(state, { type: 'CONTENT_STATUS' });
      if (!active(state)) return;
      state.ready = connection.configured && connection.consentAccepted;
      state.model = connection.model; state.provider = connection.provider; state.settingsRevision = connection.settingsRevision;
      if (!state.ready) throw new Error(connection.consentAccepted ? 'NOT_CONFIGURED' : 'CONSENT_REQUIRED');
      await run(state);
    } catch (error) { if (active(state)) { result.textContent = ''; status.textContent = Core.errorMessage(error.message); } }
    if (active(state)) { start.hidden = false; controls(state); position(); }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message.type !== 'OPEN_PANEL' || !['selection', 'page'].includes(message.mode)) return;
    void open(message.mode, message.grant, message.selectionText); respond({ opened: true });
  });
  window.addEventListener('pagehide', () => { if (selectionState) dispose(selectionState); if (pageState) dispose(pageState); });
})();
