# 0024 — Kie Gemini 3.8 자막 응답 호환성과 오류 추적 (0.14.2)

## 구현 전 계획

- 보고된 현상: kie.ai Gemini 3.8 Flash 자막 번역에서 응답 형식 미일치. 실제 키·원문·응답은 열람하지 않는다. 기존 공통 오류는 HTTP JSON 파싱, 모델 출력 JSON, 번역 구조/ID 검증 실패를 구분하지 못한다. 사용자 사건의 정확한 원인과 모의 재현을 구분한다.
- 공식 `https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai`는 OpenAI chat 경로/스키마와 Gemini candidates 응답 예제가 혼재한다. 코드블록 JSON, 고유 응답, 잘못된 ID를 가짜 응답으로 재현한다. 문서 예제가 실제 응답을 보장한다고 가정하지 않는다.
- `kie.mjs`: 전체가 단일 JSON 코드블록인 출력만 감싸기를 제거한다. 설명문 중 JSON 발췌·깨진 JSON 복구·ID 재배정은 하지 않는다. Gemini 3.8 정확한 등록 모델에서만 완료된 native text 후보도 지원하고 thought 출력·도구 호출을 번역으로 사용하지 않는다. 해당 모델의 문서에 명시된 include_thoughts를 false로 지정한다. 불명확한 response_format 규격은 새로 활성화하지 않는다.
- HTTP JSON/응답 외피/모델 JSON/번역 구조/구간 ID 실패를 고정 오류 코드로 구분하고 `core.js` 안내에 코드를 표시한다. 완료되지 않은 출력은 계속 거절한다. 모델 재호출이나 자동 형식 복구 호출을 추가하지 않는다. usage는 출력 검증 전에 확보하며 native usageMetadata의 숫자만 기존 집계에 정규화한다.
- 변경 대상: Kie 어댑터·공통 오류 안내·회귀 테스트, 확장/package 버전, README·구조·보안·트러블슈팅 문서. Google 파서, 권한, 키 저장, 서버 구성, 정책 schema14는 유지한다.
- 보안: 원문/응답/키/URL을 로그·저장소·사용자 오류에 추가하지 않는다. 기존 응답 크기·번역 길이·정확한 ID/필드 검증을 유지한다. 형식 오류는 자막 세션 OFF로 종료해 주기적인 중복 유료 호출을 막는다.
- 검증: 모의 응답으로 기존 실패 재현 후 bare/fenced JSON, native text/thought/tool/incomplete, ID 누락·중복·변조, 잘못된 JSON/외피/스키마, 실패 시 usage, 자막 자동 재시도 중단을 확인한다. 전체 테스트·구문/설정 검사·하네스 실행 후 결과를 기록한다. 실제 API 호출은 하지 않는다.

## 결과

완료. 확장/package 0.14.2, 정책 schema14 유지.

- 수정 전 가짜 키·동일 구간 데이터로 bare JSON 성공, JSON 코드블록 `INVALID_PROVIDER_RESPONSE`, native Gemini text `PROVIDER_INCOMPLETE`, 잘못된 ID `INVALID_PROVIDER_RESPONSE`를 재현했다. 실제 응답은 확인하지 않았으므로 사용자 사건의 정확한 원인은 확정하지 않는다.
- 단일 전체 JSON 코드블록과 정확한 Gemini 3.8 모델의 native 완료 text/숫자 usageMetadata 처리를 추가했다. include_thoughts:false를 보내고 native thought 부분을 제외한다. 도구 호출·차단·미완료·혼합 외피는 거절한다. 다른 모델의 native 외피는 활성화하지 않는다.
- HTTP JSON / 외피 / 번역 JSON / 번역 구조 / 구간 ID 실패를 다섯 고정 코드로 구분했다. 실제 원문·키·응답을 오류에 넣지 않는다.
- 신규 회귀 테스트 8개 포함 전체 202개 PASS. JavaScript 59개 구문·JSON·권한 검사 PASS. 보안 하네스 PASS(비밀 파일 열람 없음).
- 자막 세션→Kie 어댑터 모의 통합에서 코드블록 번역 적용과 잘못된 ID 거절을 확인했다. 오류 시 OFF로 바뀌며 60초 경과에도 요청 1회, 결과 캐시 0개, 재시도 타이머 0개다. 검증 실패에도 확인된 숫자 usage 기록을 유지한다.
- 실제 API 키·유료 번역·실제 YouTube 통합 실행은 하지 않았다. 재발 시 화면의 고정 오류 코드로 실패 단계를 좁힌다. 키나 원시 응답을 공유할 필요는 없다.
