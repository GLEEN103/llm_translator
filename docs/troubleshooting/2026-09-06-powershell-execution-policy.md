# PowerShell 검증 스크립트 실행 정책

- 관련 계획: [0001 — 프로젝트 하네스](../implementation-plans/0001-project-harness.md)
- 상태: 해결

## 증상과 원인

`powershell -NoProfile -File tools/verify-harness.ps1` 실행 시 `PSSecurityException`과 `UnauthorizedAccess`가 발생했다. 출력은 시스템에서 스크립트 실행이 비활성화되어 있음을 나타냈다. 전역 설정 파일은 열람하지 않았다.

## 조치

검증용 프로세스에만 실행 정책을 지정했다.

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File tools/verify-harness.ps1
```

사용자·시스템 실행 정책을 변경하지 않았다. 조직 정책 등으로 계속 차단되는 환경에서는 추가 우회 없이 차단 사실을 보고한다.

## 검증과 재발 방지

종료 코드 0과 `PASS` 출력을 확인했다. 루트 README와 AGENTS의 검증 명령에 프로세스 한정 옵션을 반영했다. 검증 스크립트는 비밀정보 파일을 읽지 않는다.
