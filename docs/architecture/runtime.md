# 실행 구조 — 확장 단독 0.18.0

## 형식 재시도와 영상 번역 보관

`Core.formatRetry`는 `INVALID_PROVIDER_RESPONSE`, `OPENAI_RESPONSE_JSON`, `OPENAI_RESPONSE_FORMAT`을 최초 요청 후 최대 3회 재시도한다. 시도 사이 5초 대기는 content에서 수행하고 로컬 동시/분당 한도 거절은 재시도 횟수에 포함하지 않는다. 본문·부분·이미지·자막이 이 처리를 공유하며 어댑터는 매 호출에 quota/usage를 다시 적용한다. Google의 기존 HTTP 429/503 재시도도 실제 시도별로 산입한다. 타임아웃·거절·불완전 생성·인증 등은 이 형식 재시도 대상이 아니다.

자막은 형식 재시도 소진 시 해당 묶음 원문을 실패 집합에 넣고 재생 시 `[번역 오류]`로 표시한다. 완료 및 실패 집합을 제외한 구간만 다음 큐로 보내므로 ON 상태에서 같은 실패를 무한 반복하지 않는다. 실패 상태는 원문으로 연결해 새 자막 수집으로 ID가 바뀌어도 유지한다. **실패 구간 재시도**는 실패 집합만 해제하며 성공 캐시는 유지한다. 다른 구간은 계속 처리하고 오류 로그는 작업 UI에서 최대 100행 보관한다.

`video-cache.mjs`는 검증된 번역을 trusted local에 묶음별 저장한다. 저장 구조는 버전과 LRU 순서의 영상 ID 배열이며 각 영상은 `[모델/언어 범위 해시:원문 해시, 번역문]` 항목을 가진다. 설정 revision/API 키가 바뀌어도 같은 공급자·모델·언어·원문이면 재사용한다. watch/Shorts의 같은 ID는 같은 영상이다. 원문은 JSON 문자열로 직렬화해 SHA-256을 계산하므로 서로 다른 UTF-16 입력이 인코딩 과정에서 합쳐지지 않는다.

broker는 영상/document grant·동의·현재 모델 설정을 먼저 검증하고 캐시로 해결되지 않는 구간만 API로 보낸다. 캐시 적중은 API 횟수·문자 예산·토큰 기록을 추가하지 않는다. 응답 검증 후 성공 구간을 직렬 병합하며 저장 오류는 `cacheWarning`으로 반환하고 완료 번역을 재전송하지 않는다. 자막 타이밍은 매 방문 시 현재 YouTube 자막에서 다시 읽는다.

영상 30개/전체 4 MiB 초과 시 LRU 영상을 제거한다. 단일 영상이 상한을 넘으면 최근 항목을 남긴다. options 전용 `VIDEO_CACHE_STATUS`는 건수/용량만, `VIDEO_CACHE_CLEAR`는 삭제만 제공한다. 삭제 세대와 맞지 않는 진행 중 요청의 저장은 무시한다. 브라우저/탭 종료는 이 캐시를 지우지 않는다. 아래 이전 버전의 형식 오류 무재시도·자막 임시 보관 설명에는 이 절을 우선 적용한다.

## 병렬 처리와 요청 제한

본문·부분은 `Core.parallelBatches`, 자막은 `video.nextBatches`와 세션 pump가 최대 5개 묶음을 동시에 실행한다. 각 묶음은 고유 jobId를 가지며 응답은 도착 즉시 ID/원문 상태를 검사해 반영한다. 한 차례 작업이 모두 끝나면 다음 차례 전 5초 대기한다. 자막은 재생 위치 이후 구간을 먼저 선택하며 완료 캐시를 공유해 중복 전송을 피한다.

broker의 잠금 안에서 trusted session `providerQuota.attempts` 중 최근 60초 시각만 유지하며 최대 60번의 시도 예약을 허용한다. 모든 탭·공급자·이미지·Google 재시도가 같은 한도를 사용하고 서비스 워커 재시작/설정 변경으로 초기화하지 않는다. 별도의 동시 작업 한도도 5개다. 공급자 모델 목록/YouTube 자막 수집은 이 번역 API 카운터에 포함하지 않는다.

본문·부분은 `CLIENT_BUSY`에서 1초, `CLIENT_RATE_LIMIT`에서 60초 대기 후 미전송 작업만 다시 시도한다. 자막은 세션 타이머로 로컬 한도/기존 일시 오류의 재시도를 예약한다. 기다리는 동안 background 메시지를 열어두지 않아 공급자 요청 제한시간과 분리된다. 중단·OFF·폐기 시 모든 jobId를 취소하고 세대가 다른 늦은 결과를 버린다. 실제 OpenAI 오류/시간 초과에는 자동 재전송하지 않는다. 세션 문자 예산 200,000 코드 단위는 유지한다.

이 절의 병렬/속도 제한은 아래 이전 버전의 구현 이력에 우선한다. [계획과 검증](../implementation-plans/0031-parallel-translation-batches.md).

OpenAI는 `openai-models.mjs`가 GET /v1/models와 검증된 모델 메타데이터를 대조한다. 모델별 키·활성 revision은 기존 profiles가 관리하며 broker가 공급자에 맞는 어댑터를 선택한다. `openai.mjs`는 텍스트 ID 묶음 또는 이미지 data URL을 Responses의 strict JSON schema로 요청한다. 완료된 assistant output_text만 적용하고 reasoning 내용·도구 호출·거절·불완전 출력은 번역으로 쓰지 않는다. usage만 숫자로 정규화한다.

