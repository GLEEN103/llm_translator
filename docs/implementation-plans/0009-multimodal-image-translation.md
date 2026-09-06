# 0009 — 멀티모달 이미지 번역

상태: 구현·검증·관련 문서 반영 완료 (0.7.0).

## 목적·범위

- 이미지 우클릭 → **이미지 번역** 메뉴를 추가한다. 현재 Google AI Studio 저장 모델로 이미지 속 문자를 인식하고 목표 언어로 번역하여 원본 이미지 위 오버레이에 표시한다.
- 이미지 수집·축소·재인코딩·오버레이는 기기 내에서 처리한다. 인식과 번역은 Google 멀티모달 API 한 번의 구조화 요청으로 처리한다. 기존 온디바이스 OCR 후 번역 계획은 이번 사용자 요청에 맞춰 변경한다.
- 목표 언어는 본문 설정 또는 한국어를 기본으로 사용하며 이미지 오버레이에서 변경/재번역할 수 있다. 인식 원문 펼치기, 진행/오류/재시도/닫기를 제공한다. 문자 없는 이미지는 별도 안내하고 내용을 지어내지 않는다.
- 기존 텍스트·본문 ON/OFF/캐시는 유지하고 이미지 결과는 작업 메모리에만 보관한다. 동영상 자막과 다른 공급자는 후속 범위다.

## 이미지 수집과 표시

- HTTP(S) 메인 문서의 로드된 `<img>`를 대상으로 한다. 클릭 srcUrl과 실제 currentSrc/src를 비교하고 중복일 때는 contextmenu 시점 요소를 사용한다. 대상을 확정하지 못하면 재우클릭을 안내하고 전송하지 않는다.
- 기존 이미지 픽셀을 canvas로 복사하고 최대 긴 변 2048px로 축소, PNG/JPEG로 재인코딩한다. 최대 4 MiB. URL/EXIF/쿠키/페이지 본문은 모델에 보내지 않는다.
- 다른 출처 이미지로 canvas 읽기가 차단되면 기존 activeTab 권한의 captureVisibleTab을 이용해 기기 내에서 해당 이미지 사각형만 잘라낸다. 페이지/탭/뷰포트/위치를 전후 재검사한다. 이미지가 잘렸거나 가려졌거나 변형되어 안전하게 사각형을 확인할 수 없으면 전송하지 않는다. 전체 화면을 모델에 보내지 않는다. 이미지가 화면 안에 모두 들어오도록 안내한다.
- 권한 확대/임의 이미지 URL 네트워크 fetch/서버/Files API 업로드는 추가하지 않는다. CORS 차단 이미지의 화면 캡처 경로는 화면에 표시된 해상도·프레임을 사용한다.
- 이미지 위치를 따라가는 closed Shadow DOM 오버레이를 사용하며 img 원본/스타일을 변경하지 않는다. src/크기/문서 변경·닫기·새 이미지 실행에서 늦은 응답을 무시하고 취소한다.

## 보안·호출 계약

- 0.7.0 업데이트 최초 1회 동의 문구에 이미지 전송/온디바이스 캡처·자르기를 포함한다. 이미지 메뉴 실행이 전송 동작이며 매회 추가 동의를 요구하지 않는다.
- background에서 동의·정확한 모델/revision·문서 grant·이미지 메뉴 실행 토큰을 검사한다. API 키는 기존 trusted local 슬롯에서만 읽고 content로 전달하지 않는다.
- MIME·base64·바이트/이미지 크기·응답 필드를 엄격히 검사한다. 응답은 `{recognizedText, translation, noText}`이며 HTML로 해석하지 않는다. 이미지 안의 지시도 데이터로 취급한다.
- 기존 동시 2요청·분당 30회와 취소/타임아웃/안전한 오류를 재사용하고 이미지 예산은 세션 50회(재시도 포함)를 별도 적용한다. 이미지 토큰을 원문 문자 예산으로 잘못 계산하지 않는다.
- 이미지/스크린샷/이미지 URL은 local/session/로그에 저장하지 않는다. 이미지 토큰과 문서 식별자만 메모리/문서 grant로 관리하며 worker 중단 시 이미지를 다시 실행하도록 안내한다.

