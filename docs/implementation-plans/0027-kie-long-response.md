# 0027 — Kie 정상 지연 응답 수신 (0.15.0)

## 구현 전 계획

- 사용자가 KIE_REQUEST_TIMEOUT과 공급자에서 완성된 64개 번역 결과를 제공했다. 코드상 Kie도 공통 25초 타이머로 취소되므로 이후 정상 응답을 수신할 수 없다. 전송된 원시 응답/정확한 서버 소요 시간은 확인하지 않았으며 채팅의 HTML 엔티티를 실제 API 출력으로 간주하지 않는다.
- Kie 번역 전체 대기를 180초로 분리한다. Google/목록 제한, 스키마/배치/엄격한 결과 검증은 유지한다. OFF·탭/영상 변경·키 교체·취소는 진행 중 요청을 정리한다. 시간 초과 재전송은 하지 않는다.
- Chrome 공식 문서는 service worker의 fetch 응답 30초 대기 제한도 안내한다. 단순 타이머 증가만으로 해결을 보장하지 않고, offscreen 문서에서 생성한 전용 Worker가 Kie fetch/제한된 응답 읽기를 수행한다. WORKERS 사유·offscreen 권한, runtime.getContexts용 최소 Chrome116을 적용한다. 로컬 서버는 없다.
- background의 broker가 계속 동의·문서 grant·모델별 키 선택·예산·사용량·결과 검증을 담당한다. Kie 번역 fetch만 교체하며 목록/가격/Google은 그대로다. 키는 저장소에서 background만 조회하고 검증된 offscreen 전용 포트→해당 작업 Worker에 요청 동안만 전달한다. 원래 background만 키를 보유한다는 정책을 이 제한된 trusted 전송 예외로 명시적으로 갱신한다.
- 포트는 extension ID·정확한 URL·실제 OFFSCREEN_DOCUMENT documentId·탭 없음으로 검증한다. runtime 메시지 broadcast에 키를 싣지 않는다. Worker는 고정 Kie 지원 번역 URL·POST·키 헤더·본문 크기를 검증하고 credentials:omit/redirect:error/no-store를 강제한다. 최대 응답256KiB·동시2개, 원시 오류/키/본문 로그 없음.
- 작업 중에만 20초 간격 포트 메시지로 background 수명을 유지한다. 성공/실패/취소/연결 단절 시 Worker와 타이머를 정리하고 마지막 작업 후 offscreen 문서를 닫는다. 재시작 시 고아 문서를 재사용해 요청을 재전송하지 않는다.
- 변경 대상: Kie 전송/worker/offscreen 모듈·broker 연결·manifest·정책/하네스·테스트·문서. 제품 버전0.15.0, 보안 schema15. 새 호스트/실제 API 호출 없음.
- 검증: 가상 시간으로 25초 이후 정상 응답 수신·180초 종료·취소·늦은 결과 배제·usage 및 자막 적용을 확인한다. 전용포트 인증·연결단절·동시 작업·종료 및 Worker URL/크기 제한 검증, 전체 회귀/구문/하네스. 실제 Chrome 수명/공급자 호출 검증은 실행한 범위만 보고한다.

공식 근거: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle 및 https://developer.chrome.com/docs/extensions/reference/api/offscreen (기존 허가 범위에서 확인).

## 결과

추가 추적: content.js/video-content.js에도 29초 메시지 대기 제한이 있었다. Kie TRANSLATE만190초(공급자180초+정리 여유)로 맞추고, 캡션 수집40초·기타29초는 유지한다. 공통 메시지 함수로 통합해 실제 사용 경로를 가상 시간으로 검증한다.

완료. 확장/package0.15.0, 정책schema15, 최소Chrome116.

- Kie provider180초·content/video 메시지190초로 변경했다. Google25초/일반메시지29초/자막수집40초는 유지한다. runtime 요청을 Core.requestMessage로 통합했다.
- 실제 offscreen 문서의 documentId/확장ID/URL/탭 부재를 검증한 전용 포트에만 Kie 요청을 전달한다. offscreen은 작업마다 전용 Worker를 생성하며 고정 지원 Kie URL만 POST한다. 완료/취소/단절 후 Worker를 종료하고 모든 작업이 끝나면 문서를 닫는다. 활성 작업 중에만20초 pulse를 전송한다. 영구 저장 키의 조회/선택/동의/예산/usage는 background에 유지한다.
- 가상 시간으로 공통 메시지→Kie 어댑터→포트→offscreen host→Worker fetch 로직을 통과한 모의64구간 응답을45초에 수신했다.25초/29초에 실패하지 않으며 요청1회·결과64개·usage350토큰·유휴문서/worker/heartbeat 정리를 확인했다. 테스트 원문/번역은 모두 가짜다.
- 180초 제한·사용자 취소·동시2개 중1개 취소·늦은 결과 폐기·포트 단절/다음 실행의 새문서 생성·외부URL/입력크기/응답크기 거절을 검증했다. OFF 및 키/문서 변경의 broker AbortSignal 경로를 그대로 연결했다.
- 전체 테스트 217개 PASS, JavaScript 64개·JSON/권한 검사 PASS, 보안 하네스 PASS. 헤더는 즉시 도착하고 본문은 55초 뒤 도착하는 경우도 수신했다. 시작 중 정확한 URL을 가졌어도 실제 offscreen documentId가 아닌 포트는 요청을 받지 못했다. 포트/Chrome offscreen/Worker는 테스트 대역이며 실제 Chrome 설치 상태의 생명주기·유료 Kie API 통합은 미실행이다. 모의 지연 응답 성공을 실제 공급자 복구로 보고하지 않는다.
- 새 offscreen 권한 및 최소Chrome116이 적용된다. 확장 업데이트 후 페이지새로고침·버전동의가 필요하다. 이전에 취소된 API 작업 결과를 Kie 대시보드에서 자동 회수하는 기능은 없다. 서버524와180초를 넘는 작업은 여전히 실패할 수 있으며 자동 재전송하지 않는다. 로컬서버는 필요 없다.