OpenAI 번역은 `openai-transport.mjs` → 검증된 전용 포트 → `openai-offscreen-host.mjs` → 작업별 `openai-worker.mjs`로 전송한다. 생성별 UUID URL·확장 ID/origin·탭 없음·실제 offscreen context를 대조하고 sender.documentId는 제공될 때 추가 검사한다. 180초 전송/200초 UI 대기, 최대 5개 Worker, 작업 중 20초 pulse, 종료·취소·단절 시 정리와 유휴 문서 종료를 적용한다. 이미지 JSON 최대 6MiB(원래 픽셀 한도 4MiB), 텍스트 JSON 128KiB, 응답 256KiB다. Google 경로와 Kie 레거시를 독립적으로 유지한다.

설정과 통계는 OpenAI 공급자 이름·모델·키 슬롯을 별도로 표시한다. 모델 조회는 18초 제한의 background 직접 GET이며 원문을 보내지 않는다. 번역 HTTP/네트워크/시간 초과/응답 오류에서 자동 재호출하지 않으며 자막은 OFF로 종료한다. [구현 결과](../implementation-plans/0030-openai-direct-api.md).

0.15.2에서 Kie 실행 경로를 비활성화했다. broker가 Kie 목록·가격·설정 저장·활성화를 거절하고 기존 활성 Kie의 실행 요청도 `PROVIDER_DISABLED`로 차단한다. status는 기존 프로필을 보존한 채 configured=false와 안내를 반환한다. 옵션 화면은 Google 편집으로 열며 Kie 키는 별도 삭제 전용 영역에 표시한다. YouTube 인라인 버튼은 기존 Kie 활성 상태에서 설정 페이지로 안내한다. 다른 모델로 자동 전환하지 않으며 키/통계 삭제나 스키마 마이그레이션은 없다. 아래 Kie 모듈 및 전송 구조는 향후 재검토를 위한 레거시 기록이다.

```text
설정: 공급자·키 입력 → Google API/Kie 공식 문서 지원 목록 → 출시일 정렬·모델 카드 → 공급자·모델별 trusted local 저장
전환: 저장 모델 선택 → 해당 모델 슬롯 활성화 → 새 설정 버전 발급
번역: 버전별 최초 동의 → 원문 수집·확인·실행 → background 동의·설정·예산 검사
      → 활성 공급자·모델의 키로 고정 HTTPS 요청 → 응답·원문 변경 검사 → 기기 내 표시
```

| 파일 | 역할 |
| --- | --- |
| `manifest.json` | activeTab·scripting·storage·contextMenus, Google·api.kie.ai·docs.kie.ai·정확한 www.youtube.com 호스트 권한, 고정 API/목록 출처 CSP |
| `youtube-dom.js` | watch/Shorts ID와 현재 가시 플레이어·video 식별, 정적/수동 주입 공용 |
| `youtube-launcher.js` | YouTube 자동 정적 주입, 영상 작업 영역 인식·자막 번역 버튼·사용자 클릭 진입 |
| `context-menu.mjs` | 설치/시작 시 선택 메뉴 등록, 클릭한 탭/선택 스냅샷 처리, 오류 안내 |
| `options.html/js/css` | 공급자·모델별 키 CRUD, 계열별 모델 카드·검색·필터·출시일·선택 요약과 보안 정책 UI |
| `consent.js` | 팝업·설정의 버전별 최초 동의 |
| `background.js` | 메시지·탭 수명 이벤트 연결, 안전한 오류 응답 |
| `broker.mjs` | 송신자·동의·설정 검증, 직렬 변경·예산·동시성·취소 |
| `usage.mjs` | 숫자 metadata 화이트리스트, 날짜/모델/기능 집계, 직렬 저장·중복 방지·보관 제한 |
| `statistics.html/mjs/css` | 별도 통계 페이지, 기간·모델·기능 필터, 카드·일별 막대/표·모델 표·삭제 |
| `popup-usage.mjs`, `usage-ui.mjs` | 팝업 오늘 요약과 통계 이동, 누락값을 구분하는 공용 숫자 표시 |
| `page-cache.mjs` | 탭별 마지막 본문 캐시 범위·병합·용량 제한, 키 정보 없음 |
| `image-contract.mjs` | 이미지 요청·PNG/JPEG 서명/크기·인식/번역 응답 규격, 멀티모달 payload |
| `image-dom.js` | 클릭 이미지 확인, canvas 재인코딩, 안전한 화면 crop 좌표 검사 |
| `image-content.js` | 이미지 위 오버레이·목표 언어·원문·재시도·취소·위치 추적 |
| `image-capture.mjs` | 활성 탭/문서/좌표 검사, 전체 화면을 기기 내 OffscreenCanvas에서 자르기 |
| `youtube-captions.mjs` | YouTube watch/Shorts URL/영상 ID·문서 검사, MAIN world 자막 목록/동일 출처 timedtext 읽기, 크기·파싱 검증 |
| `video-core.js` | JSON3 cue/자동자막 append 정규화, 타임코드 인덱스·중복 제거·현재 시점 우선 배치 |
| `video-content.js` | 자막/목표 언어 선택, 번역 진행·취소, 영상 시간에 맞춘 반투명 overlay, ON/OFF·전체화면·수명 관리 |
| `video-session.js` | ON 동안 주기 수집·병합·미번역 요청, 직렬 처리·재시도·취소·텍스트별 결과 재사용 |
| `video-style.js` | 표시 설정 기본값·범위 검증·CSS 적용, 고정된 기기 내 서체 |
| `profiles.mjs` | trusted local 공급자/모델 키 슬롯, 활성 모델, 키 없는 공개 목록 |
| `models.mjs` | models.list 페이지네이션·생성 메서드 필터·제한 |
| `model-releases.mjs` | 공식 기록으로 검증한 날짜와 최근순 정렬 |
| `google.mjs` | segments 배열과 responseJsonSchema 지정, translations ID 검증, 시간·재시도·응답 제한 |
| `kie-models.mjs` | 공개 llms.txt와 로컬 34개 Chat 모델 교집합, 키 없는 제한 목록 조회 |
| `kie.mjs` | 고정 chat/messages/responses 요청·완료·usage 정규화, 구조화 출력·ID 검증 |
| `kie-pricing.mjs` | 고정 공개 가격 조회·페이지/크기 제한·Chat 행 검증·USD/크레딧 쌍·30초 제한·실패 상태 |
| `contract.mjs` | 요청/응답·설정 버전 규격 |
| `core.js` | 분할·배치·결과 검사·사용자 오류 |
| `dom.js`, `content.js` | Text 노드 추출·교체·조건부 복원, 선택 스냅샷, 다중 요소 묶음 큐 |

