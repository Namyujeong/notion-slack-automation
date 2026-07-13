# Runbook

이 문서는 자동화 운영 중 확인해야 할 절차와 장애 대응 기준을 정리합니다.

## 기본 확인 순서

1. GitHub Actions에서 해당 workflow run을 확인합니다.
2. 실패한 step의 로그를 확인합니다.
3. `Validate config` 실패면 repository secrets 또는 workflow env를 먼저 봅니다.
4. 외부 API 실패면 Notion/Slack/Google 권한과 rate limit, 대상 채널/DB 접근 권한을 확인합니다.
5. 중복 발송 또는 미발송이면 `state/*.json` 변경 내역을 확인합니다.

Slack 메시지 발송/수집 계열 workflow는 GitHub 내부 `schedule`이 아니라 외부 스케줄러의 `workflow_dispatch` 호출이 primary trigger입니다. 정시에 실행되지 않았으면 외부 스케줄러의 HTTP call 로그를 먼저 확인합니다.

## 수동 실행

GitHub Actions에서 각 workflow의 `Run workflow`를 사용합니다.

| 작업 | workflow | 기본 mode |
|---|---|---|
| Weekly Ops Meeting 문서 복사 | `notion-weekly-meeting.yml` | `dry-run` |
| Operations 문서 복사 | `notion-operations-meeting.yml` | `dry-run` |
| Team Weekly 회의록 복사/알림 | `notion-team-weekly-meeting.yml` | `dry-run` |
| team issue 리마인더 | `slack-issue-reminder.yml` | `dry-run` |
| Flex 리마인더 | `slack-flex-reaction-reminder.yml` | `dry-run` |
| 인보이스 요청 | `slack-invoice-request.yml` | `dry-run` |
| 인보이스 첨부파일 보관 | `slack-invoice-attachment-archive.yml` | `dry-run` |
| Slack 미사용 채널 정리 | `slack-channel-cleanup.yml` | `dry-run` |
| 공휴일 fallback 감사 | `korean-holiday-fallback-audit.yml` | 연도 입력 선택 |

실제 반영 전에는 `dry-run` 결과를 먼저 확인합니다. 문제가 없으면 같은 workflow를 `apply`로 다시 실행합니다.

Operations 문서 복사에서 같은 날짜의 문서가 이미 있어도 다시 생성해야 하는 경우에만 `force`를 켭니다. `apply`와 `force`를 함께 선택하면 같은 날짜와 제목의 문서가 추가로 생성될 수 있으므로 장애 복구나 명시적인 재생성에만 사용합니다. 정기 실행에서는 `force`가 항상 꺼집니다.

## 로컬 드라이런

```bash
npm run dry-run:weekly
npm run dry-run:operations
npm run dry-run:team-weekly
npm run dry-run:slack
npm run dry-run:flex
npm run dry-run:invoice
npm run dry-run:invoice-archive
npm run dry-run:channel-cleanup
```

날짜를 고정해서 재현할 때:

```bash
node jobs/weekly-meeting-copy/index.mjs --date 2026-03-02 --dry-run
node jobs/operations-meeting-copy/index.mjs --date 2026-05-05 --dry-run
node jobs/team-weekly-meeting-copy/index.mjs --date 2026-05-11 --dry-run
node jobs/invoice-request/index.mjs --today 2026-05-11 --hour 10 --dry-run
```

인보이스 첨부파일 보관은 Slack thread까지 실제 조회하는 드라이런이 따로 있습니다.

```bash
node jobs/invoice-attachment-archive/index.mjs --dry-run --check-slack
```

## State 파일

GitHub Actions 운영 state는 `state/*.json`에 저장됩니다.

| 파일 | 용도 |
|---|---|
| `state/slack-due-reminder-state.json` | 이슈/담당자/target date 중복 발송 방지 |
| `state/slack-flex-reaction-reminder-state.json` | Flex 원본 메시지별 리마인드 횟수 |
| `state/slack-invoice-request-state.json` | 월별 인보이스 요청/리마인드 thread 상태 |
| `state/slack-invoice-archive-state.json` | Slack file ID별 Drive 업로드 상태 |
| `state/slack-channel-cleanup-state.json` | 미사용 채널 공지 timestamp와 아카이브 예정일 |

State를 직접 수정하면 중복 발송 또는 누락이 생길 수 있습니다. 수정이 필요한 경우 해당 key만 최소 범위로 변경하고 PR로 남깁니다.

인보이스 요청 state의 `reminders`에는 `same_day_first`, `same_day_second`, `pre_deadline`, `deadline_day` 단계가 저장됩니다. 같은 단계의 리마인드는 한 번만 발송됩니다.

## 장애 대응

### `Validate config` 실패

원인:

- repository secret 누락
- JSON secret 파싱 실패
- Slack channel ID 형식 오류
- Google service account JSON 누락

대응:

```bash
npm run validate:config -- issue-reminder
npm run validate:config -- team-weekly-meeting
npm run validate:config -- invoice-request
npm run validate:config -- invoice-archive
```

로컬에서는 같은 env를 재현해 validator를 먼저 통과시킵니다.

### Notion 접근 실패

확인할 것:

