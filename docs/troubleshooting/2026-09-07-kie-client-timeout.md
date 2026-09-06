# 공급자는 번역을 완성했지만 확장이 먼저 시간 초과한 경우

## 확인한 문제

사용자는 KIE_REQUEST_TIMEOUT과 공급자에서 생성된64개 번역 결과를 제공했다.0.14.4의 이 코드는 Kie 어댑터의 자체 타이머가 요청을 취소했음을 의미한다. 기본값이 Google과 같은25초였으므로 더 늦게 완성된 결과는 수신할 수 없었다. 자막/본문 UI의 runtime 메시지 대기도29초여서 공급자 타이머만 늘려도 UI가 먼저 실패했을 것이다.

제공된 결과는 번역이 생성됐다는 자료다. 실제 HTTP 외피나 경과 시간이 제공되지는 않았으며, 채팅에 표시된 HTML 엔티티·백슬래시를 실제 API의 JSON 오류라고 판단하지 않았다. 원문이나 결과를 테스트에 복제하지 않았다.

## 0.15.0 변경

- Kie 전체 요청은 최대180초, Kie 번역 UI 메시지는190초를 기다린다. Google은25초, 일반 메시지29초, 자막 수집40초를 유지한다.
- [Chrome service worker 수명 문서](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)는 fetch 응답 대기30초 및 비활성 종료를 안내한다. 따라서 Kie 네트워크 작업을 service worker의 직접 fetch에서 offscreen 전용 Worker로 이동했다. background는 권한·키 선택·예산·usage·최종 결과 검증을 유지한다.
- [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)의 WORKERS 사유로 숨김 문서를 생성한다. 실제 문서로 검증한 전용 포트로만 요청을 보내고, 활성 작업 중20초 pulse로 background에 메시지를 전송한다. 마지막 작업 뒤 Worker·heartbeat·문서를 정리한다. 최소Chrome116과 offscreen 권한을 사용한다.
- API 키는 background가 저장소에서 읽고 검증된 포트와 요청별 Worker 메모리에만 일시 전달한다. 웹페이지/content script/브로드캐스트/로그/새 저장소에 전달하지 않는다. 고정Kie호스트/경로와 크기 제한을 강제한다. 자세한 정책은 보안문서schema15에 반영했다.
- OFF·탭/영상 변경·키 교체로 취소하면 진행 작업을 종료하고 늦은 결과는 적용하지 않는다.180초 이후 자동 재전송은 없다. 서버에서 이미 수행한 작업의 과금 취소를 보장하지 않는다.

## 검증과 적용

모의 공통 UI 메시지→어댑터→포트/host→fetch에서 45초 뒤 64개 번역 수신, 요청 1회, usage 기록, 유휴 자원 정리를 확인했다. 헤더 수신 후 본문만 55초 늦게 도착하는 경우도 통과했다. 180초 종료·동시 취소·단절·포트/URL/크기 검증 포함 217개 테스트, 64개 JS 구문/설정 검사, 보안 하네스 PASS. Chrome API/Worker는 테스트 대역이므로 실제 브라우저 수명과 유료 API 성공은 아직 검증하지 않았다.

Chrome116 이상에서 확장을 새로고침하고 새권한 안내가 있으면 확인한다. YouTube 페이지도 새로고침하고 이번 버전 전송동의를 확인한 뒤 실행한다. 이전에 취소된 결과를 대시보드에서 자동회수하지는 않는다. 공급자524나180초 초과는 이 수정 후에도 발생할 수 있다. 로컬서버는 추가하지 않았다.