제품 파일은 모두 `src/extension/`에 있다. 서버·환경변수 파일·실행 시 빌드는 필요 없다.

0.14.1의 카드 헤더는 모델 정보 열과 가격 열로 나뉜다. `model-identity` 아래 이름/ID/메타데이터를 묶고 `model-price`를 같은 행 오른쪽에 둔다. 가격 갱신은 가격 요소만 교체하며 선택한 라디오/키/카탈로그를 변경하지 않는다. input/output 클래스별 색과 명시적 문구·단위 접근성 설명을 사용한다. 이전값은 불투명도를 낮추지 않고 경고 문구로 구분한다.

## 공급자 분리와 모델 탐색 (0.13.0)

0.14.0의 가격 흐름: options의 `KIE_PRICES` → 정확한 options 송신자 검사 → 메모리의 동시 조회 병합/30초 제한 → 키 없는 공개 POST → 최대 10페이지·1,000행/18초·페이지당 512 KiB → 로컬 모델별 별칭/공급자/Chat/단위/입출력 검사 → 숫자 가격과 조회 시각만 반환한다. remote anchor·할인 문구를 DOM/네트워크 경로로 사용하지 않는다. USD는 creditPrice에 대응하는 공식 usdPrice이며 falPrice/discountRate로 재할인하지 않는다.

가격은 key profile/catalog/usage와 분리되어 있다. 조회 실패 시 이전 성공 시각·가격에 error를 붙인다. options는 5분 이상 값도 재확인 필요로 표시하며 15초마다 표시 상태를 확인하고 5분 간격으로 조회한다. 숨긴 탭/Google 화면에서는 주기 조회하지 않고 복귀 시 오래되었으면 갱신한다. 모델 목록·선택·저장·번역은 가격 실패에 영향을 받지 않는다. 가격의 자동 갱신은 키나 모델을 활성화하지 않는다.

`profiles`의 공급자+정확한 모델 슬롯에서 키를 선택한다. broker는 목록의 공급자/키/모델 결합과 번역 요청의 활성 공급자/모델/revision을 검사한다. 설정 변경은 요청과 임시 목록을 취소·제거하고 전역 예산은 유지한다. 본문 캐시도 공급자를 범위에 포함한다.

Google은 기존 models.list를 사용한다. kie.ai는 고정 공개 llms.txt를 키 없이 읽어 로컬에 확인한 문서 링크와 교집합을 취한다. 원격 문서 내용은 실행 경로를 결정하지 않는다. 모델 카드는 공급자·계열·이름/ID로 탐색하며 저장 모델의 키와 새 입력을 다른 공급자로 넘기지 않는다. 공개 목록은 키 유효성 검사가 아니다.

Kie의 고정 chat/messages/responses 경로에 각각 맞는 payload를 만들고 완전한 텍스트 JSON과 구간 ID를 검사한다. schema 지원 경로는 JSON schema를 사용하며 다른 경로는 JSON 출력 지시와 사후 검증을 사용한다. Responses가 stream:false에도 SSE를 반환하면 제한된 전체 응답의 종료 이벤트만 수용한다. Kie 이미지 요청은 메뉴 진입·캡처·API 전에 차단한다.

0.15.0의 broker는 Kie 번역에 kie-transport의 fetch 대체 함수를 주입한다. 검증된 전용 포트 → kie-offscreen-host → 요청별 kie-worker에서 네트워크와 크기 제한 읽기를 수행한다. status/content-type/text만 background로 반환하고 어댑터가 usage·응답/ID를 검증한다. 180초 요청/190초 UI 메시지 대기, 작업 중 20초 pulse, 최대 2개 Worker, 취소/단절/완료 정리와 유휴 문서 종료를 적용한다. Google/목록/가격은 기존 fetch를 유지한다. core.requestMessage가 본문/부분/자막의 응답 대기를 관리한다. [근거·제약](../troubleshooting/2026-09-07-kie-client-timeout.md).

0.15.1은 생성마다 새 UUID fragment를 붙여 연결을 해당 생성 시도에 묶는다. sender의 확장 ID·정확한 URL·origin·탭 없음과 getContexts의 실제 OFFSCREEN_DOCUMENT(URL/origin/tabId=-1/documentId)를 대조한다. sender.documentId는 Chrome에서 생략될 수 있으므로 제공되는 경우에만 추가 일치를 요구한다. 초기화 시간 초과·문서 생성 실패·포트 단절·Worker 시작 실패를 각각 고정 오류 코드로 구분하며 자막 자동 반복을 중단한다. [실제 Chrome 재현](../troubleshooting/2026-09-07-kie-offscreen-port.md).

0.14.4는 Kie HTTP 500/524 및 확장 자체 Kie 대기 시간 초과를 고정 코드로 분리한다. HTTP 500 본문의 code/error.code가 정확히 524일 때도 공급자 524로 안내한다. 이 세 코드는 video-session에서 OFF로 종료해 동일 요청의 자동 반복을 막는다. 본문의 메시지 문자열에서 숫자를 검색하지 않는다. 원시 응답을 노출하지 않고 기존 크기 제한·숫자 usage·25초 요청 제한을 유지한다. [진단 근거](../troubleshooting/2026-09-07-kie-http500-524.md).

