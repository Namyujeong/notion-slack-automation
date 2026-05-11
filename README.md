# notion-slack-automation

Notion, Slack, Google Drive를 연결해 반복 운영 업무를 자동화하는 Node.js job 모음입니다.

이 저장소는 공개 공유용 sanitized snapshot입니다. 실제 워크스페이스 ID, Notion URL, Slack channel/user ID, Google Drive folder ID, 토큰, 실행 state는 포함하지 않습니다. 각 workflow와 job은 `.env.example`, GitHub Actions secrets, repository variables를 채워서 사용합니다.

Production 실행은 GitHub Actions 기준입니다. 정시성이 중요한 Slack/Invoice 작업은 외부 스케줄러가 GitHub `workflow_dispatch`를 호출하는 방식으로 실행합니다. 로컬 `launchd`와 Codex automation 예시는 백업/이관용으로 남겨두며, GitHub Actions가 active일 때는 중복 실행하지 않습니다.

## 빠른 시작

```bash
npm run check
npm test
npm run check:secrets
```

수동 실행은 항상 `dry-run`으로 먼저 확인합니다.

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

실제 반영은 상태를 바꾸는 GitHub Actions workflow의 `workflow_dispatch`에서 `apply`를 선택하거나, 로컬에서 필요한 `.env.*.local`을 설정한 뒤 `npm run run:*` 명령을 실행합니다.

## 작업 목록

| 작업 | 폴더 | 기본 실행 | 주요 side effect |
|---|---|---:|---|
| Weekly Ops Meeting 문서 복사 | `jobs/weekly-meeting-copy` | 월 10:00 KST | Notion 문서 생성 |
| Operations 문서 복사 | `jobs/operations-meeting-copy` | 월 12:00 KST | Notion 문서 생성 |
| Team Weekly 회의록 복사/알림 | `jobs/team-weekly-meeting-copy` | 월 10:00 KST external dispatch | Notion 문서 생성, Slack 채널 메시지 |
| team issue Slack 리마인더 | `jobs/issue-tracker-slack-reminder` | 월-금 10:00 KST external dispatch | Slack 채널 메시지, state 커밋 |
| Flex 휴가/결재 리액션 리마인더 | `jobs/flex-reaction-reminder` | 월 15:00/18:00 KST external dispatch | Slack 스레드 메시지, state 커밋 |
| 월별 인보이스 요청 | `jobs/invoice-request` | 월-금 10:00/15:00/18:00 KST external dispatch | Slack 메시지, state 커밋 |
| 인보이스 첨부파일 Drive 보관 | `jobs/invoice-attachment-archive` | 월-금 18:10 KST external dispatch | Google Drive 업로드, state 커밋 |
| Slack 미사용 채널 정리 | `jobs/slack-channel-cleanup` | 매월 1일 14:00 KST external dispatch | Slack 공지/채널 아카이브, state 커밋 |
| 한국 공휴일 fallback 감사 | `scripts/audit-korean-holiday-fallbacks.mjs` | 매년 1월 2일 09:00 KST | 실패 알림 |

공통 미팅 복사 로직은 `lib/meeting-copy.mjs`에 있습니다. 루트의 `index.mjs`와 `slack_due_reminder.mjs`는 기존 실행 경로 호환용 wrapper입니다.

## GitHub Actions

GitHub Actions cron은 UTC 기준입니다. 아래 표의 cron은 KST 실행 시각에서 9시간을 뺀 값입니다. `external dispatch`는 외부 스케줄러가 GitHub `workflow_dispatch` API를 호출합니다.

| Workflow | trigger | KST |
|---|---:|---:|
| `notion-weekly-meeting.yml` | `0 1 * * 1` | 월 10:00 |
| `notion-operations-meeting.yml` | `0 3 * * 1` | 월 12:00 |
| `notion-team-weekly-meeting.yml` | external dispatch | 월 10:00 |
| `slack-issue-reminder.yml` | external dispatch | 월-금 10:00 |
| `slack-flex-reaction-reminder.yml` | external dispatch | 월 15:00/18:00 |
| `slack-invoice-request.yml` | external dispatch | 월-금 10:00/15:00/18:00 |
| `slack-invoice-attachment-archive.yml` | external dispatch | 월-금 18:10 |
| `slack-channel-cleanup.yml` | external dispatch | 매월 1일 14:00 |
| `korean-holiday-fallback-audit.yml` | `0 0 2 1 *` | 매년 1월 2일 09:00 |

