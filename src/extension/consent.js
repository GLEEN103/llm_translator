(() => {
  const section = document.getElementById('consent'), button = document.getElementById('accept-consent');
  const cacheNotice = document.createElement('p');
  cacheNotice.textContent = '응답 형식 오류는 최대 3회 재시도하며 추가 API 사용료가 발생할 수 있습니다. 성공한 영상 번역은 최근 30건까지 이 기기에 저장합니다(최대 4 MiB). API 설정에서 삭제할 수 있습니다.';
  section.append(cacheNotice);
  let version;
  globalThis.showConsent = data => {
    version = data.version;
    section.hidden = data.consentAccepted;
    button.disabled = !version;
    document.getElementById('consent-version').textContent = `버전 ${version} · 설치 또는 업데이트 후 최초 1회`;
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ACCEPT_CONSENT', version });
      if (!result?.ok) throw new Error(result?.error ?? 'WORKER_INTERRUPTED');
      showConsent(result.data);
      document.dispatchEvent(new CustomEvent('consent-accepted', { detail: result.data }));
    } catch (error) {
      document.getElementById('status').textContent = TranslatorCore.errorMessage(error.message);
    } finally { button.disabled = !version; }
  });
})();