0.14.3은 Gemini 3.8에도 nested response_format/json_schema를 보내며 문서의 structured_output 이름을 사용한다. 3.8 문서에는 예제만 있어 같은 공급자 3 Pro의 상세 형식에 기반한 호환성 적용이다. 실 API 지원은 미검증이며 400/404를 받으면 옵션을 빼서 자동 재호출하지 않는다. 번역 파싱 실패의 빈 출력/일반 텍스트/JSON 문법 오류를 고정 코드로 구분하고 원문 없는 오류 안내와 OFF 처리를 유지한다.

0.14.2는 Kie 출력 전체를 감싼 단일 JSON 코드블록만 제거한 뒤 같은 검증을 적용한다. 정확한 Gemini 3.8 OpenAI 경로에서는 문서에 혼재된 native candidates 완료 text/usageMetadata도 정규화한다. thought 부분·도구 호출·미완료·혼합 외피는 번역으로 사용하지 않는다. HTTP JSON, 외피, 모델 JSON, 번역 구조, 구간 ID 실패는 고정 KIE_* 코드로 구분하며 형식 오류 시 자막 작업을 OFF로 종료한다. 원시 응답 로그·추가 복구 호출은 없다. [재현과 진단](../troubleshooting/2026-09-07-kie-gemini-response-format.md).

`usage`는 공급자별 숫자를 공통 항목으로 정규화하고 공급자 필터와 `groupUsage`의 공급자+모델 집계를 제공한다. Kie chat/responses의 추론 상세는 출력에서 분리하며 없으면 출력에 포함될 수 있다. Claude 입력은 기본 입력+캐시 생성+캐시 읽기이며 모두 확인되어야 합산한다. 표시만 K/M/B/T/Q로 줄이고 정확한 저장 정수는 title/aria-label에 제공한다.

## 토큰 기록 흐름

Google/kie.ai HTTP 시도마다 예산 검사 → `usage.begin` 직렬 local 저장 → 요청 → 크기 제한 응답 읽기 → 숫자 usage 확보·정규화 → 번역 출력 검증 → `finally`에서 `usage.finish`를 수행한다. 이미지 조기 반환·잘못된 번역 출력·읽을 수 있는 HTTP 오류에도 사용량을 확보한다. 자동 재시도는 매번 기록하며 모델 목록 조회·본문 캐시 재사용·ON/OFF 표시는 집계하지 않는다.

시작 기록은 요청 시작 당시 기기 날짜와 공급자/정확한 모델/기능별 요청 수를 올리고 임의 ID만 pending에 둔다. 완료는 ID당 한 번만 각 항목의 합계·제공 건수와 입력/출력/전체가 모두 제공된 건수를 올린다. 시작 후 중단·worker 종료·응답 부재는 미확인으로 남는다. 시작 저장 실패는 외부 호출 전에 `USAGE_STORAGE_FAILED`, 완료 저장 실패는 번역 결과를 유지하고 미확인·통계 경고로 처리한다. 시작 직후 취소되어 실제 HTTP 전송에 이르지 못한 경우도 미확인일 수 있다.

`USAGE_GET`은 정확한 popup.html/statistics.html 송신자만, `USAGE_CLEAR`는 statistics.html만 허용한다. 키 설정과 독립적이다. 삭제는 pending도 제거하므로 이전 요청의 늦은 완료가 기록을 되살리지 않는다. 조회/변경에서 최근 365일·최대 10,000행으로 정리하고 pending은 128개까지 둔다. 재시작 후 미완료 ID의 응답을 복구하지 않으며 그 요청 수는 미확인으로 유지한다. 응답 숫자만 합산하므로 계정의 실제 전체 사용량과 다를 수 있다. 팝업/통계는 열려 있는 동안 15초마다 다시 조회한다.

## 이미지 인식·번역

이미지 메뉴 이벤트의 clicked tab, srcUrl을 사용해 메인 문서의 `<img>`를 찾는다. 같은 src가 여러 개면 저장된 contextmenu 대상만 인정하며 첫 실행에서 대상을 확정하지 못하면 다시 우클릭하도록 안내한다. srcUrl은 찾기에만 쓰고 API나 저장소에 전달하지 않는다. 이미지 전송에는 기존 문서 grant와 별도의 imageToken이 모두 필요하다. imageToken은 worker 메모리에 있어 worker가 재생성되면 다시 이미지 메뉴를 실행한다.

브라우저가 이미 로드한 이미지에서 canvas로 픽셀을 읽고 최대 긴 변 2048px로 축소·PNG/JPEG 재인코딩한다. CORS taint면 기기 내 screenshot crop으로 대체한다. content가 오버레이를 숨긴 뒤 background가 activeTab과 documentId를 검사하고 두 번의 좌표 검사 사이에 captureVisibleTab을 호출한다. OffscreenCanvas에서 이미지 사각형만 잘라 새 이미지로 인코딩한 결과만 반환한다. source URL fetch, Files API, 호스트 권한 확대는 없다.

캡처는 이미지 전체가 뷰포트 안에 있어야 한다. fill 및 중앙 contain/scale-down을 처리하고 border/padding을 제외한다. transform/clip-path/투명도/뷰포트 잘림/검출한 가림을 거절한다. 겹치는 요소 교차점과 11×11 지점의 hit test로 가림을 검사한다. 10,000개 초과 요소 페이지는 캡처를 거절한다. 이 보수적 경로는 모든 합성 효과·애니메이션·페이지 변화의 호환을 보장하지 않으며, 캡처 이미지에는 이미지 사각형 안에 표시된 배경이 포함될 수 있다.

