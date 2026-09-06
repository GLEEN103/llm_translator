# 페이지 자막 버튼 테마·크기·클릭 (0.10.2)

## 증상과 코드에서 확인한 경로

사용자 첨부 화면에서 다크테마의 자막 번역 글자가 검고 주변 버튼보다 작게 표시됐다. 기존 CSS는 YouTube 변수 미정의 시 검정 글자 fallback과 36px/14px 고정값을 사용했다.

클릭 경로는 sender 문서 URL의 watch ID와 현재 영상 ID가 같아야 진입할 수 있었다. 홈/이전 watch URL을 가진 동일 문서 sender와 현재 watch URL을 모의하면 정상 문서도 거절하는 조건이었다. 후속 자막 요청도 같은 검사를 사용했다. 사용자 환경의 모든 클릭 실패가 이 조건 때문인지는 실제 Chrome 통합에서 확인하지 못했다. 클릭 이벤트 전파와 무응답 시 영구 비활성 가능성도 함께 보완했다.

## 변경

[계획 0015](../implementation-plans/0015-launcher-theme-size-click.md)에 따라 html/body dark 상태를 읽어 글자/배경을 명시적으로 적용한다. 인접 좋아요/공유 버튼의 높이·계산된 서체/크기/굵기를 맞춘다. 원래 버튼은 수정하지 않는다. host는 pointer-events를 명시하고 trusted 클릭의 상위 전파를 막는다. 응답 대기는 최대 20초 후 UI 잠금을 해제한다.

sender는 정확한 YouTube 출처·origin·메인 프레임·문서 ID로 검사하고 현재 영상은 탭 URL과 고정 문서 location.href로 판단한다. 자막 읽기/번역도 현재 탭 영상·grant·MAIN 문서 검증을 유지한다. 키·동의·권한·서버 정책은 바꾸지 않는다.

## 검증

- `npm test` 115개 통과. SPA 홈/이전 watch sender의 현재 문서 열기, 후속 자막 수집/번역, origin 불일치·고정 문서 URL 불일치 거절을 추가했다.
- `npm run check`: JavaScript 45개·JSON·진입점·권한 통과. PowerShell 하네스 통과.
- 모의 브라우저에서 다크 글자 `#f1f1f1`, 라이트 `#0f0f0f` 전환과 화면 표시를 확인했다. 실제 측정한 버튼/인접 버튼 높이는 40/40px 및 변경 후 48/48px였다.
- 실제 마우스 클릭, Tab 이동 후 Enter로 패널 열기를 확인했다. 무응답 fixture에서 비활성 상태가 풀린 뒤 같은 페이지에서 재클릭하여 정상 패널을 열었다.
- 기존 버튼 위치/중복/SPA/영역 교체 회귀 8개도 통과했다.
- 실제 키 열람/Google API 호출은 없다. 공개 사이트에 설치한 Chrome 확장 전체 통합은 미검증이다. fixture는 네트워크와 chrome API를 모의한다.

## 적용

확장 0.10.2를 새로고침한 뒤 열려 있는 YouTube 페이지도 한 번 새로고침한다. 기존 페이지에 남은 이전 content script는 새 코드로 교체되어야 한다. 클릭 후 설정 화면이 열리면 이번 버전 전송 동의와 활성 모델을 확인한다.

참고: [Chrome MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)는 메시지 연결 문맥의 URL/origin/documentId를 설명한다. SPA에서 주소가 남는 구체적 조건은 위 모의 사례이며 실제 모든 Chrome 환경에서 발생한다고 단정하지 않는다.