상태를 바꾸는 workflow의 수동 실행 기본값은 `dry-run`입니다. 실제 반영이 필요한 경우에만 `apply`를 선택합니다. 공휴일 감사 workflow는 값을 변경하지 않으므로 대상 연도만 선택적으로 입력합니다.

Slack/Invoice 작업은 중복 발송을 막기 위해 `state/*.json`에 실행 상태를 저장합니다. GitHub Actions는 `apply` 실행 후 state 변경분이 있으면 `[skip ci]` 커밋으로 같은 브랜치에 자동 반영합니다. 저장소 설정에서 `Settings > Actions > General > Workflow permissions`를 `Read and write permissions`로 설정해야 합니다.

## 설정 문서

- [Configuration](docs/CONFIGURATION.md): GitHub Actions secrets, 로컬 `.env`, 권한 범위, JSON secret 형식
- [External Scheduler](docs/EXTERNAL_SCHEDULER.md): 외부 스케줄러가 GitHub `workflow_dispatch`를 호출하는 방식
- [Runbook](docs/RUNBOOK.md): 수동 실행, 장애 대응, state 재처리, 공휴일 감사 운영

필수 repository secrets 요약:

| Secret | 용도 |
|---|---|
| `NOTION_TOKEN` | Notion API 접근 |
| `OPS_SLACK_BOT_TOKEN` | team issue Slack 봇 |
| `FLEX_SLACK_BOT_TOKEN` | Flex 리액션 리마인더 Slack 봇 |
| `INVOICE_SLACK_BOT_TOKEN` | 인보이스 Slack 봇 |
| `TEAM_SLACK_BOT_TOKEN` | 팀 회의록 알림 Slack 봇 |
| `SLACK_USER_TOKEN` | Slack 미사용 채널 조회/아카이브용 User OAuth token |
| `SLACK_BOT_TOKEN` | Slack 미사용 채널 공지용 Bot token |
| `SLACK_USER_MAP_JSON` | Notion 담당자와 Slack user ID 매핑 |
| `INVOICE_REQUEST_TARGETS_JSON` | 인보이스 담당자와 서비스 목록 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Drive 업로드용 service account JSON 전체 |
| `GOOGLE_DRIVE_INVOICE_FOLDER_ID` | 인보이스 Drive 루트 폴더 ID |

선택 failure webhook secrets:

| Secret | 용도 |
|---|---|
| `DUE_REMINDER_FAILURE_WEBHOOK_URL` | team issue 리마인더 실패 알림 |
| `FLEX_FAILURE_WEBHOOK_URL` | Flex 리마인더 실패 알림 |
| `INVOICE_FAILURE_WEBHOOK_URL` | 인보이스 요청/첨부파일 수집 실패 알림 |
| `HOLIDAY_FAILURE_WEBHOOK_URL` | 한국 공휴일 fallback 감사 실패 알림 |
| `SLACK_FAILURE_WEBHOOK_URL` | job별 webhook이 없을 때 쓰는 공통 실패 알림 |

## 봇별 동작 방식

### Weekly Ops Meeting 문서 복사 봇

Weekly Ops Meeting 봇은 매주 월요일 10:00 KST에 Operations 페이지의 Meetings 데이터베이스를 보고, 당일 날짜의 `Weekly Ops Meeting` 문서가 없으면 직전 주 미팅 문서를 새 날짜로 복사합니다.

동작 흐름:

- 타깃 날짜는 실행일 당일입니다.
- 타깃 날짜 문서가 이미 있으면 아무것도 만들지 않습니다.
- 타깃 날짜가 대한민국 법정 공휴일 또는 대체공휴일이면 생성하지 않습니다.
- 복사 원본은 `Date` 기준으로 타깃 날짜보다 이전인 최신 `Weekly Ops Meeting` 문서입니다.
- 복사된 문서 제목과 본문/하위 DB row title 안의 기존 날짜는 target date 기준으로 바꿉니다.
- `온도 체크` 섹션은 사람별 멘션만 남기고, 각 멘션 아래 코멘트 영역은 빈칸으로 초기화합니다.
- 하위 `아젠다` DB는 새 회의록에 복제하지 않고, Operations 상위 문서의 중앙 아젠다 DB를 cell wrap이 켜진 table linked database view로 삽입합니다.

### Operations 문서 복사 봇

Operations 문서 복사 봇은 매주 월요일 12:00 KST에 Meeting Notes 데이터베이스를 보고, 다음날 화요일 회의용 `Operations` 문서를 미리 만듭니다.

