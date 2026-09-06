const apiKeyInput = document.getElementById('api-key'), modelInput = document.getElementById('model');
const status = document.getElementById('status'), keyState = document.getElementById('key-state');
const save = document.getElementById('save'), clear = document.getElementById('clear');
const loadModels = document.getElementById('load-models'), modelState = document.getElementById('model-state');
const savedInput = document.getElementById('saved-model'), activate = document.getElementById('activate-model'), remove = document.getElementById('delete-model');
const providerInput = document.getElementById('provider'), search = document.getElementById('model-search'), familyInput = document.getElementById('model-family');
const cards = document.getElementById('model-cards'), selected = document.getElementById('selected-model');
const pricePanel = document.getElementById('price-panel'), priceState = document.getElementById('price-state'), refreshPrices = document.getElementById('refresh-prices');
let priceSnapshot = { prices: {}, fetchedAt: null, error: '' }, priceLoading = false, priceCheckedAt = 0;
const usd = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(value);
function renderPrices() {
  pricePanel.hidden = providerInput.value !== 'kie';
  const stale = priceSnapshot.error || priceSnapshot.fetchedAt === null || Date.now() - priceSnapshot.fetchedAt >= 300_000;
  refreshPrices.disabled = priceLoading || Date.now() < (priceSnapshot.retryAt ?? 0);
  const time = priceSnapshot.fetchedAt === null ? '' : new Date(priceSnapshot.fetchedAt).toLocaleString('ko-KR');
  priceState.textContent = priceLoading ? '공식 공개 가격을 확인하는 중…' : priceSnapshot.error ?
    `갱신 실패 · ${time ? `${time}에 조회한 이전 가격입니다. 최신 가격을 재확인하세요.` : '가격을 확인할 수 없습니다.'}` :
    time ? `조회: ${time}${stale ? ' · 재확인 필요' : ' · 공개 가격 기준'}` : '가격 조회 전';
  for (const element of cards.querySelectorAll('[data-price-model]')) {
    const price = priceSnapshot.prices[element.dataset.priceModel];
    element.replaceChildren();
    for (const [key, label] of [['input', '입력'], ['output', '출력']]) {
      const line = document.createElement('span'), value = price?.[key];
      line.className = `price-${key}`;
      line.textContent = value ? `${label} ${usd(value.usd)}` : `${label} 미확인`;
      line.setAttribute('aria-label', value ? `${label} ${usd(value.usd)} / 100만 토큰` : `${label} 가격 미확인`);
      if (value) line.title = `${value.credits.toLocaleString('en-US', { maximumFractionDigits: 8 })} 크레딧 / 100만 토큰 · 공식 USD 환산값 ${value.usd}달러 · 조회 ${time}`;
      element.append(line);
    }
    const unit = document.createElement('small'); unit.className = 'price-unit'; unit.textContent = 'USD / 1M 토큰'; element.append(unit);
    if (stale && price) { const note = document.createElement('small'); note.textContent = '이전 조회값 · 재확인 필요'; element.append(note); }
    element.dataset.stale = String(Boolean(stale));
  }
}
async function updatePrices() {
  if (providerInput.value !== 'kie' || document.hidden || priceLoading) return;
  priceLoading = true; renderPrices();
  try { priceSnapshot = await request({ type: 'KIE_PRICES' }); }
  catch { priceSnapshot = { ...priceSnapshot, error: 'PRICE_UNAVAILABLE' }; }
  finally { priceLoading = false; priceCheckedAt = Date.now(); renderPrices(); }
}
refreshPrices.addEventListener('click', updatePrices);
const priceTimer = setInterval(() => {
  if (document.hidden || providerInput.value !== 'kie') return;
  renderPrices(); if (Date.now() - priceCheckedAt >= 300_000) void updatePrices();
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - priceCheckedAt >= 300_000) void updatePrices(); });
window.addEventListener('pagehide', () => clearInterval(priceTimer), { once: true });
let catalogId = '', generation = 0, busy = false, loading = false, activeModel = '', activeProvider = 'google', profiles = [], models = [];
const providerName = () => TranslatorCore.providerName(providerInput.value);
const family = item => item.family ?? (item.id.startsWith('gpt') ? 'GPT' : item.id.startsWith('gemini') ? 'Gemini' : item.id.startsWith('gemma') ? 'Gemma' : '기타');
const label = item => `${item.displayName} · ${item.id}`;
const currentProfiles = () => profiles.filter(item => (item.provider ?? 'google') === providerInput.value);
function controls() {
  save.disabled = busy || loading || !catalogId || !modelInput.value || (!apiKeyInput.value.trim() && !currentProfiles().some(item => item.id === modelInput.value));
  clear.disabled = busy; loadModels.disabled = busy; apiKeyInput.disabled = busy; providerInput.disabled = busy;
  savedInput.disabled = busy; activate.disabled = remove.disabled = busy || !savedInput.value;
  for (const button of document.querySelectorAll('#legacy-key-list button')) button.disabled = busy;
  for (const radio of cards.querySelectorAll('input')) radio.disabled = busy || loading || !catalogId;
}
function selection() {
  const model = models.find(item => item.id === modelInput.value);
  selected.textContent = model ? `선택: ${providerName()} · ${model.displayName} (${model.id})` : '선택한 모델 없음';
  for (const card of cards.querySelectorAll('.model-card')) card.dataset.selected = String(card.querySelector('input').value === modelInput.value);
  controls();
}
function renderCards() {
  cards.replaceChildren();
  const query = search.value.trim().toLowerCase();
  const visible = models.filter(item => (!familyInput.value || family(item) === familyInput.value) && `${item.id} ${item.displayName}`.toLowerCase().includes(query));
  for (const name of [...new Set(visible.map(family))]) {
    const group = document.createElement('fieldset'), title = document.createElement('legend'), grid = document.createElement('div');
    title.textContent = name; grid.className = 'model-grid'; group.append(title, grid);
    for (const item of visible.filter(item => family(item) === name)) {
      const card = document.createElement('label'), radio = document.createElement('input'), body = document.createElement('span');
      card.className = 'model-card'; radio.type = 'radio'; radio.name = 'model-choice'; radio.value = item.id; radio.checked = item.id === modelInput.value;
      const heading = document.createElement('strong'), id = document.createElement('code'), date = document.createElement('small'), badge = document.createElement('span');
      heading.textContent = item.displayName; id.textContent = item.id;
      date.textContent = item.releaseDate ? `출시 ${item.releaseDate}` : '출시일 미확인'; badge.className = 'model-badge';
      badge.textContent = providerInput.value === 'openai' ? '텍스트 · 자막 · 이미지' : providerInput.value === 'kie' ? '텍스트 · 자막' : '텍스트 · 자막 · 이미지 모델별 확인';
      const header = document.createElement('span'), metadata = document.createElement('span'), identity = document.createElement('span');
      header.className = 'model-card-header'; identity.className = 'model-identity'; header.append(identity);
      if (providerInput.value === 'kie') { const price = document.createElement('span'); price.className = 'model-price'; price.dataset.priceModel = item.id; header.append(price); }
      metadata.className = 'model-metadata'; metadata.append(date, badge);
      identity.append(heading, id, metadata); body.append(header);
      card.append(radio, body); grid.append(card);
      radio.addEventListener('change', () => { modelInput.value = radio.value; selection(); });
    }
    cards.append(group);
  }
  if (!visible.length) { const empty = document.createElement('p'); empty.className = 'model-empty'; empty.textContent = models.length ? '검색 조건에 맞는 모델이 없습니다. 검색어나 계열 필터를 변경하세요.' : '모델 목록을 불러오면 계열별로 표시합니다.'; cards.append(empty); }
  modelState.textContent = `${visible.length} / ${models.length}개 모델 · ${providerInput.value === 'kie' ? '공식 문서에 있는 지원 모델 · 계정별 권한은 미검증' : providerInput.value === 'openai' ? 'OpenAI API 목록에 있는 번역 지원 GPT 모델' : 'Google에서 조회한 생성 모델'}`;
  selection(); renderPrices();
}
function resetModels() { catalogId = ''; models = []; modelInput.value = ''; search.value = ''; familyInput.replaceChildren(new Option('전체 계열', '')); renderCards(); }
function keyHint() {
  keyState.textContent = savedInput.value ? `${providerName()} · 목록 조회에 사용할 저장 키: ${savedInput.value}. 저장 키는 재표시하지 않습니다.` : `${providerName()}에서 발급받은 새 모델용 API 키를 입력하세요.`;
  document.getElementById('provider-note').textContent = providerInput.value === 'openai' ? 'OpenAI 공식 API에 직접 연결합니다. ChatGPT 구독과 API 요금은 별도입니다. 지원 모델 목록에서 선택하며 공급자 선택만으로 활성 모델이 바뀌지는 않습니다.' : providerInput.value === 'kie' ? 'kie.ai가 여러 모델 제공자를 중개합니다. 현재 텍스트·자막 지원. 이미지 번역은 Google AI Studio 모델을 사용하세요. 공급자 선택만으로 활성 모델이 바뀌지는 않습니다.' : 'Google AI Studio에서 직접 번역합니다. 공급자 선택만으로 활성 모델이 바뀌지는 않습니다.';
  apiKeyInput.placeholder = `${providerName()} API 키`;
}
function showProfiles() {
  savedInput.replaceChildren(new Option('새 모델 추가', ''));
  for (const item of currentProfiles()) savedInput.append(new Option(`${label(item)}${item.id === activeModel && providerInput.value === activeProvider ? ' · 사용 중' : ''}`, item.id));
  savedInput.value = providerInput.value === activeProvider ? activeModel : '';
  const legacy = profiles.filter(item => item.provider === 'kie');
  document.getElementById('legacy-keys').hidden = !legacy.length;
  const list = document.getElementById('legacy-key-list'); list.replaceChildren();
  for (const item of legacy) {
    const row = document.createElement('p'), name = document.createElement('span'), button = document.createElement('button');
    name.textContent = `${label(item)} · 사용 중지 `;
    button.type = 'button'; button.textContent = '키 삭제';
    button.addEventListener('click', () => void mutate({ type: 'DELETE_MODEL', provider: 'kie', model: item.id }, '레거시 모델 키를 삭제했습니다. 통계는 유지됩니다.'));
    row.append(name, button); list.append(row);
  }
  keyHint(); controls();
}
function showSettings(data) {
  activeModel = data.model ?? ''; activeProvider = data.provider ?? 'google'; profiles = data.profiles ?? [];
  showConsent(data); showProfiles();
}
function showModels(data) {
  if (data.provider && data.provider !== providerInput.value) return;
  catalogId = data.catalogId; models = data.models ?? [];
  modelInput.value = models.some(item => item.id === savedInput.value) ? savedInput.value : '';
  familyInput.replaceChildren(new Option('전체 계열', ''), ...[...new Set(models.map(family))].map(name => new Option(name, name)));
  renderCards();
}
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error ?? 'WORKER_INTERRUPTED');
  return result.data;
}
busy = true; controls(); resetModels();
request({ type: 'STATUS' }).then(data => {
  providerInput.value = data.provider === 'openai' ? 'openai' : 'google'; showSettings(data);
  void updatePrices();
  status.textContent = data.notice ? TranslatorCore.errorMessage(data.notice) : data.configured ? `사용 중: ${TranslatorCore.providerName(data.provider)} · ${data.model}` : '공급자와 키를 확인하고 모델 목록을 불러오세요.';
}).catch(error => { status.textContent = TranslatorCore.errorMessage(error.message); }).finally(() => { busy = false; controls(); });
document.addEventListener('consent-accepted', () => { status.textContent = '이번 버전의 원문 전송에 동의했습니다.'; });
providerInput.addEventListener('change', () => { generation++; loading = false; apiKeyInput.value = ''; resetModels(); showProfiles(); void updatePrices(); });
savedInput.addEventListener('change', () => { generation++; loading = false; apiKeyInput.value = ''; resetModels(); keyHint(); });
apiKeyInput.addEventListener('input', () => { generation++; loading = false; resetModels(); modelState.textContent = '키 입력이 변경됐습니다. 모델 목록을 다시 불러오세요.'; });
search.addEventListener('input', renderCards); familyInput.addEventListener('change', renderCards);
loadModels.addEventListener('click', async () => {
  const current = ++generation; loading = true; resetModels(); modelState.textContent = `${providerName()} 모델 목록을 불러오는 중…`;
  try { const data = await request({ type: 'LOAD_MODELS', provider: providerInput.value, apiKey: apiKeyInput.value.trim(), credentialModel: savedInput.value }); if (current === generation) { showModels(data); void updatePrices(); } }
  catch (error) { if (current === generation) modelState.textContent = TranslatorCore.errorMessage(error.message); }
  finally { if (current === generation) { loading = false; controls(); } }
});
async function mutate(message, success) {
  generation++; loading = false; busy = true; controls();
  try { const data = await request(message); apiKeyInput.value = ''; resetModels(); showSettings(data); status.textContent = success; }
  catch (error) { resetModels(); status.textContent = TranslatorCore.errorMessage(error.message); }
  finally { busy = false; controls(); }
}
document.getElementById('settings-form').addEventListener('submit', event => {
  event.preventDefault(); if (save.disabled) return;
  void mutate({ type: 'SAVE_SETTINGS', provider: providerInput.value, apiKey: apiKeyInput.value.trim(), model: modelInput.value, catalogId }, `사용 중: ${providerName()} · ${modelInput.value} · 저장된 키를 사용합니다.`);
});
activate.addEventListener('click', () => void mutate({ type: 'ACTIVATE_MODEL', provider: providerInput.value, model: savedInput.value }, `사용 중: ${providerName()} · ${savedInput.value}`));
remove.addEventListener('click', () => void mutate({ type: 'DELETE_MODEL', provider: providerInput.value, model: savedInput.value }, `삭제됨: ${providerName()} · ${savedInput.value}. 다른 공급자·모델 키는 유지됩니다.`));
clear.addEventListener('click', () => void mutate({ type: 'CLEAR_SETTINGS' }, '모든 공급자의 모델 키와 임시 목록을 삭제했습니다. 전송 동의와 통계는 유지됩니다.'));

