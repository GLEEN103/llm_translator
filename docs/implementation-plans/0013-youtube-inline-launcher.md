# 0013 — YouTube 좋아요 옆 자막 번역 버튼 (0.10.0)

## 목적과 구현계획 (코드 변경 전)

- YouTube 일반 시청 페이지에서 플레이어와 영상 작업 버튼 영역을 인식해 좋아요/싫어요 묶음 바로 뒤에 작은 `자막 번역` 버튼을 삽입한다. 내부 좋아요 버튼은 변경하지 않는다. 알려진 좋아요 구조를 찾지 못하면 같은 영상 작업 영역 끝에 배치하며 영역 자체가 없으면 표시를 기다린다.
- YouTube 홈페이지에서 영상으로 이동하는 SPA 흐름까지 처리하기 위해 `https://www.youtube.com/*`에 가벼운 isolated content script를 정적 등록한다. `/watch`와 유효한 영상 ID·video 요소가 있을 때만 버튼을 표시한다. DOM 변경을 제한된 빈도로 확인하며 영상 이동·작업 영역 교체에도 중복 없이 재배치한다. Shorts/임베드/다른 사이트에는 버튼이 없다.
- 아이콘 클릭 전에는 activeTab이 없으므로 현재 MAIN 자막 브리지를 실행할 수 있게 정확한 `https://www.youtube.com/*` 호스트 권한을 추가한다. 전체 사이트/서브도메인 권한은 추가하지 않는다. 업데이트 시 Chrome의 사이트 권한 안내가 나타날 수 있음을 문서화한다. 서버는 추가하지 않는다.
- 버튼의 실제 사용자 클릭만 background `OPEN_VIDEO_INLINE`으로 연결한다. background는 sender 확장 ID·메인 프레임·YouTube URL·현재 탭/영상·documentId를 확인하고 기존 패널 주입/문서 grant 경로를 재사용한다. 메시지의 임의 탭 ID/URL은 사용하지 않는다. 동의/키 미설정이면 설정 화면으로 안내하고 원문은 자동 전송하지 않는다.
- 패널을 열 때 번역은 OFF다. 이미 열린 같은 영상의 패널은 설정을 펼쳐 ON·완료 결과를 유지한다. 자동 탐지는 DOM만 확인하며 자막 수집/Google 호출/키 조회를 하지 않는다. 버튼은 closed shadow UI, 키보드 접근·오류 안내·열기 중 중복 클릭 방지를 제공한다.

## 변경 대상과 보안 영향

manifest, 새 youtube-launcher.js, broker의 제한된 진입 메시지, video-content의 패널 재표시, 하네스·정책 schema v10, fixture/회귀 테스트, 설치·기획·구조·보안 문서. 기존 API 키/버전별 동의/번역 ON 전송/예산은 유지한다.

## 검증

- 공식 Chrome content scripts/activeTab 규격과 공개 테스트 영상의 작업 영역 DOM 확인.
- 모의 broker에서 아이콘/activeTab 없이 문서 고정 열기, 타 사이트/자식 프레임/오래된 문서/영상 변경 거절, 미동의·미설정 안내, 자동 API 호출 없음 검증.
- 브라우저 fixture에서 버튼 위치·클릭·중복 방지·SPA 이동·DOM 교체·대체 위치·설정/오류 안내·패널 ON 유지 확인.
- 전체 Node 테스트·구문·권한/하네스 검사 후 문서 반영. 실제 키와 Google API는 사용하지 않는다.

## 결과

- 0.10.0 구현 완료. youtube-launcher.js를 정확한 YouTube 메인 프레임에 등록하고 제한된 OPEN_VIDEO_INLINE 경로를 기존 문서 고정 패널과 연결했다. 같은 영상 패널 재열기는 ON/결과를 보존한다. 키·동의 미설정 안내, 페이지 오류 안내, 좋아요 영역 대체/재배치를 제공한다.
- `npm test` 106개 통과. `npm run check` JavaScript 45개 및 진입점/정적 주입/호스트 권한 검사 통과. PowerShell 하네스 schema v10 통과.
- 브라우저 DOM 회귀 8개 통과. 페이지 버튼 클릭, 최초 OFF, ON/완료 결과 유지하며 재열기, 설정 필요/열기 실패 안내를 실제 UI로 확인했다. 공개 YouTube 페이지에서는 현재 좋아요 DOM을 확인했고 확장 설치·Google API 연동은 수행하지 않았다.
- 기획·전체 계획·README·설치·실행 구조·보안·[트러블슈팅](../troubleshooting/2026-09-06-youtube-inline-launcher.md)에 반영했다. 서버·새 공급자·추가 전송 콘텐츠는 없다.

## 확인 자료

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts): 알려진 페이지의 자동 실행은 정적 선언, executeScript 주입은 호스트 권한 또는 activeTab이 필요하다.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): 확장 호출 동작에 따른 임시 권한이므로 페이지 진입만으로는 사용할 수 없다.
- 2026-09-06 허가된 공개 YouTube 테스트 영상의 DOM에서 `ytd-watch-metadata #top-level-buttons-computed` 아래 `segmented-like-dislike-button-view-model`과 공유 버튼을 확인했다. 기존 좋아요 묶음 전체의 다음 형제로 삽입하며 공개 페이지 관찰만 수행했다.