동작 흐름:

- 타깃 날짜는 실행일 기준 다음날입니다.
- 타깃 날짜의 `Operations` 문서가 이미 있으면 중복 생성하지 않습니다.
- 타깃 날짜가 대한민국 법정 공휴일 또는 대체공휴일이면 생성하지 않습니다.
- 복사 원본은 `Date` 기준으로 타깃 날짜보다 이전인 최신 `Operations` 문서입니다.
- `Check-in` 섹션의 체크박스는 모두 unchecked 상태로 초기화합니다.
- 하위 `Decision`, `Tracking` child database는 기존 동작대로 새 회의록에 복제합니다.
- 복제한 child database의 table view는 cell wrap을 켜서 `Result` 같은 긴 텍스트 컬럼의 개행이 화면에서도 유지되게 합니다.
- 하위 DB row title과 본문 안의 원본 날짜/제목은 새 target date/title로 바꿉니다.

### Team Weekly 회의록 복사/알림 봇

Team Weekly 봇은 매주 월요일 10:00 KST에 Meeting Notes 데이터베이스를 보고, 당일 날짜의 `Team Weekly` 문서가 없으면 직전 팀 주간 문서를 복사한 뒤 지정 Slack 채널에 멘션과 새 Notion URL을 보냅니다.

동작 흐름:

- 타깃 날짜는 실행일 당일입니다.
- 타깃 날짜의 `Team Weekly` 문서가 이미 있으면 중복 생성하지 않고 Slack 메시지도 보내지 않습니다.
- 타깃 날짜가 대한민국 법정 공휴일 또는 대체공휴일이면 생성하지 않습니다.
- 복사 원본은 `Date` 기준으로 타깃 날짜보다 이전인 최신 `Team Weekly` 문서입니다.
- 복사된 문서 제목과 본문/하위 DB row title 안의 기존 날짜는 target date 기준으로 바꿉니다.
- 하위 child database는 새 회의록에 복제하지 않고, `TEAM_SHARED_SCHEDULE_URL`로 지정한 중앙 일정/휴가 DB를 calendar linked database view로 삽입합니다.
- 원본 문서에 휴가 공유 child DB가 없더라도 `휴가 공유` 섹션을 만들고 중앙 일정/휴가 DB linked view를 보강 삽입합니다.
- linked database view 생성에 실패하면 중앙 DB 링크 문단을 fallback으로 삽입합니다.
- Slack 메시지는 `@team <노션문서 URL> yy-mm-dd 주간 회의 회의록입니다. 갱신 부탁드립니다.` 형식입니다.
- Slack target과 mention은 `MEETING_SLACK_CHANNEL_ID`, `MEETING_SLACK_MENTION`으로 설정합니다.

### team issue Slack 리마인더 봇

team issue 리마인더는 외부 스케줄러가 월-금 10:00 KST에 GitHub `workflow_dispatch`를 호출하면, Notion의 team issue tracker를 조회하고 처리되지 않은 due item을 `#team-ops` 채널에 담당자별로 묶어 알립니다.

동작 흐름:

- 실행일이 대한민국 법정 공휴일 또는 대체공휴일이면 알림을 보내지 않습니다.
- 오늘 기준 최근 30일 이슈만 조회합니다.
- `Done` 상태가 아닌 이슈 중 due date가 지났거나, 오늘 또는 내일까지 마감인 이슈를 대상으로 삼습니다.
- Notion date range는 `end date`를 due date로 우선 사용하고, `end date`가 없으면 `start date`를 사용합니다.
- 메시지는 담당자별 Slack 멘션 아래에 이슈 링크와 due label을 묶어 한 번에 보냅니다.
- 이슈 제목이 비어 있으면 `제목 없음`으로 표시합니다.
- 같은 이슈/담당자/target date 조합은 state에 기록해 중복 발송을 막습니다.
- GitHub 내부 `schedule` 이벤트 누락을 피하기 위해 GitHub cron이 아니라 외부 스케줄러의 `workflow_dispatch` 호출을 primary trigger로 사용합니다.

### Flex 휴가/결재 리액션 리마인더 봇

Flex 리마인더는 Slack Workflow Builder가 올린 `[Flex 승인 리마인드]` 메시지를 기준으로, 확인 리액션을 누르지 않은 사람만 스레드에서 다시 멘션합니다.

동작 흐름:

