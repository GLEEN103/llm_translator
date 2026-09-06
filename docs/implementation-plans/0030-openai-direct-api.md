# 0030 — OpenAI GPT 직접 API 연동

## 목적과 범위

- OpenAI를 Google과 별개의 활성 공급자로 추가한다. kie.ai는 legacy-disabled 상태와 기존 키/통계를 유지한다.
- 설정에서 OpenAI 키 입력 → API 모델 목록 조회 → 지원 모델 카드 선택 → 공급자·모델별 키 저장/활성화/삭제를 제공한다. 모델명 직접 입력과 키 자동 대체는 제공하지 않는다.
- 기존 텍스트 부분/본문·YouTube 자막 번역과 이미지 번역 경로에 OpenAI 어댑터를 연결한다. 이미지는 공식 문서에서 이미지 입력과 구조화 출력을 확인한 모델만 허용한다. 입력 수집·축소·출력 오버레이는 온디바이스로 유지한다.
- 새 공급자의 입력·출력·추론·캐시·전체 토큰을 기존 통계 형식에 매핑하고 공급자 필터, 오늘 요약과 K/M 표기를 유지한다.

## 사전 조사와 확정할 사항

- 현재 모델·프로필·계약·통계의 공급자 허용 목록은 google/kie 두 개다. broker의 텍스트 공급자 분기, Google에 고정된 이미지 호출, options 초기 공급자, 통계 모델 라벨도 함께 수정해야 한다.
- 기존 Kie의 OpenAI 호환 코드는 중개 플랫폼 전용 규격이다. 직접 API 규격의 근거로 재사용하지 않고 공식 Responses/모델 목록/구조화 출력/이미지/usage 문서를 확인한다.
- 프로젝트 규칙상 외부 문서는 별도 허가가 필요하다. OpenAI 공식 도메인 developers.openai.com, platform.openai.com, openai.com 열람을 요청한다. 실제 API 키 사용·유료 호출은 포함하지 않는다.
- 공식 지원 모델 및 출시일·엔드포인트·요청/응답 형식·지원 옵션을 확인한 뒤 세부 설계를 보완하고 제품 코드를 변경한다. 모델 목록 API의 생성 시각을 출시일로 오인하지 않는다. 확인된 출시일 최근순, 미확인/가변 별칭 마지막 정책을 유지한다.
- 이전 Kie 문제를 고려하여 Chrome 서비스 워커의 응답 대기 제약과 긴 GPT 응답을 함께 검토한다. 모듈의 타임아웃만 늘리지 않는다. 호출 중단 후 중복 유료 요청이 자동 반복되지 않도록 고정 오류와 자막 OFF 처리를 설계한다.

## 변경 대상과 보안

- 신규 OpenAI 모델 목록·번역 어댑터, broker/profiles/contract/core, 이미지 경로, options/popup/통계, manifest/CSP, 보안 설정/하네스 및 관련 테스트.
- 키는 trusted local의 openai:<exact-model-id> 슬롯에 보관한다. 키 값은 UI에 재표시하지 않으며 Google/Kie에 보내지 않는다. 인증은 고정 api.openai.com의 HTTPS 헤더로만 전달한다. 원문·키·원시 오류 로그를 추가하지 않는다.
- 설치/업데이트 버전당 최초 1회 동의 문구에 OpenAI와 이미지 전송 범위를 반영한다. 사용자 선택 없이 번역을 시작하지 않는다. 요청 저장 옵션이 있다면 명시적으로 저장 비활성화한다.
- 서버·SDK 설치를 제품 필수 구성으로 추가하지 않는다. 필요한 최소 API 호스트만 manifest/CSP에 추가한다.

## 검증과 완료 조건

- 가짜 키·모의 응답으로 모델 조회 필터·정렬, 구조화 응답/ID 검사, 이미지 입력, 사용량, 인증/한도/거절/불완전 출력/시간 초과/취소를 검증한다.
- 공급자 간 키 격리, 설정 변경 취소, 과거 Kie 차단 유지, Google 회귀, 모델별 키 삭제 및 통계 재시작 보존을 확인한다.
- 전체 자동 테스트·구문/설정 검사·보안 하네스를 통과하고 README/제품 범위/실행 구조/보안/개발 안내/트러블슈팅에 결과와 실제 API 미검증 한계를 반영한다.

## 현재 상태

사용자가 공식 문서 열람을 허가했다. 공식 모델/Responses/구조화 출력/이미지 문서를 확인했으며 아래 설계로 구현한다.

## 확정 설계 (공식 문서 확인 후)

