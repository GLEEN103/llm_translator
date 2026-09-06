import { filterUsage, summarizeUsage, groupUsage } from './usage.mjs';
import { formatNumber, tokenText, showTokens, exactTokenText } from './usage-ui.mjs';
const $ = id => document.getElementById(id);
let snapshot, busy = false;
const modelKey = row => `${row.provider}:${row.model}`;
const modelLabel = key => `${key.startsWith('openai:') ? 'OpenAI (GPT)' : key.startsWith('kie:') ? 'kie.ai' : 'Google AI Studio'} · ${key.slice(key.indexOf(':') + 1)}`;
function table(id, groups, bars = false) {
  const body = $(id); body.replaceChildren();
  const max = Math.max(1, ...groups.map(group => group.tokens.total));
  for (const group of groups) {
    const tr = document.createElement('tr'), name = document.createElement('th');
    name.scope = 'row'; name.textContent = id === 'models' ? modelLabel(group.name) : group.name; tr.append(name);
    for (const key of ['total', 'input', 'output', 'thoughts']) {
      const td = document.createElement('td'), value = document.createElement('span'); showTokens(value, group, key); td.append(value);
      if (bars && key === 'total') {
        const bar = document.createElement('div'); bar.className = 'usage-bar'; bar.style.width = `${100 * group.tokens.total / max}%`; bar.setAttribute('aria-hidden', 'true'); td.append(bar);
      }
      tr.append(td);
    }
    const count = document.createElement('td'); count.textContent = `${formatNumber(group.attempts)} / ${formatNumber(group.unknown)}`; tr.append(count); body.append(tr);
  }
}
function render() {
  if (!snapshot) return;
  const rows = filterUsage(snapshot.rows, { today: snapshot.today, days: Number($('period').value), model: $('model').value.split(':').slice(1).join(':'), provider: $('provider').value, kind: $('kind').value }).filter(row => !$('model').value || modelKey(row) === $('model').value);
  const sum = summarizeUsage(rows);
  for (const key of ['input', 'output', 'thoughts', 'total']) {
    showTokens($(key), sum, key);
    $(`${key}-note`).textContent = sum.attempts === 0 ? '요청 없음' : `${formatNumber(sum.known[key])}건에서 확인 · 미제공 ${formatNumber(sum.attempts - sum.known[key])}건`;
  }
  $('summary').textContent = `요청 ${formatNumber(sum.attempts)}건 · 입력/출력/전체 확인 ${formatNumber(sum.reported)}건 · 미확인 ${formatNumber(sum.unknown)}건`;
  $('cached').textContent = `캐시 입력: ${tokenText(sum, 'cached')} 토큰 (입력에 포함)`;
  $('cached').title = exactTokenText(sum, 'cached');
  $('empty').hidden = rows.length > 0;
  table('daily', groupUsage(rows, 'date').sort((a, b) => b.name.localeCompare(a.name)), true);
  table('models', groupUsage(rows, 'model').sort((a, b) => b.tokens.total - a.tokens.total || a.name.localeCompare(b.name)));
  $('retention').textContent = `요청 시작 시 기기 날짜 기준 · 현재 ${snapshot.timeZone} · 오늘 ${snapshot.today}. 최근 ${snapshot.limits.days}일, 최대 ${formatNumber(snapshot.limits.rows)}개 날짜·모델·기능 집계까지 보관합니다. ${snapshot.startedOn ? `기록 시작: ${snapshot.startedOn}.` : '아직 기록이 없습니다.'} 기기 시간대 변경은 과거 기록 날짜를 바꾸지 않습니다.`;
  $('status').textContent = snapshot.writeWarning ? '일부 완료 기록 저장에 실패했습니다. 미확인 요청에 실제 사용량이 있을 수 있습니다.' : '확인된 토큰 기준 · 이 페이지가 열려 있으면 15초마다 갱신합니다.';
  $('clear').disabled = busy || !snapshot.rows.length;
}
async function refresh(type = 'USAGE_GET') {
  if (busy) return;
  busy = true; $('refresh').disabled = true; $('clear').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (!result?.ok) throw Error('Usage unavailable');
    snapshot = result.data;
    const selection = $('model').value, models = [...new Set(snapshot.rows.map(modelKey))].sort();
    $('model').replaceChildren(new Option('전체 모델', ''), ...models.map(model => new Option(modelLabel(model), model)));
    if (models.includes(selection)) $('model').value = selection;
    render(); $('updated').textContent = `최근 갱신 ${new Date().toLocaleTimeString('ko-KR')}`;
  } catch {
    $('status').textContent = type === 'USAGE_CLEAR' ? '통계를 삭제하지 못했습니다. 다시 시도하세요.' : '통계를 불러오지 못했습니다. 새로고침을 눌러 다시 시도하세요. 기존 숫자는 마지막 조회 결과입니다.';
  } finally { busy = false; $('refresh').disabled = false; $('clear').disabled = !snapshot?.rows.length; }
}
$('provider').addEventListener('change', () => { $('model').value = ''; });
for (const id of ['period', 'model', 'kind', 'provider']) $(id).addEventListener('change', render);
$('refresh').addEventListener('click', () => refresh());
$('clear').addEventListener('click', () => {
  if (window.confirm('모든 기간의 토큰 통계를 삭제할까요? 복구할 수 없습니다. API 설정과 번역 결과는 유지됩니다.')) void refresh('USAGE_CLEAR');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
void refresh();