- 기준 요청 메시지는 매주 월요일 11:00 KST에 리드방에 올라오는 `[Flex 승인 리마인드]` 문구입니다.
- Slack Workflow Builder의 원본 요청 메시지는 11:00 KST 1회만 발송되어야 합니다. 15:00/18:00에는 새 채널 메시지를 만들지 않습니다.
- 봇은 월요일 15:00 KST에 1차, 18:00 KST에 2차로 같은 채널을 확인합니다.
- 원본 메시지가 몇 분 늦게 생성되거나 GitHub run이 몇 초 어긋나도 놓치지 않도록 첫 확인 기준은 180분, 리마인더 간격은 120분으로 둡니다.
- 외부 스케줄러가 GitHub `workflow_dispatch`를 호출하는 방식으로 실행합니다.
- 같은 날 `[Flex 승인 리마인드]` 원본이 여러 개 발견되면 가장 이른 원본만 기준으로 삼고, 이후 원본은 중복으로 보고 무시합니다.
- `FLEX_TARGET_USER_IDS`에 등록된 리드 중 `:white_check_mark:` 리액션을 누르지 않은 사람을 찾습니다.
- `FLEX_EXCLUDED_USER_IDS`에 등록된 퇴사/제외 계정은 항상 리마인더 대상에서 제외합니다.
- Slack `users.info`로 현재 active member인지 확인하고, 퇴사/비활성/봇 계정은 리마인더 대상에서 제외합니다. 이 자동 필터는 Flex Slack 앱에 `users:read`가 있어야 동작합니다.
- 미확인 대상자만 원본 메시지 스레드에 다시 멘션합니다.
- 같은 원본 메시지에는 최대 2회까지만 리마인드합니다.
- 완료 상태와 리마인드 횟수는 state에 저장합니다.

### 월별 인보이스 요청 봇

인보이스 요청 봇은 매월 전월 인보이스를 담당자별 Slack 스레드로 요청하고, 같은 스레드 안에서 당일/기한 전/기한 당일 리마인드를 관리합니다.

동작 흐름:

- 기본 요청일은 매월 10일입니다.
- 10일이 주말 또는 대한민국 법정 공휴일이면 다음 영업일로 자동 이동합니다.
- 요청 대상 기간은 기본적으로 전월입니다. 예: 2026년 5월 요청은 2026년 4월 인보이스입니다.
- 10:00 KST 실행에서 담당자별 parent message와 상세 요청 thread message를 만듭니다.
- 외부 스케줄러가 월-금 10:00/15:00/18:00 KST에 GitHub `workflow_dispatch`를 호출하는 방식으로 실행합니다.
- 요청 문구에는 담당 서비스 목록과 제출 기한을 포함합니다.
- 제출 기한은 실제 요청일 기준 3영업일 뒤 18:00 KST입니다.
- 요청 당일 15:00 KST에 파일 업로드, 담당자 회신, 완료 리액션이 없으면 `당일 1차 리마인드`를 같은 스레드에 남깁니다.
- 요청 당일 18:00 KST에도 아직 완료 신호가 없으면 `당일 2차 리마인드`를 같은 스레드에 남깁니다.
- 기한 전 영업일은 10:00 KST 이후 실행에서 `기한 전 리마인드`, 기한 당일 15:00 이후에는 `마감일 리마인드`를 보냅니다. 10시 실행이 늦어져도 15시/18시 실행에서 보정됩니다.
- 담당자가 파일을 올리거나, 스레드에 회신하거나, `:white_check_mark:` 리액션을 누르면 추가 리마인드를 멈춥니다.
- 요청/리마인드 발송 상태는 `state/slack-invoice-request-state.json`에 저장합니다.

### 인보이스 첨부파일 Drive 보관 봇

인보이스 첨부파일 보관 봇은 인보이스 요청 봇이 만든 스레드를 확인하고, 담당자가 올린 새 파일을 Google Drive 월별 폴더에 업로드합니다.

동작 흐름:

- 월-금 18:10 KST에 실행됩니다.
- 외부 스케줄러가 GitHub `workflow_dispatch`를 호출하는 방식으로 실행합니다.
- `state/slack-invoice-request-state.json`에 저장된 인보이스 요청 스레드만 대상으로 합니다.
- 기본적으로 담당자 본인이 해당 스레드에 올린 파일만 보관합니다.
- 이미 업로드한 Slack file ID는 archive state에 저장해 중복 업로드를 막습니다.
- Drive 폴더 구조는 `GOOGLE_DRIVE_INVOICE_FOLDER_ID / FY<연도> / YYYY-MM`입니다.
- 월별 폴더에는 `_status_YYYY-MM.md`를 업데이트해 담당자별 수집 현황을 볼 수 있게 합니다.