const cacheStatus = document.getElementById('video-cache-status'), cacheClear = document.getElementById('clear-video-cache'), cacheRefresh = document.getElementById('refresh-video-cache');
async function refreshVideoCache() {
  cacheClear.disabled = true; cacheRefresh.disabled = true;
  try { const data = await request({ type: 'VIDEO_CACHE_STATUS' }); cacheStatus.textContent = `${data.videos}/${data.maxVideos}개 영상 · ${(data.bytes / 1048576).toFixed(2)} / ${(data.maxBytes / 1048576).toFixed(0)} MiB` + (data.warning ? ' · 저장소 확인 필요' : ''); }
  catch { cacheStatus.textContent = '영상 번역 저장 현황을 확인하지 못했습니다.'; }
  finally { cacheClear.disabled = false; cacheRefresh.disabled = false; }
}
cacheRefresh.addEventListener('click', () => void refreshVideoCache());
cacheClear.addEventListener('click', async () => {
  if (!confirm('저장된 영상 번역을 모두 삭제할까요? 다음 방문에서는 다시 번역합니다. API 키와 사용 통계는 유지됩니다.')) return;
  cacheClear.disabled = true;
  try { await request({ type: 'VIDEO_CACHE_CLEAR' }); await refreshVideoCache(); }
  catch { cacheStatus.textContent = '영상 번역 캐시를 삭제하지 못했습니다.'; }
  finally { cacheClear.disabled = false; }
});
void refreshVideoCache();
