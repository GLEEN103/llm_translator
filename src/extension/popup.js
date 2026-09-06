const status = document.getElementById('status');
function show(data) {
  showConsent(data);
  document.getElementById('page').disabled = !data.consentAccepted || !data.configured;
  document.getElementById('video').disabled = !data.consentAccepted || !data.configured;
  status.textContent = data.notice ? TranslatorCore.errorMessage(data.notice) : data.configured ? `설정됨 · ${TranslatorCore.providerName(data.provider)}\n모델: ${data.model}` : TranslatorCore.errorMessage('NOT_CONFIGURED');
}
document.addEventListener('consent-accepted', event => show(event.detail));
chrome.runtime.sendMessage({ type: 'STATUS' }).then(result => {
  if (result?.ok) show(result.data);
  else status.textContent = TranslatorCore.errorMessage(result?.error);
}).catch(() => { status.textContent = TranslatorCore.errorMessage('WORKER_INTERRUPTED'); });
document.getElementById('page').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'OPEN', mode: 'page' });
    if (!result?.ok) { status.textContent = result?.error === 'UNSUPPORTED_PAGE' ? '일반 웹페이지에서 실행하세요. Chrome 내부 페이지와 PDF는 지원하지 않습니다.' : TranslatorCore.errorMessage(result?.error); return; }
    window.close();
  } catch { status.textContent = TranslatorCore.errorMessage('WORKER_INTERRUPTED'); }
});
document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('video').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'OPEN', mode: 'video' });
    if (!result?.ok) { status.textContent = TranslatorCore.errorMessage(result?.error); return; }
    window.close();
  } catch { status.textContent = TranslatorCore.errorMessage('WORKER_INTERRUPTED'); }
});
