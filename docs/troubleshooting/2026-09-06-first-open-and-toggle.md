# 최초 자막 UI 열기 정체·페이지 버튼 토글 — 0.11.2

## 조사

최초 클릭은 background 문서 확인 → 파일 주입 → OPEN_VIDEO를 수행한다. 기존 executeScript는 injectImmediately가 없어 document_idle에 의존했다. [Chrome 공식 규격](https://developer.chrome.com/docs/extensions/reference/api/scripting)으로 기본 시점을 확인했다. 아직 로딩 중인 scripting을 모의한 회귀 테스트는 수정 전 `waiting-for-page-idle`로 실패했고 수정 후 정상 열기로 통과했다. 실제 사용자 Chrome에서 이 조건이 발생했는지는 미확인이다.

일반 영상은 화면 밖 video도 선택하며 패널은 영상 사각형에 고정된다. 최초 생성에서 화면 위치를 복구하지 않았으므로 UI가 생성돼도 보이지 않을 수 있었다. 또한 초기화 도중 state를 먼저 설정하고 예외를 정리하지 않아 불완전 상태가 재시도를 방해할 수 있었다.

## 수정

- 명시적 문서 확인/파일 주입을 즉시 실행하고 각 단계와 OPEN_VIDEO 응답 대기는 8초로 제한했다. 자막 진입은 비디오 관련 파일만 주입한다. 재시도와 늦은 주입 완료 시 후속 열기 차단을 검증했다.
- 최초 생성과 복원에서 화면 밖이면 영상으로 스크롤하고 UI를 표시한다. 초기화 예외는 불완전 state/host를 정리하고 실패를 반환한다.
- 페이지 버튼은 실제 패널 표시 상태를 토글한다. UI 켜짐 → 숨김, 숨김 → 복원. 닫기/전체 숨김도 같은 상태를 사용하며 번역 ON/언어/결과를 유지한다. 팝업은 항상 열기다.
- UI가 이미 생성되면 응답 대기 중에도 토글할 수 있다. 완료 응답은 표시 상태를 다시 바꾸지 않는다. 표시 상태는 aria-expanded에도 반영한다.

## 검증과 한계

Node 122/122 PASS: 로딩 중 최초 즉시 주입, 문서/파일/메시지 무응답 제한과 재시도·늦은 주입 완료 차단을 포함한다. JS 48개 구문/JSON/manifest 검사 PASS.

CUA 모의 브라우저에서 초기화 실패 안내 후 같은 버튼 재시도 성공, watch와 Shorts의 ON → UI 토글 OFF/ON에서 번역 1회·취소 0회 유지, 닫기/전체 숨김 후 복원을 확인했다. watch 화면 밖 video.bottom=-614px인 상태에서 첫 클릭 후 video/overlay.top=135px로 표시되는 것을 DOM과 스크린샷으로 확인했다. Shorts의 지연된 열기 응답과 반복 토글도 확인했다.

실제 API 호출은 0회다. 실제 설치된 Chrome/YouTube/Google 종단 간 연동과 사용자 환경의 단일 원인은 미검증이다. 실제로 전송된 메시지/브라우저 내부 주입 자체의 취소를 보장하지 않으며, 기존 ON 요청의 보안 검사는 유지한다. [계획과 결과](../implementation-plans/0018-first-open-and-toggle.md).