- `GET https://api.openai.com/v1/models` 결과와 번들에서 확인한 GPT 모델의 교집합만 표시한다. 초기 범위는 GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, GPT-5.5, GPT-5.4 Mini, GPT-4.1 Mini, GPT-4o Mini와 문서에 명시된 스냅샷이다. 공식 출시일/스냅샷 목록을 메타데이터로 관리하고 API created 값으로 정렬하지 않는다. 제공되지 않는 계정의 모델은 표시하지 않는다.
- `POST /v1/responses`, `store:false`, `stream:false`, `max_output_tokens:16384`, `text.format`의 strict JSON schema를 사용한다. 도구·검색·대화 이력을 보내지 않는다. GPT-6은 low, 확인한 GPT-5 계열은 low reasoning으로 번역 대기·추론량을 제한한다. GPT-4 계열에는 reasoning/temperature 옵션을 보내지 않는다.
- 이미지는 기기에서 검증한 PNG/JPEG의 data URL만 input_image로 보내고 원본 URL은 보내지 않는다. 텍스트는 기존 ID 배열을 보존하며 완료된 assistant output_text만 파싱한다. 거절/불완전/도구 호출/잘못된 ID는 적용하지 않는다.
- Google 전송과 Kie 레거시에 영향을 주지 않도록 OpenAI 전용 offscreen/Worker 모듈을 추가한다. 검증된 Kie의 생성 UUID URL·실제 context·선택적 sender.documentId 검증 방식을 별도 포트/파일에 적용한다. 최대 2개 작업, 180초 전송, 200초 UI 대기(초기화 여유 포함), 진행 중 20초 pulse와 유휴 문서 종료를 사용한다. 이미지 요청에 한해 JSON 전송 한도를 6MiB로 설정한다.
- OpenAI는 요청당 한 번만 전송하며 timeout/네트워크/5xx/429/출력 오류에서 자동 재호출하지 않는다. 자막은 고정 OpenAI 오류로 OFF가 되어 중복 과금을 방지한다. 모델 목록은 원문 없이 background에서 18초 한도로 직접 조회한다.
- 보안 schema16, 제품 버전0.16.0. 선택한 OpenAI 키는 검증된 전용 포트/작업 Worker 메모리에만 임시 전달하고 종료 시 제거한다. 원문/키 저장 추가는 없으며 usage의 숫자 필드만 기록한다. 실제 공급자 호출은 수행하지 않는다.

근거: [모델 목록](https://developers.openai.com/api/reference/resources/models/methods/list), [Responses](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [이미지 입력](https://developers.openai.com/api/docs/guides/images-vision), [출시 기록](https://developers.openai.com/api/docs/changelog), [GPT-5.6 출시](https://openai.com/index/gpt-5-6/). 모델별 기능·스냅샷 근거는 신규 모델 모듈의 공식 문서 링크에 기록한다.

## 구현 결과 — 0.16.0

- OpenAI 공급자·12개 지원 ID(8개 계열과 문서에 명시된 스냅샷 4개)의 API 교집합 조회, 공급자·모델별 키 저장/활성화/삭제, 출시일 정렬을 구현했다. 새 모델 ID를 이름 패턴만으로 자동 허용하지 않는다. 공식 일반 모델 ID에는 계열의 확인된 출시일을 부여하며 `*-latest` 같은 가변 별칭은 포함하지 않는다.
- 텍스트/본문/선택/자막은 기존 ID 단위 구조화 응답을, 이미지는 검증한 픽셀의 구조화 OCR·번역 응답을 적용한다. store:false와 strict schema, 지원 모델별 low reasoning, 오류·취소·출력 검증과 숫자 usage를 구현했다. 기존 Google 경로 및 Kie 차단 회귀를 유지했다.
- 보안 schema16에 고정 API 호스트, 메모리 전용 OpenAI 키 전달, 크기·시간·동시성 제한과 자동 반복 금지를 반영했다. 설치/업데이트 동의·UI·통계 공급자 필터와 K/M 표시를 연결했다. 키는 저장 후 입력란에서 지우며 재로드 시 재표시하지 않는다.
- 자동 테스트 **242개 PASS**. 구조화 출력/거절/JSON/ID/이미지/사용량, 고정 URL·키 헤더, 모델 목록·키·통계 재시작 보존, Google 전환 취소, Kie 차단, 자막 자동 반복 중단, 45초 지연·180초 종료·포트 검증·유휴 정리를 포함한다. OpenAI를 미지원으로 가정하던 기존 계약 테스트는 미지원 공급자 이름으로 수정했다.
- JavaScript **74개** 구문·설정 검사 PASS, 보안 하네스 PASS. 기존 전송 테스트 도구를 참고해 `tools/chrome-openai-smoke.mjs`를 추가했다. 제품에 테스트 서버/SDK 의존성을 추가하지 않았다.
- 실제 격리 Chrome **152.0.7977.77**에서 전송 초기 연결(125ms), 45초 지연 수신(45,123ms), 문서 재생성(122ms)을 검증했다. 각 작업 뒤 context 0개, 새로운 UUID 연결, 서비스 워커 디버거 미부착 상태였다. 모의 응답 경계 외에는 실제 runtime/offscreen/Worker/CSP를 사용했다.
- 같은 도구에서 실제 broker와 options UI를 사용해 OpenAI 선택·API 모의 모델 12개 조회·GPT-5.6 Luna 선택/저장·페이지 재로드 후 활성 모델 유지와 키 입력란 비움을 확인했다. 360px/1280px에서 문서 가로 넘침과 카드 잘림이 없었고 두 스크린샷을 직접 확인했다. Kie 옵션은 disabled 상태였다.
- 전송 증거 `tools/.tmp/openai-smoke-1788714715692/result.json`, UI 증거 `tools/.tmp/openai-smoke-1788714872717/result.json`과 options-360.png/options-1280.png. 첫 sandbox 실행의 Chrome target crash 이후 기존 허가 범위에서 실행하여 검증했다. 테스트 브라우저는 종료했고 기존 프로필은 열지 않았다.
- README·제품 범위·실행 구조·보안·개발 안내·작업 규칙·[트러블슈팅](../troubleshooting/2026-09-07-openai-direct-api.md)을 갱신했다.

## 남은 검증 한계

실제 API 키 사용은 허가/실행하지 않았다. 따라서 실제 계정별 모델 접근 권한, 유료 요청 결과와 번역 품질, 실제 YouTube 영상에서의 OpenAI 전체 연동은 미검증이다. 공식 규격·모의 실패 회귀·격리 Chrome 런타임/설정 UI를 검증한 결과이며 공급자 응답 안정성을 보장하지 않는다.
