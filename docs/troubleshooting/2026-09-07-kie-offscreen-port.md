# Kie 요청 전 확장 연결 중단 — 0.15.1

## 증상과 확인된 원인

0.15.0에서 자막 번역을 켜면 공급자 요청 전에 “확장 연결이 중단됐습니다”와 함께 OFF가 됐다. 격리된 실제 Chrome 152.0.7977.77에서 재현했으며, 확장 전체 종료가 아니라 새 offscreen 포트의 인증 실패였다.

정상 포트의 sender에는 id/url/origin만 있고 documentId가 없었다. 동시에 getContexts에는 정상 OFFSCREEN_DOCUMENT와 documentId가 있었다. 기존 `!sender.documentId` 검사가 이 연결을 끊어 8초 뒤 WORKER_INTERRUPTED를 반환했다. 모의 Chrome은 항상 sender.documentId를 제공했으므로 이전 테스트가 문제를 놓쳤다. Chrome의 [MessageSender 문서](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)도 documentId를 선택적 필드로 정의한다.

## 수정

- 문서 생성마다 새 UUID fragment를 사용하고 포트 URL을 현재 생성 시도에 고정한다.
- 확장 ID·정확한 URL·origin·탭 없음과 실제 OFFSCREEN_DOCUMENT의 URL/origin/tabId/documentId를 검증한다. sender.documentId가 제공되면 추가 대조하며 불일치는 거절한다.
- 초기화 8초 초과는 KIE_TRANSPORT_START_TIMEOUT, 문서 생성 실패는 KIE_TRANSPORT_START_FAILED, 포트 단절은 KIE_TRANSPORT_DISCONNECTED, Worker 시작 실패는 KIE_WORKER_START_FAILED로 구분한다. 키·원문·원시 오류는 사용자 오류에 넣지 않는다.
- 기존 180초 API 대기, 190초 UI 대기, 취소·정리·자막 자동 반복 중단은 유지한다.

## 검증

가짜 키와 응답만 사용한 실제 Chrome에서 서비스 워커에 디버거를 붙이지 않고 다음을 확인했다.

| 동작 | 결과 | 소요 시간 |
| --- | --- | --- |
| 최초 연결·응답 | 성공, 유휴 문서 0개 | 127ms |
| 45초 지연 응답 | 성공, 유휴 문서 0개 | 45,124ms |
| 문서 종료 후 새 연결 | 성공, 새 UUID, 유휴 문서 0개 | 122ms |

네트워크만 모의했으며 실제 Chrome 메시지·offscreen·Worker·CSP를 사용했다. 자동 테스트 219개, JavaScript 65개 구문·설정 검사, 보안 하네스를 통과했다. 모의 포트도 documentId 생략을 기본으로 바꾸고 잘못된 nonce/origin/탭/명시적 documentId를 거절하는 검증을 포함했다.

프로젝트 내부 증거: `tools/.tmp/kie-smoke-1788711447285/result.json`(수정 전), `tools/.tmp/kie-smoke-1788711612211/result.json`(수정 후). 검증 브라우저는 종료했다. 기존 사용자 프로필·실제 키를 읽거나 유료 요청을 보내지 않았다. 실제 kie.ai 및 YouTube 전체 통합 경로의 성공까지 보장하는 테스트는 아니다.

## 적용

Chrome 확장 관리에서 0.15.1로 새로고침하고 열린 YouTube 페이지도 새로고침한다. 이번 버전의 전송 동의 후 번역을 켠다. 재발하면 표시된 고정 오류 코드와 발생 시점으로 초기화 실패·진행 중 단절·공급자 대기를 구분한다.
