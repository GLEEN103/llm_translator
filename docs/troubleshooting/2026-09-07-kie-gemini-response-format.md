# kie.ai Gemini 3.8 자막 번역 응답 형식 오류

## 재발 보고와 0.14.3

0.14.2에서 같은 환경으로 재시도한 결과 KIE_TRANSLATION_JSON이 보고됐다. 따라서 완료 메시지의 번역 텍스트 JSON 파싱까지 실패 지점을 좁혔으나 빈 출력·일반 문장·잘못된 JSON 중 어느 경우였는지는 알 수 없다. 0.14.2의 코드블록/native 응답 호환성 수정만으로 사용자 환경의 문제가 해결되지 않았음을 확인했다.

정확한 Gemini 3.8 모델은 schema:false여서 JSON 출력 지시문만 보내고 있었다. 0.14.3은 response_format에 strict JSON schema를 추가했다. 3.8 공식 문서는 이 옵션의 예시만 있고 상세 정의는 누락되어 있어, Kie Gemini 3 Pro의 nested json_schema 규격을 적용했다. 이는 호환성 가설이며 실제 지원을 검증한 상태가 아니다. [구현 근거·제약](../implementation-plans/0025-kie-gemini-structured-request.md).

0.14.3의 오류 코드는 다음처럼 더 구체화했다. 코드 분류는 출력의 표면 형식만 확인하며, 잘린 출력인지 모델 거절인지 의미를 추측하지 않는다.

| 코드 | 의미 |
|---|---|
| KIE_TRANSLATION_EMPTY | 완료 메시지의 번역 내용이 비어 있거나 공백뿐임 |
| KIE_TRANSLATION_TEXT | JSON 파싱 실패, 출력이 객체·배열·코드블록으로 시작하지 않음 |
| KIE_TRANSLATION_JSON | JSON/코드블록으로 시작하지만 문법·코드블록 또는 뒤따르는 텍스트로 파싱 실패 |
| PROVIDER_MODEL_OR_REQUEST | HTTP 400/404 거절. 이 코드만으로 스키마 거절이라고 단정할 수 없음 |

스키마 요청이 거절돼도 제거 후 자동 재호출하지 않는다. 다른 모델의 키/경로로 대체하지 않는다. 전체 205개 테스트와 JavaScript 59개/권한 검사·보안 하네스 PASS. 실제 키·유료 API 검증은 하지 않았다. 확장과 YouTube를 새로고침하고 이번 버전 동의를 확인한다. 재발 시 새 오류 코드가 후속 진단에 필요하다.

## 보고와 추적

Gemini 3.8 Flash로 YouTube 자막 번역 시 형식 미일치가 보고됐다. 실제 API 응답·저장 키·자막 원문은 열람하지 않았다. 다음은 코드 추적과 모의 응답 재현 결과이며 사용자 사건의 원인을 확정한 기록이 아니다.

호출 흐름은 video-session의 구간 묶음 → background 권한/설정 검사 → Kie 고정 모델 경로 → 응답 읽기 → 텍스트 추출 → JSON 파싱 → 구간 ID/구조 검증 → 세션 결과 검증이다. 이 문구만으로 YouTube 자막 수집 문제라고 판단할 수 없다.

0.14.1은 HTTP JSON, 모델 출력 JSON, 구조·ID 검증 실패를 `INVALID_PROVIDER_RESPONSE`로 묶었다. 올바른 JSON을 단일 markdown JSON 코드블록으로 감싼 모의 응답도 같은 오류로 거절됐다. bare JSON은 성공했고 ID가 바뀐 응답은 같은 오류였다.

[Kie Gemini 3.8 공식 문서](https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai)는 OpenAI chat 경로와 choices 스키마를 기재하면서 응답 예시는 Gemini candidates/usageMetadata를 사용한다(2026-09-07 확인). native text 모의 응답은 기존 어댑터에서 `PROVIDER_INCOMPLETE`였다. 보고된 형식 오류와 다른 코드이므로 실제 원인이라고 단정하지 않는다. 문서의 functionCall 예시는 번역 결과로 수용하지 않는다.

## 0.14.2 수정

- 전체가 단일 JSON 코드블록일 때만 감싸기를 제거하고 엄격한 번역 검증을 적용한다. 설명문·여러 코드블록·깨진 JSON을 추측해서 복구하지 않는다.
- 정확한 gemini-3-8-flash-openai에서 native 완료 text 후보 1개도 지원한다. include_thoughts:false를 보내고 thought 부분·도구 호출은 번역으로 사용하지 않는다. 불명확한 response_format은 활성화하지 않는다.
- native usageMetadata 숫자를 기존 통계에 정규화한다. 알려진 사용량은 번역 검증 실패에도 기록한다.
- 고정 오류 코드로 실패 단계를 구분하며 원시 응답은 로그·저장소·오류에 추가하지 않는다.

| 코드 | 실패 단계 |
|---|---|
| KIE_RESPONSE_JSON | HTTP 응답 또는 SSE 데이터가 JSON이 아님 |
| KIE_RESPONSE_ENVELOPE | 지원되는 완료 메시지 외피/텍스트 필드를 찾지 못함 |
| KIE_TRANSLATION_JSON | 모델의 번역 텍스트가 유효한 JSON이 아님 |
| KIE_TRANSLATION_SCHEMA | 필드·자료형·빈 텍스트·허용 길이가 규격과 다름 |
| KIE_TRANSLATION_IDS | 구간 개수·ID 누락·중복·변경 |
| PROVIDER_INCOMPLETE | 미완료·차단·도구 호출 등 |

형식 오류는 세션 OFF로 종료하며 자동 재호출하지 않는다. ID를 순서대로 재배정하거나 일부 번역만 적용하지 않는다.

## 검증과 재발 시 조치

전체 테스트 202개, 구문·설정 검사 59개 파일, 보안 하네스 PASS. 자막 모의 통합에서 코드블록 번역 성공, 잘못된 ID 결과 미적용, 60초 동안 요청 1회 및 OFF 전환을 확인했다. 실제 공급자 호출은 하지 않았다.

Chrome 확장 관리에서 확장을 새로고침하고 YouTube 페이지도 새로고침한다. 이번 버전 전송 동의를 확인한 뒤 재시도한다. 재발하면 화면의 괄호 안 오류 코드를 알려주면 된다. 키나 원시 응답은 공유하지 않는다. 실제 응답의 추가 진단은 별도 허가 범위에서 수행한다.