TRANSLATE_IMAGE는 동의·모델/revision·문서·작업 토큰을 검사하고 Google generateContent에 `{inlineData:{mimeType,data}}`와 목표 언어만 보낸다. 이미지 내용을 비신뢰 데이터로 처리하도록 지시하고 `{recognizedText,translation,noText}` 스키마와 응답 필드/크기를 다시 검증한다. noText=true면 두 문자열이 비어 있어야 한다. output은 textContent만 사용한다. 모델 카탈로그의 generateContent 지원은 이미지/JSON 지원 보장이 아니며 미지원 오류를 별도 안내한다.

이미지는 최대 4 MiB·응답 필드당 24,000 코드 단위, 응답 256 KiB와 공통 동시 5개/최근 60초 60회 제한을 따른다. 공급자 요청 제한시간은 Google 25초/OpenAI 180초다. 이미지 예산은 세션 50회이며 Google 자동 재시도도 포함한다. 텍스트 문자 예산과 별도로 집계하며 원문/이미지/URL을 session에 저장하지 않는다. 상태 변경/닫기/새 이미지/페이지 종료에서 API 요청을 취소하고 늦은 결과를 무시한다. 결과와 픽셀은 이미지 작업 메모리에만 남으며 본문 캐시와 섞지 않는다.

