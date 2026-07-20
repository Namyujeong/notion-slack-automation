# notion-slack-automation

Notion, Slack, Google Drive의 반복 업무를 자동화하는 Node.js 예제 모음입니다.

이 공개 저장소는 **소스 코드와 비운영 예시만 제공**합니다.

- 활성 GitHub Actions workflow는 CI 하나뿐입니다.
- 운영 스케줄, workspace/channel/database/user ID, 토큰, webhook, 실행 state는 저장하지 않습니다.
- 실제 배포는 별도의 비공개 저장소나 비공개 실행 환경에서 구성해야 합니다.
- `examples/`, `.env.example`, `*.plist.example`, `codex-automations/*.example`은 자동 실행되지 않는 예시입니다.

## 포함된 작업

| 작업 | 경로 | 기능 |
|---|---|---|
| 주간 회의록 복사 | `jobs/weekly-meeting-copy` | 이전 Notion 회의록을 복사하고 날짜·체크 항목을 초기화 |
| Operations 회의록 복사 | `jobs/operations-meeting-copy` | 다음 회의용 문서 및 하위 데이터베이스 복사 |
| Team Weekly 회의록 | `jobs/team-weekly-meeting-copy` | 회의록 복사 후 선택적으로 Slack 알림 |
| 이슈 due 리마인더 | `jobs/issue-tracker-slack-reminder` | Notion 미완료 이슈를 담당자별 Slack 메시지로 구성 |
| 리액션 리마인더 | `jobs/flex-reaction-reminder` | 기준 메시지에 반응하지 않은 사용자 재알림 |
| 인보이스 요청 | `jobs/invoice-request` | 월별 요청과 후속 리마인더 관리 |
| 인보이스 파일 보관 | `jobs/invoice-attachment-archive` | Slack 첨부파일을 Google Drive에 보관 |
| Slack 채널 정리 | `jobs/slack-channel-cleanup` | 비활성 공개 채널 탐지·공지·아카이브 |

Slack 알림 작업에는 한국 주말·공휴일 가드가 포함됩니다.

## 빠른 시작

Node.js 24를 권장합니다.

```bash
npm run check
npm test
npm run check:secrets
```

설정 예시는 `.env.example`을 참고하되 실제 값은 커밋하지 않습니다.

```bash
cp .env.example .env.notion.local
npm run dry-run:weekly
```

실제 반영 명령은 외부 서비스의 문서·메시지·파일을 변경할 수 있으므로 먼저 dry-run 결과를 확인합니다.

## GitHub Actions 정책

`.github/workflows/ci.yml`만 활성 상태로 유지합니다. CI는 다음 항목만 수행합니다.

- Node.js 문법 검사
- 커밋된 secret 패턴 검사
- 테스트 실행

운영 workflow 예시는 [examples/github-actions/notion-weekly-meeting.yml.example](examples/github-actions/notion-weekly-meeting.yml.example)에 있습니다. 예시를 사용하려면 비공개 배포 저장소로 복사하고, 해당 저장소에서만 secret·variable·schedule을 설정합니다.

## 설정 및 운영 문서

- [Configuration](docs/CONFIGURATION.md)
- [External Scheduler](docs/EXTERNAL_SCHEDULER.md)
- [Runbook](docs/RUNBOOK.md)

## 보안 원칙

- 공개 저장소의 Actions secrets/variables에 운영 값을 등록하지 않습니다.
- Slack/Notion/GitHub 토큰, webhook URL, service-account key는 커밋하지 않습니다.
- channel/database/user/folder ID와 실행 state도 운영 정보로 취급합니다.
- state 파일은 저장소 밖의 비공개 저장소 또는 전용 state backend에 보관합니다.
- 토큰이 노출되었다면 Git 이력 삭제만으로 끝내지 않고 즉시 폐기·재발급합니다.

## 라이선스

[MIT](LICENSE)
