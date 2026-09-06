# 자막 UI 완전 숨김과 Shorts — 0.11.0

## 기존 동작과 원인

접기는 body만 숨겨 패널 헤더가 계속 남았다. URL/플레이어 선택은 watch와 movie_player에 고정되어 Shorts를 열 수 없었다. 현재 공개 Shorts DOM에서는 shorts-player와 renderer 밖 reel-action-bar-view-model을 확인했으며 renderer의 active 속성을 전제로 삼을 수 없었다.

## 변경

UI 숨기기는 패널 전체, 패널·자막 숨기기는 영상 위 확장 표시를 전부 숨긴다. 두 경우 ON/결과는 유지하며 페이지 번역 버튼 또는 확장 팝업으로 복원한다. 요청을 멈추려면 OFF, 결과까지 지우려면 닫기를 사용한다.

watch/Shorts URL 검증과 가시 영상 선택을 적용했다. Shorts의 오른쪽 작업 영역에서 번역 버튼을 제공하고 현재 영상의 제작자/자동자막을 번역한다. 숨겨진 선행 로드 player는 제외하며 다음 Shorts/활성 video 교체는 기존 작업을 종료한다. 새 영상은 자동 번역하지 않는다. 닫힌 작업의 진행 중 MAIN 호출은 기존 제한 안에서 정리되고 늦은 결과를 재사용하지 않는다.

## 재현 및 검증

개발 전용 `node tools/browser-fixture.mjs`와 `/shorts/abcdefghijk`에서 버튼 → ON → UI 숨기기 → 버튼 복원 → 패널·자막 숨기기 → 복원 → 4초 탐색 → 영상 변경을 클릭했다. 패널/자막의 표시, ON 유지, 동일 문장 재요청 없음, 다음 영상의 OFF 시작을 확인했다. 일반 watch의 패널 숨김도 확인했다. 실제 API 호출은 0회다.

Node 120/120, JS 48개 구문/JSON/manifest 검사, 하네스 PASS. 브라우저 Shorts DOM 4/4, watch 버튼 8/8, 자막 XML/JSON DOMParser 8/8 PASS. [구현계획과 상세 결과](../implementation-plans/0016-hidden-panel-and-shorts.md).

실제 설치된 Chrome/YouTube/Google API 연동과 모든 Shorts 레이아웃은 미검증이다. 자막 없는 Shorts는 음성 인식으로 대체하지 않는다. 새 레이아웃에서 페이지 버튼이 없으면 확장 팝업으로 열 수 있으나, 플레이어/자막 접근 자체가 달라지면 추가 대응이 필요하다.