## 변경 대상

- context-menu, broker, Google provider 공통 전송, 이미지 계약/수집/오버레이 모듈, 기존 content 연결.
- popup/options 동의·사용법, 보안 정책, 버전, 테스트/모의 이미지 fixture와 기획·구조·트러블슈팅 문서.

## 검증

- Node: 메뉴 라우팅, 이미지 계약·크기·응답 거절, Google inlineData payload/키·URL 비노출, 이미지 예산, 권한/동의/모델/문서/토큰, 취소·늦은 응답, 화면 캡처 탭 전환/잘림·crop 경계.
- 브라우저: 가짜 글자 이미지에서 canvas 수집·크기 제한, 오버레이/원문 불변·목표 언어·재시도·noText·이동/닫기/원본 변경, 텍스트 기능 회귀.
- 실제 API·실제 사용자 이미지·설치 Chrome 화면 캡처를 테스트에 사용하지 않는다. 모의 검증과 실환경 미검증 항목을 구분해서 기록한다.

## 확인한 공식 규격

- [Google 이미지 입력](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Google generateContent](https://ai.google.dev/api/generate-content)
- [Chrome tabs 캡처](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)

## 구현 결과

- 이미지 우클릭 메뉴, 현재 모델의 멀티모달 인식/번역, 이미지 위 오버레이, 목표 언어 변경·인식 원문·noText·오류/재시도·닫기를 구현했다.
- 기기 내 canvas 재인코딩과 CORS 차단 시 captureVisibleTab crop을 추가했다. 캡처는 위치·가림을 보수적으로 검사하며 투명 레이아웃 컨테이너의 오검출을 교차점 hit test로 보완했다. 이미지 원본과 기존 본문 상태는 유지한다.
- 이미지 요청/결과 규격, 이미지 메뉴 토큰, 설정·동의·문서 확인, 세션 50회 이미지 예산과 취소를 적용했다. 새 권한·서버·외부 패키지를 추가하지 않았다.
- 0.7.0 최초 동의 문구에 이미지 픽셀 전송과 온디바이스 캡처/crop을 명시했다. 키 정책 v4 유지, 전체 보안 설정 schema v6. 기획·전체 계획의 이전 온디바이스 OCR 전제도 갱신했다.

## 검증 결과·한계

- `npm test`: 72개 통과. `npm run check`: JavaScript 32개·JSON·확장 진입점·권한 범위 통과. `tools/verify-harness.ps1`: 구조·보안 설정 검사 통과, 비밀 파일 열람 없음.
- 브라우저 자동 검사: 기존 텍스트 DOM 40개 + 이미지 10개 통과. 실제 canvas 크기 축소·CORS taint·crop 크기·영역 외 픽셀 제거·작은 가림·원본 변경을 검사했다.
- 모의 UI: 이미지 한국어/일본어·인식 원문·문자 없음·오류/재시도·HTML 텍스트 표시·CORS 대체 경로·원본 교체/닫기 후 지연 응답 차단 확인. 기존 본문 54구간 완료와 추가 요청 없는 OFF 복원을 확인했다.
- 실제 Chrome 메뉴/실제 captureVisibleTab과 계정 API 통합은 미실행이다. CORS 이미지 자체의 taint는 실제 브라우저 검사, 캡처 전달은 모의 응답, crop은 실제 OffscreenCanvas 검사로 구분한다. 실제 사용자 이미지·API 키는 사용하지 않았다.
- 복잡한 합성 효과·큰 페이지·이미지 잘림/가림·동적 변경 및 실제 모델의 이미지/JSON 지원과 인식 정확도는 별도 실환경 검증 대상이다. 이미지 토큰은 worker 재생성 시 만료되므로 다시 우클릭해야 한다.
- [검증 기록](../troubleshooting/2026-09-06-multimodal-images.md), [사용법](../architecture/local-development.md), [실행 구조](../architecture/runtime.md), [보안](../architecture/security.md) 반영.
