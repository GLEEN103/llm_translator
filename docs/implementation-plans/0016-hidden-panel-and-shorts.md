# 0016 — 자막 UI 완전 숨김과 Shorts (0.11.0)

## 구현계획 (코드 변경 전)

- 기존 접기는 헤더가 남으므로 `UI 숨기기`를 추가해 설정 패널 전체를 숨긴다. 번역 ON과 자막은 유지한다. 별도 `패널·자막 숨기기`도 제공해 영상 위 확장 UI를 전부 숨기며 작업은 유지한다. 페이지 자막 번역 버튼 또는 확장 팝업에서 다시 열면 표시/설정을 복원한다. 숨김 상태는 작업 메모리에만 두고 닫기는 기존 취소/삭제다.
- URL은 정확한 www.youtube.com의 `/watch?v=ID`와 `/shorts/ID`를 지원한다. content/launcher/MAIN/background 모든 경로의 영상 식별을 맞춘다. Shorts도 제공되는 제작자/자동자막 텍스트만 번역하고 음성 인식은 추가하지 않는다.
- 활성 Shorts 플레이어 `#shorts-player`와 가시 reel renderer의 video를 구분하고 세로 영상의 위치/크기를 따라 오버레이를 표시한다. 다음 Shorts 이동 또는 활성 video 교체 시 이전 작업을 닫아 요청/늦은 결과를 차단한다. 다음 영상 자동 ON은 하지 않는다.
- Shorts의 가시 `reel-action-bar-view-model` 또는 구형 reel actions에 작은 번역 버튼을 배치한다. 일반 watch 버튼은 유지한다. 사전 로드/숨겨진 Shorts 플레이어·액션바에는 삽입하지 않는다. MAIN 반환 player response의 videoId와 현재 URL을 일치 검사한다.
- 좁은 세로 화면의 패널 헤더가 줄바꿈되도록 하며 기존 자막 크기/위치/ON/OFF/전체화면을 유지한다. 숨긴 UI는 페이지 버튼으로 복원할 수 있다.
- 권한/키/전송 범위/서버 구성은 유지하고 Shorts 접근 범위를 보안 정책에 반영한다.

## 확인 자료와 변경 대상

허가된 공개 Shorts에서 `/shorts/7SK4ZTbEQhA`, `#shorts-player`, `ytd-reel-video-renderer`, renderer 밖으로 분리된 `reel-action-bar-view-model`을 DOM으로 확인했다. 비활성 player/이동 도중 구조는 모의 테스트로 검증한다.

youtube-dom.js(공통 content 표면 식별), launcher, video-content, 두 MAIN 수집 함수, URL allowlist, manifest 주입 목록/버전, broker·하네스·정책, Shorts fixture/테스트와 관련 문서.

## 검증

watch/Shorts URL 경계·MAIN 목록/수집/fallback·다른 영상 차단을 Node로 검증한다. 브라우저에서 세로 player 타이밍·UI 숨김/모두 숨김/복원·숨김 중 ON 유지·다음 Shorts 이동 정리·단일 버튼 배치를 확인한다. 기존 테스트·구문·하네스 후 문서 반영. 실제 키/API는 사용하지 않는다.

## 결과

- 구현 완료: 0.11.0. 설정 패널 전체 숨김/패널·자막 모두 숨김, 기존 작업 복원, Shorts URL·가시 player·분리된 작업 영역과 다음 영상 정리를 반영했다. MAIN과 content는 같은 가시 면적 기준을 적용한다.
- Node 120/120 PASS: 기존 115개와 Shorts broker 진입·MAIN 수집/ID 불일치·OFF native fallback·숨겨진/화면 밖 player 제외/교체 및 플레이어 해제 중 관찰 정리 5개를 검증했다.
- 구문/JSON/manifest 권한 검사 48 JS PASS, 하네스 PASS. 실제 키나 비밀정보 파일은 읽지 않았다.
- CUA 모의 브라우저: Shorts 액션바/단일 버튼/숨겨진 선행 로드 제외/세로 표면 4/4, 일반 watch 버튼 회귀 8/8, 실제 DOMParser 자막 응답 회귀 8/8 PASS.
- 직접 클릭 검증: Shorts 패널 숨김 후 자막 유지, 전체 숨김 후 자막/헤더 제거, 페이지 버튼으로 ON/결과 복원, 숨김 중 주기 읽기 지속과 완료 문장 재요청 없음, 4초 탐색의 자막 교체, 다음 Shorts 이동 시 패널 삭제/요청 횟수 유지, 새 영상 패널 OFF. 일반 watch의 버튼 열기/ON/패널 숨김/자막 유지도 확인했다.
- 공개 YouTube는 현재 Shorts DOM 구조만 확인했다. 실제 설치된 Chrome 확장과 실제 YouTube 자막/Google API 종단 간 연동은 미검증이다. 자막 없는 영상·접근 제한·YouTube 구조 변경은 여전히 실패할 수 있다. 임베드/라이브/PIP·음성 인식은 범위 밖이다.
- 기획·사용법·실행/보안 구조·트러블슈팅 반영. 제품 서버와 외부 의존성은 추가하지 않았다.
