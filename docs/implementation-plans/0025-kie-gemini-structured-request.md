# 0025 — Gemini 3.8 JSON 출력 요청 보완 (0.14.3)

## 구현 전 계획

- 사용자 재현은 0.14.2에서 KIE_TRANSLATION_JSON이다. 이는 HTTP 응답 읽기와 완료 메시지 추출 후 번역 텍스트 JSON 파싱 실패를 뜻한다. 빈 출력·일반 문장·깨진 JSON 중 어느 것인지는 실제 응답을 읽지 않아 확정할 수 없다.
- 코드에서 정확한 Gemini 3.8 등록 모델의 schema:false로 인해 response_format을 보내지 않는 것을 확인했다. 기존 수정은 코드블록/native 외피 호환성을 보완했으나 요청은 프롬프트에만 의존했다.
- 허가된 공식 Kie 3.8 OpenAI 문서의 markdown 예제에는 response_format이 있지만 상세 요청 속성에는 없으며 축약 예시도 불완전하다. Gemini 3 Pro 문서의 ResponseFormat에는 type:json_schema / json_schema:{name:structured_output,strict:true,schema:...}가 명시되어 있다. 이 동일 공급자 OpenAI 형식을 3.8에 적용하는 호환성 가설을 검증 가능한 요청으로 구현한다. 3.8의 실제 스키마 지원을 확인했다고 주장하지 않는다. native API 경로/인증 방식 전환은 하지 않는다.
- Gemini 3.8에 한해 기존 구조화 스키마 생성기를 활성화하고 문서의 structured_output 이름을 쓴다. 구간 수·ID enum·필수 필드·추가 필드 금지, include_thoughts:false와 stream:false를 유지한다. 400/404 거절 시 스키마를 빼서 재호출하거나 모델/키를 바꾸지 않는다.
- JSON 실패를 빈 출력(KIE_TRANSLATION_EMPTY), JSON으로 시작하지 않는 텍스트(KIE_TRANSLATION_TEXT), JSON 문법 오류(기존 KIE_TRANSLATION_JSON)로 구분한다. 안전한 코드만 표시하며 응답 발췌·구문 오류의 원시 메시지·원문/키 로그를 추가하지 않는다. 설명문 속 JSON 발췌/복구도 하지 않는다. 기존 공통 Kie 파싱 경로의 분류만 세분화한다.
- 변경 대상: kie-models.mjs, kie.mjs, core.js, 기존 테스트, 확장/package 버전, README·구조·보안·트러블슈팅. 키 저장·권한·전송 대상·사용량 저장·schema14는 유지한다.
- 검증: 실제 전송 body의 정확한 3.8 스키마/구간 ID 확인, 다른 모델 요청 회귀, 응답에 따른 오류 분류, 출력/HTTP 거절 후 usage와 재호출 없음, 자막 세션 OFF·타이머 정리. 전체 테스트·구문/설정·보안 하네스. 실제 API 키/유료 호출은 하지 않는다.

## 결과

구현 완료. 확장/package 0.14.3, 보안 정책 schema14 유지. 실제 공급자 검증은 미실행이다.

- Gemini 3.8 요청에 strict JSON schema(정확한 구간 수·ID enum·id/text 필수·추가 필드 금지)를 넣었다. 이름은 structured_output이다. 경로·인증·입력 내용과 기존 stream:false/include_thoughts:false를 유지했다. 다른 모델의 구조화 옵션은 변경하지 않았다.
- 모의 실제 전송 body에서 1/2/64개 구간의 스키마와 입력 일치를 확인했다. 역순 번역도 ID 기준으로 수용하며 기존 ID 오류는 계속 거절한다. 서버가 400/404를 반환하면 요청 1회 뒤 종료하고 확인된 사용량을 기록한다. 스키마 제거·다른 모델 자동 재호출은 없다.
- 빈 출력/공백만 있는 코드블록, 일반 문장/설명문, 잘못된 JSON/코드블록을 구분했다. 오류 코드는 상수만 사용하며 원시 JSON.parse 오류를 노출하지 않는다. 실패에도 usage 기록과 자막 OFF·타이머 정리를 유지한다.
- 신규 테스트 3개와 기존 회귀 수정 포함 전체 205개 PASS. JavaScript 59개·JSON/권한 검사 PASS. 보안 하네스 PASS.
- 공식 문서의 지원 불명확성이 남는다. 이 테스트는 요청 생성/검증/오류 처리를 검증하며 실제 Gemini 3.8이 스키마를 수용·준수함을 증명하지 않는다. 실제 호출 없이 사용자 사건의 최종 해결을 확정하지 않는다.

## 확인한 공식 자료

- [Gemini 3.8 OpenAI](https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai), [원문 markdown](https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai.md): 상세 properties에 response_format은 없지만 schema.examples 안에는 축약된 json_schema 예제가 있다.
- [Gemini 3 Pro OpenAI](https://docs.kie.ai/market/gemini/gemini-3-pro), [원문 markdown](https://docs.kie.ai/market/gemini/gemini-3-pro.md): components.schemas.ResponseFormat의 nested json_schema와 structured_output 이름을 확인했다. 3.8의 동작 보장이 아니라 같은 공급자 형식의 구현 근거로 사용했다.
- [Gemini 3.8 native](https://docs.kie.ai/market/gemini/gemini-3-8-flash.md): streamGenerateContent·thinkingConfig는 있지만 JSON 응답 스키마 설정이 명시되어 있지 않아 대체 경로로 변경하지 않았다. 모두 2026-09-07 읽기 확인, API 인증/번역 호출 없음.