공식 입력/캡처 규격: [Google 이미지 입력](https://ai.google.dev/gemini-api/docs/image-understanding), [generateContent](https://ai.google.dev/api/generate-content), [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs).

## 우클릭과 본문 표시

선택 메뉴는 Chrome이 전달한 클릭 탭과 selectionText를 사용한다. 입력/편집 영역·자식 프레임을 거절하고 동의/설정을 검사한다. 클릭 페이지 URL을 검사하고 documentId를 고정해 스크립트 주입과 메시지를 전달하므로 다른 탭·이동한 문서로 잘못 보내지 않는다. 선택 원문은 작업 메모리에만 있고 오류 코드만 임시 상태에 저장한다. 설정이 필요하면 options를 열며 사용자 원문은 자동 재전송하지 않는다. 준비된 상태에서는 메뉴 클릭이 번역 실행이다.

선택 결과는 closed Shadow DOM의 오버레이에 textContent로 표시한다. live Range → contextmenu 시점 Range → 유일한 가시 문자열 일치 순으로 위치를 찾고, 공백 정규화와 원본 offset 매핑을 사용한다. 위치가 모호하면 API 요청 없이 재선택을 안내한다. 원문은 변경하지 않고 Range/원문 스냅샷을 추적한다. 스크롤·resize·DOM 변경은 rAF로 위치를 갱신하며 화면 밖 원문은 오버레이를 숨기고 원문 변경/삭제 시 작업을 취소한다. 목표 언어는 열려 있는 본문 설정 또는 기본 한국어다.

본문은 노드별 ID를 부여하고 기존 Text.nodeValue만 교체한다. 번역용 블록·여백·스타일을 문서 안에 추가하지 않는다. 원래 노드/부모/문자열을 기록하고 적용 시 원문 변경 여부를 검사한다. 복원은 적용 문자열과 같은 노드에만 수행해 이후 페이지 변경을 보호한다. 번역이 길어질 때 자연스러운 줄바꿈과 높이 변화는 가능하다.

본문 state와 선택 state는 독립적이다. 같은 문서에서 UI를 다시 열 때 grant를 재사용해 상대 작업을 끊지 않는다. 본문 ON/OFF는 저장한 entry.translated를 적용/복원하며 OFF 중 응답은 메모리에만 반영한다. 패널 닫기는 축소이고 결과나 진행 작업을 삭제하지 않는다. 새 번역은 기존 DOM을 안전하게 복원하고 스냅샷을 다시 수집한다.

## 탭별 본문 캐시

`pageCache:<tabId>`를 trusted session에 저장한다. scope는 정확한 송신 문서 URL·모델·설정 revision·원문/목표 언어다. 원문 문자열과 검증된 번역문을 병합하며 최대 500구간·합계 1,000,000 UTF-16 코드 단위다. 다른 scope의 새 번역이 기존 캐시를 교체한다. content는 저장소에 직접 접근하지 않으며 TRANSLATE 요청 시 해당 원문에 맞는 번역만 돌려받는다. 선택 번역에는 캐시를 쓰지 않는다.

새로고침 후 본문 번역을 시작하면 일치하는 구간은 요청 ID를 다시 연결하고 Google을 호출하지 않는다. 누락 원문만 API로 전송하고 실제 전송에만 예산을 차감한다. 캐시 응답에도 기존 개수·ID·크기 계약을 검증한다. 탭 탐색은 grant/진행 요청만 제거하고 탭 종료는 캐시도 제거한다. 저장과 종료를 직렬화하고 문서 grant·취소 상태를 재확인해 늦은 응답의 재저장을 차단한다.

저장 실패/용량 초과 시 번역 응답은 유지하고 새로고침 시 재요청 가능성을 UI에 표시한다. 전체 Chrome session 한도도 적용된다. 이 데이터는 디스크 영구 저장·sync 대상이 아니며 브라우저 재시작이나 확장 비활성화/업데이트/재로드에서도 사라진다. [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage)

## 구조화 묶음 번역

최대 64구간·12,000 코드 단위의 segments를 한 번의 generateContent 요청으로 보낸다. 긴 노드는 2,400 단위로 나누되 가능한 여러 요소와 함께 묶는다. 중복 원문은 같은 작업 안에서 한 번 전송한다. Google responseJsonSchema에 translations 배열의 개수와 id/text를 지정하고 응답 순서 대신 ID로 각 노드에 연결한다. 미지/중복/누락 ID·빈 텍스트·응답 크기 초과는 묶음 전체를 거절한다.

번역 제한은 Google 25초/OpenAI 180초·응답 48,000 코드 단위·256 KiB·출력 토큰 16,384다. 큰 페이지는 최대 5개 묶음씩 병렬 처리하고 모든 응답 처리 후 5초 쉰다. 재시도/예산도 묶음 요청 단위로 계산한다. API 실제 지연과 모델별 최대 출력/스키마 호환은 계정 검증이 필요하다.

공식 근거: [contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Google generateContent](https://ai.google.dev/api/generate-content).

## 저장소와 변경 경계

local의 `modelProfiles` 한 레코드 안에 schemaVersion, entries, active, revision을 보관한다. entries의 슬롯은 `google:<exact-model-id>`다. 키를 포함한 전체 객체를 메시지로 반환하지 않고 options에는 공개 ID·표시명·날짜·저장 여부만 제공한다. content와 popup에는 활성 모델만 알린다.

local/session의 TRUSTED_CONTEXTS 적용이 완료되어야 메시지를 처리한다. 이전 session의 providerSettings는 영구 이관하지 않는다. 동의 버전은 local의 별도 textConsent 레코드로 유지한다. 원문·번역문은 저장 프로필에 포함하지 않는다.

새 모델 저장·교체에는 입력 키·공급자에 결합한 카탈로그와 선택 모델을 검증한다. 빈 키는 대상 모델의 기존 키만 사용한다. 저장 모델의 활성화에는 재조회가 필요 없다. 각 변경은 직렬화하며 진행 중 요청·임시 목록을 취소하고 설정 버전을 갱신한다. 삭제한 활성 모델을 다른 모델로 자동 대체하지 않는다.

카탈로그 시작·종료 반영도 직렬화하지만 네트워크 대기 중에는 잠금을 잡지 않는다. 목록 ID와 취소 상태로 늦은 응답을 차단한다. UI는 요청 세대로 키/모델 선택 변경 전 응답을 무시한다. 목록은 페이지당 100개·최대 20페이지·전체 18초·페이지당 256 KiB로 제한한다.

## 모델 출시 데이터

[Google Model 규격](https://ai.google.dev/api/models)에는 출시일이 없다. `model-releases.mjs`의 정확한 ID별 날짜를 API 결과에 결합한다. 날짜는 [공식 출시 기록](https://ai.google.dev/gemini-api/docs/changelog)을 확인한 번들 데이터이며 마지막 확인일은 2026-09-06이다. 모델 제공 여부 자체는 API 응답을 따른다.

출시 날짜 내림차순 → 동일 날짜 ID순 → 날짜 미확인 ID순으로 정렬한다. preview와 GA는 서로 다른 ID로 취급한다. latest 및 대상이 바뀌는 별칭, 알 수 없는 모델에는 이름·숫자·설명으로 날짜를 추정하지 않는다. 새 모델이 미확인으로 나오면 공식 기록 확인 후 날짜 테이블·테스트·문서를 함께 갱신한다. 확장 실행 중 문서 사이트를 스크래핑하거나 원격 코드를 받지 않는다.

## 전송과 호출 제한

API 키는 Google 인증 헤더에만 넣는다. provider의 원본 오류 본문은 반환하지 않으며 응답 ID·개수·형식·크기를 확인한다. 원문·LLM 응답은 데이터로 처리하고 HTML을 실행하지 않는다.

세션 입력 예산·호출 시각·grant는 worker 재생성 후 복원되며 모델 변경·키 삭제로 초기화하지 않는다. 브라우저 재시작·확장 재로드는 세션 정보만 초기화하며 모델별 키는 남는다. 보안 정책과 보호 한계는 [security.md](security.md)를 따른다.

검증한 공식 규격: [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Chrome runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime), [Google generateContent](https://ai.google.dev/api/generate-content). 실제 계정 호출과 Chrome 설치 통합 검증은 별도로 남아 있다.

## YouTube 자막 번역 (0.9)

0.10.2 보완: 페이지 버튼은 html/body의 dark 상태에서 명시적인 글자/배경 색을 적용하고 테마 변경을 관찰한다. 인접 네이티브 버튼의 offsetHeight(28~64px)·계산된 글씨 크기/서체/굵기를 따른다. CSS 변수 부재와 고정 36px 의존을 제거하고 버튼 클릭은 상위 페이지로 전파하지 않는다. 마우스/키보드의 trusted 클릭을 유지하며 열기 응답은 20초 후 UI 대기를 해제한다.

inline 및 자막 요청은 sender URL의 YouTube 출처·origin을 확인하고 현재 영상 ID는 현재 탭 URL로 검증한다. inline은 고정 documentId에서 location.href까지 대조한다. SPA 홈/이전 watch URL이 sender에 남은 경우를 허용하되 다른 출처·프레임·현재 영상 불일치·오래된 문서/grant는 거절한다. 자막 MAIN 호출도 현재 영상/문서를 다시 검사한다.

0.11.0 페이지 진입: `youtube-dom.js`, `youtube-launcher.js`를 `https://www.youtube.com/*` 메인 프레임에 document_idle로 자동 주입한다. watch/Shorts URL/11자 ID/플레이어 video와 가시 작업 영역을 찾은 경우 closed shadow 버튼을 좋아요 묶음 다음 형제에 삽입한다. 구조를 찾지 못하면 같은 영역 끝으로 대체한다. MutationObserver 250ms 제한과 2초 확인으로 SPA/지연 로드/DOM 교체를 처리하며 원문/자막/키를 읽거나 전송하지 않는다. 홈·플레이어/영역 없음에서는 제거한다. Shorts에서는 가시 reel-action-bar-view-model 또는 활성 renderer의 actions에서 좋아요 다음에 작은 번역 버튼을 둔다.

실제 클릭 → OPEN_VIDEO_INLINE → background sender 메인 프레임/YouTube/영상 확인 → 현재 탭과 documentId 고정 검사 → 미동의/미설정이면 options 안내 → 기존 openPanel(video). message의 탭 ID/URL은 사용하지 않는다. 새 패널은 OFF이며 같은 grant/영상으로 이미 열린 패널이면 설정만 펼쳐 결과/ON을 유지한다. 익명 페이지 postMessage나 DOM 속성으로 호출하는 브리지는 없다. 버튼은 isTrusted 클릭만 처리하고 키보드 초점/중복 클릭 방지/안전한 오류 안내를 제공한다.

팝업 OPEN video → watch/Shorts URL 확인 → 현재 documentId에 고정 주입 → OPEN_VIDEO → VIDEO_TRACKS로 원문 목록 표시 → 사용자 번역 ON → VIDEO_CAPTIONS 주기 수집 → 정규화·기존 구간 병합 → 기존 TRANSLATE mode video 미번역 순차 배치 → video.currentTime으로 원문 시간 구간 선택 → 반투명 자막 표시. 새 작업은 OFF이며 기존 작업을 다시 여는 경우 ON/결과를 유지한다.

자막 읽기는 scripting의 MAIN world에 직렬화된 함수로 수행한다. 현재 URL과 플레이어 응답의 videoId를 비교한 뒤 플레이어가 노출한 트랙의 동일 출처 HTTPS /api/timedtext만 요청한다. 리다이렉트·다른 영상 ID·다른 경로·인증정보 포함 URL은 거절한다. MAIN에는 영상 ID·트랙 인덱스만 전달하고 키/grant는 전달하지 않는다. 목록/원문은 background에서 다시 검증하며 페이지 오류 문자열은 고정 코드로 치환한다. 읽기 전후 탭 URL·문서 grant를 확인하고 한 탭에서 동시에 하나만 읽는다. 페이지 fetch는 12초, background bridge는 16초 제한이다.

JSON3 창/스타일 메타데이터는 제외한다. 같은 창의 append 이벤트는 문장으로 합치고 다음 창 표시 시작에 맞춰 이전 구간을 끝낸다. 원래 겹치는 제작자 자막은 동시에 표시한다. 세그먼트 타이밍/개별 단어 강조는 사용하지 않으며 문장 구간으로 표시한다. 빈 구간·seeking·광고·영상 종료·PIP에서는 자막을 숨긴다. 한 cue의 번역 조각이 모두 준비되어야 표시한다.

중복 문장은 같은 번역을 재사용한다. 매 배치마다 현재 재생 위치 이후 미번역 구간부터 처리한 뒤 이전 구간으로 돌아간다. 최대 64구간/12,000자이며 순차 요청 시작 간 최소 2.2초를 두지만 다른 기능·공급자 재시도와 공통 할당량을 사용하므로 한도 오류는 여전히 발생할 수 있다. 목표 언어/트랙 변경은 기존 결과를 지우고 ON을 이어가며 모델 revision 변경은 OFF로 전환한다. OFF 후 같은 설정에서 ON하면 완료 문장을 재사용한다.

표시는 closed shadow DOM의 pointer-events:none 자막과 별도 조작 패널로 구성한다. HTML 응답은 textContent로만 표시한다. 전체화면 플레이어 내부로 host를 옮겨 전체화면에서도 보이게 한다. 영상 ID 변경·pagehide는 generation 무효화와 요청 취소, 메모리 삭제를 수행한다. 브라우저 저장소에 자막을 넣지 않는다. ON/OFF와 패널 접기는 번역 결과를 유지한다. 영상 자체 fullscreen/PIP와 라이브는 지원 범위가 아니다.

`video-session.js`는 5초 이내 주기로 상태를 확인하고 실제 자막 읽기는 이전 수집 완료 뒤 최소 10초 간격으로 수행한다. seeked/visibilitychange는 확인을 앞당기되 읽기/번역 기한을 건너뛰지 않는다. 광고·숨김 탭에서는 쉬고 돌아오면 계속한다. 하나의 수집/번역만 실행하며 generation으로 OFF/언어 변경 이전 응답을 무시한다. OFF는 타이머와 공급자 요청을 취소하고 자막을 숨긴다. 이미 시작된 MAIN 읽기는 기존 제한 안에서 종료하지만 그 결과로 번역을 시작하지 않는다.

새 응답의 시작 시각과 같은 기존 cue를 교체하고 다른 구간을 유지한다. cue/segment ID를 다시 만들어도 원문 문자열별 캐시로 번역을 연결한다. 5,000 cue/원문 100,000자와 번역 캐시 1,000,000자 한도를 적용한다. 일시적 수집·네트워크 실패는 5~60초로 재시도하며 수집은 최소 10초, rate limit은 60초 대기한다. 인증·동의·설정·예산·형식 오류는 OFF로 안내한다. 기존 공급자 내부 재시도/전체 예산은 그대로 적용한다.

`videoAppearance`에는 배경/글자 불투명도(0~100), 서체 enum, 크기(12~64px), 세로 위치(5~95%), 정렬 enum만 trusted local에 저장한다. `VIDEO_STYLE_GET/SET`은 현재 문서 grant를 검증하고 정확한 필드·범위를 검사하며 키 저장 레코드를 읽지 않는다. content는 300ms 지연 후 직렬 저장하고 작업 정리 전에 남은 저장을 요청한다. 변경은 자막과 미리보기에 즉시 적용한다. 외부 서체/CSS 입력은 받지 않으며 자막이 영상 밖으로 나가지 않도록 세로 위치를 제한한다. 기본값 복원도 저장한다. ON 여부와 자막 내용은 저장하지 않는다.

## 자막 빈 응답 대응 (0.8.1)

0.10.1 복구 보완: captions 모듈이 보이는 것과 트랙 적용 완료를 구분하고 250ms 확인 후 선택 트랙이 적용됐을 때 reload한다. 응답이 없으면 관찰 시작 4초 후 최대 한 번 captions만 unload/load하고 다시 선택한다. 기존 관찰 전체 12초/2 MiB 범위는 늘리지 않는다. 빈 JSON events/문자 없는 제어 이벤트는 수집 완료로 확정하지 않는다. 이전 트랙을 복사해 보관하고 원래 OFF이면 소유권을 확인한 뒤 모듈을 끄거나 빈 트랙으로 복원한다. 선택 트랙 변경이나 사용자 자막/설정 메뉴 클릭을 감지하면 재초기화·복원을 하지 않는다. 성공/실패 모두 타이머·관찰 훅·클릭 리스너를 정리한다.

처음 목록 로드 실패 뒤 같은 패널을 다시 열면 VIDEO_TRACKS를 재요청하며 로딩 중 중복 실행은 막는다. CAPTIONS_BRIDGE_FAILED는 ON 세션의 수집 재시도 대상에 포함한다. 정상 목록/ON/완료 결과가 있는 패널은 기존 상태를 유지한다. 페이지·영상 전체를 재로드하지 않는다.

`youtube-player-captions.mjs`는 직접 timedtext 요청이 비거나 실패한 경우 MAIN world에서 선택한 영상/언어/kind/variant의 실제 fetch/XHR 자막 응답만 12초간 관찰한다. captions 모듈 준비 후 track/reload를 요청한다. fetch는 원래 Promise를 반환하고 response.clone으로 제한된 복사본만 읽는다. XHR은 loadend에서 본문만 읽는다. 요청 헤더·쿠키·서명 URL을 반환하지 않는다. JSON3/로컬 XML 파싱 후 background에서 기존 cue/크기 검증을 다시 수행한다. 종료 시 원래 함수·리스너·타이머를 정리하고, 사용자가 자막 설정을 바꾸지 않았음을 확인할 수 있을 때만 원래 트랙을 복원한다. 직접 요청과 fallback 각각 브리지는 16초, content의 자막 수집 대기는 40초다. 기존 29초 provider 대기는 유지한다.

0.11.1의 닫기는 panel.hidden으로 헤더까지 제거한다. 패널·자막 숨김은 displaySuppressed로 자막도 감춘다. showPanel은 숨김을 해제하고 기존 ON/언어/번역 결과를 유지한다. 표시는 세로 video 사각형을 따라가며 좁은 패널 헤더는 줄바꿈한다. Shorts 표면은 viewport 교차 면적이 가장 큰 가시 video이며 숨겨진 사전 로드 player를 제외한다. URL 영상 ID 변경은 세션을 닫고 늦은 결과를 폐기한다. 같은 ID의 media 교체/일시 분리는 설정 패널을 유지한다. MAIN 직렬화 함수도 독립적으로 같은 표면 선택 규칙과 player response 영상 ID 검증을 적용한다.

0.11.1: TranslatorVideoPanel.restore(id)는 현재 URL·영상 ID·연결된 host를 확인하고 기존 패널만 복원한다. launcher의 trusted 클릭은 이 함수를 먼저 호출한다. 상태/키/grant는 반환하지 않으며 동일 확장 isolated world에서만 공유한다. 기존 패널이 없으면 기존 background 진입으로 새 작업 권한을 검증한다. 빈 트랙 목록의 재열기는 기존 grant로 목록 재시도를 유지한다. 종료용 헤더 버튼은 제거했고 닫기는 panel.hidden만 설정한다.

0.11.2: panelDocument와 패널 파일 주입은 injectImmediately:true를 사용하고 주입·OPEN_VIDEO 메시지 단계는 각각 8초 대기 제한을 적용한다. video 모드는 core/video 관련 모듈만 주입한다. 타임아웃으로 종료된 단계의 늦은 주입 완료는 후속 OPEN을 실행하지 않는다. 이미 전달된 OPEN 메시지는 회수할 수 없으나 늦은 응답 처리로 기존 패널을 다시 열거나 사용자 토글 결과를 바꾸지 않는다. 문서/URL/grant 검증은 유지한다.

TranslatorVideoPanel.toggle(id)는 현재 패널이면 visible→hidden 또는 hidden→restore를 수행한다. isOpen(id)는 true/false, 해당 패널 없음이면 null이다. launcher는 실제 상태로 aria-expanded를 갱신하고 기존 패널을 조작할 때 background를 호출하지 않는다. OPEN_VIDEO/팝업은 항상 restore다. 최초 생성도 showPanel을 호출하며 화면 밖 영상은 scrollIntoView 후 초점을 맞춘다. 생성 예외는 state/host/session을 정리하고 opened:false로 응답해 재시도를 허용한다.

0.11.3: youtube-dom.createBinding은 영상 ID 변경과 같은 영상의 표면 준비를 분리한다. 연결된 player/video가 80×60px 이상으로 200ms 동일하게 유지되면 ready다. 일시 부재/0 크기/교체에서는 ready=false만 반환하며 ended는 실제 ID 변경이다. content는 준비 중 오른쪽 위 가시 사각형으로 설정 패널을 유지하고 자막을 숨긴다. currentPanel/토글은 media 노드와 독립적으로 현재 ID/host만 확인한다.

새 media 연결은 기존 AbortController를 해제하고 새 video의 seeked 이벤트를 연결한다. session context가 준비 중 suspended=true를 반환해 새 수집/번역을 쉬고 준비 후 깨운다. 같은 ID 결과/ON은 유지하며 OFF 조작은 준비 중에도 가능하다. 최초 목록 수집은 ready 이후 수행하고 실패 시 총 3회까지 1초/2초 간격으로 다시 읽는다. 수동 목록 새로고침은 재시도 횟수를 초기화한다. URL ID 변경/pagehide는 요청/이벤트/메모리를 정리한다. yt-navigate-start 자체로는 패널을 삭제하지 않는다.
