# Runbook

이 공개 저장소는 CI와 소스 예시만 제공하며 운영 자동화를 실행하지 않습니다. 아래 절차는 비공개 배포 환경에서 사용할 기본 점검표입니다.

## 배포 전

```bash
npm run check
npm test
npm run check:secrets
```

1. 비공개 환경에 필요한 secret과 식별자를 설정합니다.
2. 대상 Notion page/database, Slack channel, Drive folder에 앱 권한을 부여합니다.
3. 대상 job을 dry-run으로 실행합니다.
4. 중복 실행 경로가 없는지 확인합니다.
5. state backend의 접근 권한과 백업 방식을 확인합니다.
6. 확인 후에만 apply와 schedule을 활성화합니다.

## 장애 확인 순서

1. 실제 실행 주체와 실행 시각을 확인합니다.
2. config validation, API 인증, 대상 리소스 권한, rate limit 순으로 확인합니다.
3. 미발송·중복 발송은 모든 scheduler와 state key를 함께 점검합니다.
4. state 전체 삭제는 과거 작업 재실행을 일으킬 수 있으므로 필요한 key만 수정합니다.
5. token 노출이 의심되면 먼저 폐기·재발급하고 이후 로그와 Git 이력을 정리합니다.

## 공개 저장소 유지 기준

- `.github/workflows`에는 CI만 둡니다.
- 운영 workflow는 실행되지 않는 `.example` 파일로만 제공합니다.
- `state/`는 추적하지 않습니다.
- 운영 식별자, 내부 저장소명, 실제 URL을 문서·테스트 fixture에 넣지 않습니다.
- Actions 실행 기록에는 CI만 남깁니다.