- `NOTION_TOKEN`이 현재 integration token인지
- Operations 페이지와 실제 데이터베이스 source에 integration이 연결되어 있는지
- 데이터베이스 ID/source ID가 workflow env와 일치하는지

특히 Notion은 상위 페이지 권한과 데이터베이스 source 권한이 다르게 보일 수 있습니다. 페이지에서 `Already added`로 보여도 source 접근이 막혀 있으면 API 조회가 실패할 수 있습니다.

### Slack 메시지 또는 인보이스 수집이 정시에 실행되지 않음

확인할 것:

- 외부 스케줄러가 해당 workflow의 `workflow_dispatch` API를 2xx로 호출했는지
- bot token이 해당 앱의 최신 `xoxb-...` 값인지
- 봇이 대상 채널에 초대되어 있는지
- workflow env의 channel ID가 실제 채널인지
- `dry-run` mode로 실행한 것이 아닌지
- 실행일이 한국 법정 공휴일이라 skip된 것이 아닌지

team issue 리마인더는 미완료 이슈가 없거나, due date가 조회 범위 밖이면 메시지를 보내지 않습니다.

### Slack 미사용 채널 정리 이슈

확인할 것:

- `SLACK_USER_TOKEN`에 `channels:read`, `channels:history`, `channels:write`가 있는지
- `SLACK_BOT_TOKEN`에 `chat:write`, `chat:write.public`이 있는지
- `Run mode`가 `apply`인지
- 실행 시각이 한국시간 14시대인지
- 로그의 `skip_history_error`가 과도하게 많지 않은지

후보 채널 공지 후에는 `state/slack-channel-cleanup-state.json`에 `notice_ts`와 `archive_after_at`이 저장됩니다. 다음 월 1일 실행 때 공지 이후 새 채널 메시지가 없으면 아카이브합니다.

### 중복 발송 또는 재발송 필요

중복 발송 방지는 state 파일 기준입니다.

- 같은 내용을 다시 보내야 하면 해당 state key를 제거해야 합니다.
- 전체 state 파일 삭제는 과거 항목까지 재발송할 수 있으므로 피합니다.
- 수정 후 PR로 남기고 GitHub Actions에서 수동 `apply`를 실행합니다.

Flex 원본 요청이 15:00/18:00에 새 채널 메시지로 다시 올라오면 GitHub `slack-flex-reaction-reminder.yml` 문제가 아니라 Slack Workflow Builder 또는 별도 스케줄러의 중복 원본 발송일 가능성이 높습니다.

- 의도한 구조는 월요일 11:00 KST 원본 요청 1회, 15:00/18:00 KST 스레드 리마인더입니다.
- Slack Workflow Builder에는 11:00 원본 요청만 남기고, 15:00/18:00 새 메시지 발송 workflow는 비활성화합니다.
- GitHub Flex job 로그에 `duplicate Flex source`가 보이면 같은 날 원본 메시지가 2개 이상 감지된 것입니다. 봇은 가장 이른 원본만 처리하고 나머지는 무시합니다.
- 로컬 `launchd` 경로는 production에서 사용하지 않습니다. `~/Library/LaunchAgents/com.example.flex-reaction-reminder.plist`가 로드되어 있으면 내려야 합니다.

### GitHub Actions state 커밋 실패

확인할 것:

- `Settings > Actions > General > Workflow permissions`가 `Read and write permissions`인지
- 같은 state 파일을 수정하는 workflow가 동시에 돌지 않았는지
- workflow의 retry 로그에서 `git pull --rebase`가 실패했는지

### Google Drive 업로드 실패

확인할 것:

- `GOOGLE_SERVICE_ACCOUNT_JSON`이 JSON 전체인지
- service account `client_email`이 Drive 루트 폴더에 편집자 권한으로 공유되어 있는지
- `GOOGLE_DRIVE_INVOICE_FOLDER_ID`가 폴더 ID인지
- Slack 앱에 `files:read` 권한이 있는지

## 공휴일 fallback 감사

자동 실행:

```text
매년 1월 2일 09:00 KST
```

수동 실행:

```bash
npm run audit:holidays -- 2026
```

감사 실패 조건:

- Google 한국 공휴일 캘린더에는 있는데 static fallback에 없는 법정 공휴일
- static fallback에는 있는데 Google 캘린더에는 없는 날짜
- 감사 대상 연도에 `provisional` source가 남아 있는 항목

실패하면 `lib/korean-holiday-fallbacks.mjs`를 공식 월력요항 기준으로 갱신하고, 아래 검증을 통과시킨 뒤 PR로 반영합니다.

```bash
npm run check
npm test
npm run audit:holidays -- <year>
```

## 배포 전 체크리스트

- `npm run check`
- `npm test`
- `npm run check:secrets`
- 관련 job의 `dry-run`
- workflow 변경 시 GitHub Actions PR check 통과

## 운영 원칙

- 자동화는 기본적으로 멱등성을 가져야 합니다.
- 실제 메시지/문서/Drive 업로드가 생기는 작업은 `dry-run` 먼저 확인합니다.
- 토큰과 webhook URL은 issue, PR 본문, README, 로그에 남기지 않습니다.
- 공휴일/대체휴일처럼 운영 일정에 영향을 주는 값은 공식 기준 확인 후 반영합니다.
