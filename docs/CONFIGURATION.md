# Configuration

이 공개 저장소에는 운영 secret, variable, schedule, state를 설정하지 않습니다. `.github/workflows`에는 CI만 있으며 외부 서비스 API를 호출하지 않습니다.

## 로컬 예시

필요한 작업에 맞춰 `.env.example`을 로컬 파일로 복사합니다. `*.local` 파일은 `.gitignore` 대상입니다.

```bash
cp .env.example .env.notion.local
cp .env.example .env.slack.local
cp .env.example .env.invoice.local
```

예시 값은 반드시 자신의 테스트 workspace 값으로 교체하고, 실제 반영 전에 dry-run을 실행합니다.

## 비공개 배포 저장소

운영 자동화를 배포할 때는 이 저장소를 비공개 저장소로 복사한 뒤 다음 항목을 그곳에서만 설정합니다.

- API token과 webhook: GitHub Actions secrets 또는 전용 secret manager
- channel, database, user, folder ID: 비공개 variables 또는 secret manager
- 실행 state: 비공개 저장소, 데이터베이스, object storage 등 접근 제한된 backend
- schedule: 비공개 저장소 workflow 또는 신뢰할 수 있는 외부 스케줄러

공개 저장소에 운영 Actions secret을 등록하지 않는 것을 기본 정책으로 둡니다. 공개 저장소의 workflow가 변경되면 등록된 secret을 사용할 경로가 생길 수 있기 때문입니다.

## 최소 권한

서비스별 token은 필요한 작업 범위만 허용합니다.

| 서비스 | 일반적인 권한 예시 |
|---|---|
| Notion | 대상 page/database 읽기·쓰기 |
| Slack 메시지 | `chat:write`, 대상 채널 history/reaction 읽기 |
| Slack 채널 정리 | 공개 채널 조회·공지·아카이브 |
| Google Drive | 지정 폴더 파일 생성·조회 |

대상 채널·페이지·폴더 자체의 앱 접근 권한도 별도로 확인합니다.

## 예시 형식

`.env.example`과 `invoice-request-targets.example.json`의 ID는 가짜 값입니다. 운영 ID로 교체한 파일은 커밋하지 않습니다.

```json
{
  "targets": [
    {
      "name": "Example Owner",
      "slackUserId": "U0123456789",
      "services": ["Example SaaS"],
      "active": true
    }
  ]
}
```

## 커밋 전 검사

```bash
npm run check:secrets
git diff --cached
```

Secret scanner는 알려진 token·webhook·private-key 패턴을 탐지합니다. 식별자와 업무 내용까지 모두 판별하지는 못하므로 staged diff를 함께 검토해야 합니다.