### Slack 미사용 채널 정리 봇

Slack 미사용 채널 정리 봇은 오래 활동이 없는 공개 채널을 찾아 사전 공지 후 아카이브하는 운영 보조 봇입니다.

동작 흐름:

- 매월 1일 14:00 KST에 실행됩니다.
- 외부 스케줄러가 GitHub `workflow_dispatch`를 호출하는 방식으로 실행합니다.
- Slack 채널 목록과 각 채널의 최신 메시지를 조회합니다.
- 기본 기준은 최근 365일 동안 활동이 없는 public channel입니다.
- allowlist에 들어간 채널, prefix allowlist에 걸린 채널, shared channel 등은 후보에서 제외합니다.
- 후보 채널에는 먼저 정리 예정 공지를 남기고 state에 기록합니다.
- 공지 후 지정된 유예 기간이 지나도 조건이 유지되면 채널을 아카이브합니다.
- 조회, 공지, 아카이브 결과는 state에 저장해 중복 처리와 재시도를 제어합니다.

### 한국 공휴일 fallback 감사 봇

공휴일 fallback 감사 봇은 매년 초 한국 법정 공휴일 static fallback이 최신 캘린더와 맞는지 확인하는 안전장치입니다.

동작 흐름:

- 매년 1월 2일 09:00 KST에 실행됩니다.
- Google 한국 공휴일 캘린더에서 해당 연도의 법정 공휴일을 읽습니다.
- `lib/korean-holiday-fallbacks.mjs`에 들어 있는 static fallback 날짜와 비교합니다.
- 캘린더에는 있는데 fallback에 없거나, fallback에는 있는데 캘린더에 없으면 실패합니다.
- 해당 연도에 `provisional` fallback이 남아 있어도 실패합니다.
- 실패 시 GitHub Actions 실패 알림 webhook을 통해 수동 확인이 필요하다는 신호를 보냅니다.

## 로컬 환경

`.env.example`을 참고해 필요한 로컬 파일만 만듭니다. 이 파일들은 `.gitignore` 대상이며 토큰은 커밋하지 않습니다.

```bash
cp .env.example .env.notion.local
cp .env.example .env.slack.local
cp .env.example .env.flex.local
cp .env.example .env.invoice.local
cp .env.example .env.google.local
```

실제 운영은 GitHub Actions secrets를 기준으로 하며, 로컬 `.env.*.local`은 드라이런과 긴급 수동 실행용입니다. 복사한 파일에서는 해당 작업에 필요한 값만 남기고 나머지는 제거합니다.

## 검증

```bash
npm run check
npm run check:secrets
npm run validate:config -- issue-reminder
npm test
```

공휴일 fallback 감사:

```bash
npm run audit:holidays -- 2026
```

개별 드라이런:

```bash
node jobs/weekly-meeting-copy/index.mjs --date 2026-03-02 --dry-run
node jobs/operations-meeting-copy/index.mjs --date 2026-05-05 --dry-run
node jobs/team-weekly-meeting-copy/index.mjs --date 2026-05-11 --dry-run
node jobs/issue-tracker-slack-reminder/index.mjs --dry-run
node jobs/flex-reaction-reminder/index.mjs --dry-run
node jobs/invoice-request/index.mjs --today 2026-05-11 --hour 10 --dry-run
node jobs/invoice-attachment-archive/index.mjs --dry-run --check-slack
node jobs/slack-channel-cleanup/index.mjs --dry-run --check-slack
```

## 로컬 스케줄링 예시

기존 로컬 실행 예시는 `launchd`에서 각 작업 폴더의 `index.mjs`를 실행합니다. GitHub Actions로 운영할 때는 아래 plist/Codex 예시를 켜지 않습니다.

- `com.example.notion-weekly-meeting.plist.example`
- `com.example.notion-operations-meeting.plist.example`
- `com.example.notion-due-reminder.plist.example`
- `com.example.flex-reaction-reminder.plist.example`
- `com.example.invoice-request.plist.example`
- `com.example.invoice-attachment-archive.plist.example`
- `codex-automations/*.toml.example`

로컬 적용 시 plist 예시 파일의 `/path/to/notion-slack-automation` 값과 Codex 예시의 `cwds` 값을 실제 저장소 경로로 교체합니다. `launchd`는 Mac 시스템 시간대를 따르며, 현재 의도한 기준은 KST입니다.
