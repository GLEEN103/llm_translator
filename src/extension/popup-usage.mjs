import { filterUsage, summarizeUsage } from './usage.mjs';
import { formatNumber, showTokens } from './usage-ui.mjs';
const box = document.getElementById('today-usage');
let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'USAGE_GET' });
    if (!result?.ok) throw Error('Usage unavailable');
    const snapshot = result.data, sum = summarizeUsage(filterUsage(snapshot.rows, { today: snapshot.today, days: 1 }));
    document.getElementById('today-date').textContent = snapshot.today;
    for (const key of ['input', 'output', 'total']) showTokens(document.getElementById(`today-${key}`), sum, key);
    box.textContent = `요청 ${formatNumber(sum.attempts)}건 · 미확인 ${formatNumber(sum.unknown)}건${snapshot.writeWarning ? ' · 저장 오류 있음' : ''}`;
  } catch {
    box.textContent = '사용량을 불러오지 못했습니다. 통계 페이지에서 다시 확인하세요.';
    for (const key of ['input', 'output', 'total']) { const element = document.getElementById(`today-${key}`); element.textContent = '—'; element.removeAttribute('title'); element.removeAttribute('aria-label'); }
  } finally { busy = false; }
}
document.getElementById('statistics').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('statistics.html') }).catch(() => { box.textContent = '통계 페이지를 열지 못했습니다. 다시 시도하세요.'; });
});
setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
void refresh();
