# 0022 — kie.ai 공개 가격 갱신과 Chat 모델 확대 (0.14.0)

## 구현 전 계획

- 모델 카드에 입력·출력 100만 토큰당 USD와 크레딧, 조회 시각을 표시한다. 공식 가격 화면 `https://kie.ai/pricing`이 사용하는 인증 없는 `POST https://api.kie.ai/client/v1/model-pricing/page`의 Chat 행을 조회한다. 원문·키·쿠키·계정 정보는 보내지 않는다.
- 가격표의 creditPrice와 usdPrice를 함께 사용한다. usdPrice는 공식 화면의 달러 환산값이며 환산율을 영구 고정하지 않는다. 현재 공개 행 대부분은 1크레딧=$0.005이나 일부 USD 표시는 반올림되어 있다. 공식 달러 표시를 임의로 재할인하거나 타사 비교용 falPrice/discountRate를 현재 가격으로 사용하지 않는다. 지역·계정별 가격은 공개 가격과 다를 수 있다.
- 정확한 모델명 별칭+공급자+Chat+입력/출력+백만 토큰 단위를 검증한다. 캐시·도구 가격을 일반 입력 가격으로 섞지 않는다. 충돌/단위 누락/범위 밖 값/없는 행은 가격 미확인으로 표시하고 0으로 추정하지 않는다. 원격 URL/코드는 실행하지 않는다.
- 가격은 모델 목록 조회와 독립적으로 options 전용 메시지로 요청한다. kie.ai 화면 최초 진입, 모델 목록 조회 후, 표시 중 5분마다 및 수동 가격 새로고침으로 갱신한다. 중복 조회는 합치고 background에서 30초 최소 간격을 적용한다. 실패하면 이전 조회값임을 명시하며 5분 이상 값에는 재확인 필요를 표시한다. 설정 화면 종료 시 주기 조회를 중단하고 가격은 background 메모리에만 둔다.
- 가격 조회는 고정 출처·18초·페이지당 512 KiB·최대 10페이지/1,000행으로 제한한다. 가격 실패로 모델 선택·번역을 막지 않는다. 신규 호스트/서버/유료 호출은 추가하지 않는다. 정책 schema14로 공개 가격 예외를 명시한다.
- 공식 Chat 문서의 요청 경로/모델 ID를 확인하여 GPT 5.4·5.6 Luna/Terra/Sol·6 Astra, Codex 5종, Claude 8종, Gemini 3.5/3.6/3.7 Flash OpenAI 경로, Grok 4.3/4.5/4.6을 추가한다. 같은 Gemini의 native 경로는 중복 카드로 추가하지 않는다. 이미지/영상/음악 생성 모델은 제외한다.
- 기존 모델별 키·동의·묶음 응답 검증·통계와 Google 동작을 유지한다. 새 모델은 저장 키를 자동 상속하지 않는다. 확인하지 못한 출시일을 추정하지 않는다.

## 검증 계획

가격 pagination·할인/환산 변경·실패·중복·정확한 매칭·미확인 단위·캐시 제외·취소/시간/크기 제한·options 송신자·인증정보 비전송, 모든 추가 모델의 고정 경로/요청 body/완료 응답을 모의 테스트한다. 실제 공개 가격 조회는 키 없이 읽기만 검증한다. 브라우저에서 가격 표시·수동 갱신·실패 표시·Google 전환과 선택 유지, 구문·하네스 확인 후 문서를 갱신한다.

## 결과

완료. 확장/package 0.14.0, 보안 schema14. 기존 10개에 24개를 추가해 34개 Chat 모델을 지원한다. 네트워크 호스트와 서버 구성은 변경하지 않았다.

- `kie-pricing.mjs`와 options 전용 `KIE_PRICES` 경로, 카드 USD/크레딧 툴팁·조회 시각·수동/자동 갱신·이전값/미확인 표시를 구현했다. 가격 실패는 모델 저장·번역에 영향을 주지 않는다.
- 실제 공개 문서·가격에 인증 없이 연결하여 모델 34개를 확인했다. 32개 모델은 입력/출력 모두, Claude Sonnet 4.5는 입력만 매칭했다. Sonnet 4.5 출력·Grok 4.5 양쪽은 공개 단위 누락으로 미확인이다. 모델 가격과 환산율은 번들에 고정하지 않는다.
- 자동 테스트 **194개 통과**, JavaScript **59개** 및 JSON/진입점/권한 검사 PASS, 하네스 PASS. 추가 모델별 묶음 요청·응답과 가격 파싱/갱신/실패/권한/비인증 경계를 검증했다.
- 모의 브라우저에서 34개 목록, 신규 GPT 검색, Grok 계열 필터, 가격 $0.50/$1.00 → $0.25/$0.50 변경 후 선택 유지, 실패 시 이전 시각·경고, Google 전환 시 숨김, 가격 실패 중 신규 Grok 저장을 확인했다. 다크 카드 배치와 콘솔 오류 없음을 확인했다. 5분의 실제 시간 경과를 기다리는 장시간 브라우저 검증은 하지 않았고 갱신 스케줄은 코드 검사, 재조회/제한은 모의 시간 테스트로 검증했다.
- 키 열람/실제 유료 모델 호출/Chrome 설치 통합 검증은 하지 않았다. 공식 문서의 일부 예제/필수 필드 표기가 서로 달라 정의된 경로별 스키마를 사용한다. 실서비스 호환성·지연·계정별 할인은 후속 검증 대상이다. 공개 가격 endpoint는 공식 사이트 내부 조회 방식이므로 향후 변경될 수 있고 이 경우 미확인/갱신 실패로 처리한다.

## 공식 근거

- [공개 가격 화면](https://kie.ai/pricing), [Chat 문서 인덱스](https://docs.kie.ai/llms.txt).
- [GPT 5.4](https://docs.kie.ai/market/chat/gpt-5-4), [Luna](https://docs.kie.ai/market/chat/gpt-5-6-luna), [Terra](https://docs.kie.ai/market/chat/gpt-5-6-terra), [Sol](https://docs.kie.ai/market/chat/gpt-5-6-sol), [Astra](https://docs.kie.ai/market/chat/gpt-6-astra), [Codex 5종](https://docs.kie.ai/market/codex/gpt-codex).
- [Claude Opus 4.8](https://docs.kie.ai/market/claude/claude-opus-4-8), [Fable 5](https://docs.kie.ai/market/claude/cluade-fable-5), [Sonnet 5](https://docs.kie.ai/market/claude/cluade-sonnet-5), [Haiku 4.5](https://docs.kie.ai/market/claude/claude-haiku-4-5), [Opus 4.5](https://docs.kie.ai/market/claude/claude-opus-4-5), [Opus 4.6](https://docs.kie.ai/market/claude/claude-opus-4-6), [Opus 5](https://docs.kie.ai/market/claude/claude-opus-5), [Sonnet 4.5](https://docs.kie.ai/market/claude/claude-sonnet-4-5).
- [Gemini 3.5](https://docs.kie.ai/market/gemini/gemini-3-5-flash-openai), [3.6](https://docs.kie.ai/market/gemini/gemini-3-6-flash-openai), [3.7](https://docs.kie.ai/market/gemini/gemini-3-7-flash-openai), [Grok 4.3](https://docs.kie.ai/market/grok/grok-4-3), [4.5](https://docs.kie.ai/market/grok/grok-4-5), [4.6](https://docs.kie.ai/market/grok/grok-4-6).
