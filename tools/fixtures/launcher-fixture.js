(() => {
  const api = globalThis.TranslatorYouTubeLauncher;
  const launcher = api.install({ getVideoId: () => location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') : null });
  const status = document.getElementById('launcher-status');
  document.getElementById('theme-toggle').onclick = () => { document.documentElement.toggleAttribute('dark'); };
  document.getElementById('button-size').onclick = () => { for (const el of document.querySelectorAll('#top-level-buttons-computed button')) el.style.height = el.style.height === '48px' ? '40px' : '48px'; };
  document.getElementById('launcher-checks').onclick = () => {
    const results = [], find = () => document.querySelector('[data-llm-translator-root="youtube-launcher"]');
    const check = (name, condition) => { results.push(`${condition ? 'PASS' : 'FAIL'}: ${name}`); };
    let row = document.querySelector('#top-level-buttons-computed');
    history.replaceState(null, '', '/watch?v=abcdefghijk'); launcher.refresh();
    check('좋아요 묶음 바로 뒤', row.firstElementChild.nextElementSibling === find());
    for (let i = 0; i < 10; i++) launcher.refresh();
    check('반복 감지 시 한 버튼', document.querySelectorAll('[data-llm-translator-root="youtube-launcher"]').length === 1);
    const replacement = row.cloneNode(true); replacement.querySelector('[data-llm-translator-root]')?.remove(); row.replaceWith(replacement); row = replacement; launcher.refresh();
    check('작업 영역 교체 후 복원', row.contains(find()));
    const like = row.firstElementChild; like.remove(); launcher.refresh();
    check('좋아요 구조 없으면 같은 작업 영역 끝', row.lastElementChild === find());
    row.prepend(like); launcher.refresh();
    history.replaceState(null, '', '/'); launcher.refresh(); check('홈 이동 시 제거', !find());
    history.replaceState(null, '', '/watch?v=abcdefghijk'); launcher.refresh(); check('홈에서 영상 이동 시 복원', Boolean(find()));
    history.replaceState(null, '', '/watch?v=other_video'); launcher.refresh(); check('다른 영상 이동 시 단일 버튼', document.querySelectorAll('[data-llm-translator-root="youtube-launcher"]').length === 1);
    const parent = row.parentElement; row.remove(); launcher.refresh(); check('작업 영역 없으면 제거', !find()); parent.append(row);
    history.replaceState(null, '', '/watch?v=abcdefghijk'); launcher.refresh();
    status.textContent = results.join('\n');
  };
})();
