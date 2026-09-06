export const formatNumber = value => new Intl.NumberFormat('ko-KR').format(value);
export function compactTokens(value) {
  const units = ['', 'K', 'M', 'B', 'T', 'Q'];
  let scale = 0, amount = value;
  while (amount >= 1000 && scale < units.length - 1) { amount /= 1000; scale++; }
  amount = Math.round(amount * 10) / 10;
  if (amount >= 1000 && scale < units.length - 1) { amount /= 1000; scale++; }
  return `${amount}${units[scale]}`;
}
export function tokenText(summary, key) {
  if (summary.attempts && !summary.known[key]) return '—';
  return `${compactTokens(summary.tokens[key])}${summary.known[key] < summary.attempts ? '*' : ''}`;
}
export function exactTokenText(summary, key) {
  return summary.attempts && !summary.known[key] ? '확인된 토큰 없음' : `${formatNumber(summary.tokens[key])} 토큰${summary.known[key] < summary.attempts ? ' · 일부 미확인' : ''}`;
}
export function showTokens(element, summary, key) {
  element.textContent = tokenText(summary, key);
  element.title = exactTokenText(summary, key);
  element.setAttribute('aria-label', element.title);
}
