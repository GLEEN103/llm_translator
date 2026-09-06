# 저장소 구조

```text
chrome_translator/
├── AGENTS.md
├── README.md
├── package.json             # 개발 검증 명령만 제공
├── config/security-policy.json
├── src/extension/           # 확장 프로그램 전체 실행 코드
├── tools/                   # 테스트·문법·하네스·모의 브라우저 검증
└── docs/
    ├── planning/
    ├── implementation-plans/
    ├── troubleshooting/
    └── architecture/
```

실제 코드는 `src/extension/`, 개발 도구는 `tools/`, 공개 정책은 `config/`, 문서는 네 종류별 `docs/` 하위 디렉토리에 둔다. 별도 빌드나 외부 npm 의존성은 없다.

통계 화면도 `src/extension/statistics.html`에 둔 확장 내부 페이지이며 통계 기록은 `usage.mjs`, 팝업 요약은 `popup-usage.mjs`가 담당한다. 모의 데이터/UI 검증은 `tools/fixtures/usage-fixture.mjs`, 집계 검증은 `tools/tests/usage.test.mjs`에 분리한다.

kie.ai 고정 모델 목록은 `src/extension/kie-models.mjs`, 공급자 어댑터는 `kie.mjs`, 모델 카드 UI는 `options.html/js/css`에서 관리한다. `tools/tests/kie.test.mjs`와 `broker.test.mjs`에서 형식·키 경계를 검증하며 공식 문서 근거·지원 범위는 문서 디렉토리의 [0021](../implementation-plans/0021-kie-provider-and-model-browser.md)에 둔다.

현재 제품은 확장 단독으로 동작한다. `src/server/` 실행 코드, 등록 도구, 서버 예제 설정, 환경변수 템플릿은 제거했다. 과거 사용자가 만든 비밀정보 파일은 열람·삭제하지 않으며 `.gitignore` 제외 규칙을 유지한다.

구현 전 계획을 작성하고 구현 후 실제 상태·검증 결과를 문서에 반영한다. 이전 구현계획은 역사적 기록으로 명시하며 현행 방향은 [0002](../implementation-plans/0002-text-first-translation-roadmap.md), 전환 결과는 [0004](../implementation-plans/0004-extension-direct-api.md)를 따른다.

설치 안내는 [확장 사용](local-development.md), 내부 역할은 [실행 구조](runtime.md), 키 취급은 [보안 정책](security.md)에 둔다.

0.14.0 공개 가격은 `src/extension/kie-pricing.mjs`, 검증은 `tools/tests/kie-pricing.test.mjs`에서 관리한다. 공식 데이터 근거·지원 모델·단위 누락 대응은 [0022](../implementation-plans/0022-kie-live-pricing-and-chat-models.md)에 기록한다. 제품 안에 고정 가격표나 공식 사이트 스크립트를 복사하지 않는다.

Git 기본 브랜치는 `main`, 원격 `origin`은 `https://github.com/GLEEN103/llm_translator.git`다. `.gitattributes`에서 텍스트 줄바꿈을 정규화하며 PowerShell 작업 파일은 CRLF를 사용한다. `.gitignore`가 비밀정보 파일, `tools/.tmp/`의 격리 Chrome 프로필과 검증 산출물, 로그 및 의존성을 제외한다.
