# OpenAI 직접 연동 설정과 오류 구분

0.16.0부터 OpenAI를 지원한다. 확장/페이지를 새로고침하고 OpenAI 공급자를 선택하여 API 키로 모델 목록을 조회한 뒤 모델을 저장한다. ChatGPT 구독/로그인을 API 키 대신 사용할 수 없다. Google/Kie에 저장된 키는 복사하지 않는다.

## 모델 목록

OpenAI API가 반환한 모델 중 번역 기능을 확인한 12개 ID(8개 모델 계열과 4개 스냅샷)의 교집합을 표시한다. 모든 계정에 12개가 표시되는 것은 아니다. API created 시각은 출시일로 사용하지 않으며 공식 발표/스냅샷 기록으로 정렬한다. 음성/이미지 생성/검색 전용·미확인·종료된 모델은 제외한다. 목록이 비면 키의 프로젝트·사용 권한과 지원 모델을 확인한다.

## 오류 안내

| 코드 | 의미와 조치 |
| --- | --- |
| PROVIDER_AUTH | OpenAI 키 또는 프로젝트의 권한 확인 |
| PROVIDER_BALANCE | API 잔액/할당량 확인 |
| OPENAI_RATE_LIMIT | 호출 한도; 기다린 뒤 직접 다시 실행 |
| OPENAI_REQUEST_TIMEOUT | 응답 대기 초과; 기존 요청 처리 여부가 불확실하므로 자동 반복하지 않음 |
| OPENAI_NETWORK / OPENAI_UNAVAILABLE | 연결 또는 서버 실패; 상태 확인 후 직접 재시도 |
| OPENAI_REFUSAL / OPENAI_INCOMPLETE | 거절 또는 출력 미완료; 범위/모델을 바꾸어 실행 |
| OPENAI_RESPONSE_JSON / OPENAI_RESPONSE_FORMAT | JSON 또는 응답 구조 불일치; 번역에 적용하지 않음 |
| OPENAI_TRANSPORT_START_TIMEOUT / START_FAILED | 확장 내부 문서 준비 실패; 확장과 페이지 새로고침 |
| OPENAI_TRANSPORT_DISCONNECTED / OPENAI_WORKER_START_FAILED | 내부 연결/Worker 실패; 확장 재로드 후 직접 재시도 |

OpenAI 오류에서 자막은 OFF로 바뀌며 자동 반복 호출하지 않는다. 키·원문·원시 오류 응답을 로그/채팅에 올릴 필요는 없다. 표시된 고정 코드로 실패 단계를 구분한다.

## 검증 범위

모의 자동 테스트 242개와 구문/설정 검사·보안 하네스를 통과했다. 실제 격리 Chrome 152에서 초기 응답 125ms, 45초 지연 응답 45,123ms, 재연결 122ms를 확인했으며 각 완료 뒤 offscreen context는 0개였다. 서비스 워커에 디버거를 붙이지 않았다. 설정 UI도 실제 Chrome에서 360/1280px 가로 넘침 없이 모델 조회·선택·저장·재로드를 확인했고 저장 키 입력란은 빈 상태였다.

전송 증거: `tools/.tmp/openai-smoke-1788714715692/result.json`. UI 증거: `tools/.tmp/openai-smoke-1788714872717/result.json`, 같은 폴더의 `options-360.png`, `options-1280.png`. 가짜 키/응답만 사용했으므로 실제 공급자의 모델 접근·요금·출력 정확성과 실제 YouTube 전송까지 검증한 것은 아니다. 검증 브라우저는 종료했다.
