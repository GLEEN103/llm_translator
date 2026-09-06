(() => {
  const launcher = globalThis.TranslatorYouTubeLauncher.install({ getVideoId: () => globalThis.TranslatorYouTubeDOM.videoId() });
  document.getElementById('theme-toggle').onclick = () => document.documentElement.toggleAttribute('dark');
  document.getElementById('launcher-checks').onclick = () => {
    const lines = [], check = (label, ok) => lines.push(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
    for (let i = 0; i < 10; i++) launcher.refresh();
    const hosts = document.querySelectorAll('[data-llm-translator-root="youtube-launcher"]');
    check('Shorts 단일 버튼', hosts.length === 1);
    check('분리된 Shorts 액션바의 좋아요 다음', document.querySelector('like-button-view-model').nextElementSibling === hosts[0]);
    check('숨겨진 선행 로드 영상 제외', globalThis.TranslatorYouTubeDOM.surface()?.player.id === 'shorts-player');
    check('세로 영상 표면', globalThis.TranslatorYouTubeDOM.surface()?.shorts === true);
    document.getElementById('launcher-status').textContent = lines.join('\n');
  };
})();
