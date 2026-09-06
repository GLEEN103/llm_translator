# 0028 — Kie 전송 초기화 연결 실패 추적

## 구현 전 계획

- 사용자는 0.15.0에서 공급자 요청 전 WORKER_INTERRUPTED로 자막이 OFF 되는 현상을 보고했다. 이는 확장 전체 프로세스 종료를 증명하지 않으며, 전송 초기화 실패도 같은 메시지로 표시된다.
- 현재 숨김 문서는 로드 중 runtime.connect를 한 번 호출하며 background는 getContexts의 documentId를 즉시 대조한다. 모의 테스트는 문서 생성과 포트/메시지 동작을 단순화했으므로 실제 Chrome에서 빠진 동작을 확인한다. 원인 확인 전에 보안 검사를 제거하거나 다른 전송 구조로 바꾸지 않는다.
- 실제 Chrome 실행 경로 사용을 사용자에게 요청했다. 허가되면 프로젝트 내부의 별도 프로필/가짜 확장으로 offscreen 생성·포트 검증·Worker 로딩·가짜 네트워크 응답을 검증한다. 사용자 기존 프로필/실제키/외부 API는 사용하지 않는다. 임시 산출물은 tools/.tmp 아래로 제한한다.
- 개발 검증 도구를 tools/에 추가한다. 제품 코드의 공개 모듈만 복사하고 네트워크 경계만 가짜 응답으로 교체한다. 실제 runtime API/메시지 순서·CSP를 유지한다. 필요 시 Chrome 내부 CDP의 제공 스키마를 읽어 격리 프로세스만 제어한다.
- 재현된 원인에 맞춰 계획을 보완한 후 코드 변경한다. 준비 실패·포트 끊김·Worker 초기화 실패의 고정 진단을 구분하되 키·원문·raw 오류는 노출하지 않는다.
- 회귀 테스트와 실제 격리 Chrome 검증 결과를 구분하고 문서에 기록한다. 검증용 브라우저는 종료하고 기존 Chrome에는 변경을 가하지 않는다.

## 조사 및 결과

실제 Chrome152 격리 테스트에서 0.15.0의 실패를 재현했다. offscreen runtime.connect의 sender에는 id/url/origin만 있고 documentId가 없었다. getContexts에는 정상 OFFSCREEN_DOCUMENT와 documentId가 있었다. !sender.documentId 검사로 정상 연결을 끊고8초 뒤WORKER_INTERRUPTED를 반환했다. 테스트 대역이 항상documentId를 제공한 것이 검증 누락이다.

## 재현 이후 수정 계획

- 숨김 문서를 만들 때마다 새 UUID fragment를 붙이고 예상 URL을 해당 생성 시도에 묶는다. 포트는 확장ID·정확한 nonce URL·origin·탭없음과 getContexts의 실제 OFFSCREEN_DOCUMENT(같은 URL/origin, tabId=-1, documentId존재)를 검증한다. sender.documentId가 제공되면 계속 정확히 대조한다. 생략된 경우에만 나머지 검증으로 허용한다. 다른 생성 시도의 포트를 재사용하지 않는다.
- 이전 고아 문서는 고정 offscreen 파일 URL(임시fragment제외)을 기준으로 정리한다. nonce에는 키/원문/설정을 넣지 않는다. 문서 종료 시 nonce도 폐기한다.
- 초기화8초초과, 생성실패, 진행중포트단절, Worker로딩실패를 고정 코드로 구분한다. 신규권한/호스트/저장소/유료요청은 없다. 버전0.15.1, 정책schema15에 검증 방식을 반영한다.
- 실제 Chrome152에서 documentId없는 정상 연결의 성공·연속 재생성·45초 지연 수신을 검증한다. 네트워크만 가짜이며 실제키는 없다. 테스트 대역도 현실의 선택적documentId를 기본으로 바꾸고 잘못된nonce/origin/명시적documentId/탭발신을 거절하는 회귀를 추가한다.
- 구문 검사 도구는 생성된 테스트 프로필과 복제 소스가 있는 `tools/.tmp`를 탐색하지 않는다. 실제 제품·개발 도구 파일만 검사한다.

## 구현 결과

- 0.15.1에서 생성별 UUID URL과 실제 offscreen context 검증을 적용했다. sender.documentId 생략을 허용하되 제공된 불일치는 거절한다. 생성 시도가 바뀌거나 이미 다른 포트가 연결됐다면 이전 후보를 거절한다.
- 전송 초기화 시간 초과/생성 실패/포트 단절/Worker 시작 실패를 고정 코드로 구분하고 자막 OFF·자동 반복 중단 회귀를 보완했다. 권한과 키 저장 정책을 유지하며 schema15에 포트 검증 방식을 기록했다.
- 격리 Chrome 152.0.7977.77에서 수정 전 실패를 재현하고 수정 후 즉시 응답(127ms), 45초 지연 응답(45,124ms), 재생성 후 응답(122ms)을 확인했다. 각 완료 뒤 offscreen context는 0개였으며 매번 새 UUID를 사용했다. 서비스 워커에는 디버거를 붙이지 않았다.
- 자동 테스트 219개, 실제 코드 JavaScript 65개 구문·설정 검사, 보안 하네스 PASS. `tools/.tmp` 생성물은 구문 검사에서 제외했다.
- README, 실행 구조, 보안 정책, 개발 안내, 작업 규칙과 [트러블슈팅](../troubleshooting/2026-09-07-kie-offscreen-port.md)을 갱신했다. 사용자 허가 범위의 격리 브라우저는 종료했으며 기존 프로필·실제 키·유료 API는 사용하지 않았다.
- 한계: 이번 Chrome 검증은 전송 모듈·공급자 어댑터의 실제 확장 런타임 검증이다. 실제 kie.ai 응답과 YouTube UI/자막 수집을 포함한 전체 통합 검증은 수행하지 않았다.
