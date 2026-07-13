# Configuration

이 문서는 GitHub Actions secrets, 로컬 `.env`, 외부 서비스 권한을 정리합니다.

## 원칙

- 토큰, webhook URL, service account JSON은 커밋하지 않습니다.
- Production은 GitHub Actions repository secrets를 기준으로 실행합니다.
- 로컬 `.env.*.local` 파일은 드라이런과 긴급 수동 실행용입니다.
- `npm run check:secrets`는 커밋된 파일 안의 Slack/Notion/GitHub 토큰, Slack webhook, Google private key 패턴을 검사합니다.

## GitHub Actions Secrets

Flex를 제외한 Slack/Invoice workflow의 정기 실행은 외부 스케줄러가 GitHub `workflow_dispatch` API를 호출합니다. Flex는 저장소의 GitHub Actions schedule을 사용합니다. 외부 스케줄러용 GitHub token은 repository secret이 아니라 외부 스케줄러의 secret 저장소에 등록합니다. 자세한 요청 형식은 [External Scheduler](EXTERNAL_SCHEDULER.md)를 봅니다.

### 필수

| Secret | 필요한 작업 | 값 형식 |
|---|---|---|
| `NOTION_TOKEN` | 미팅 복사, team issue 리마인더 | `ntn_...` |
| `OPS_SLACK_BOT_TOKEN` | team issue 리마인더 | `xoxb-...` |
| `FLEX_SLACK_BOT_TOKEN` | Flex 리액션 리마인더 | `xoxb-...` |
| `INVOICE_SLACK_BOT_TOKEN` | 인보이스 요청, 인보이스 첨부파일 보관 | `xoxb-...` |
| `TEAM_SLACK_BOT_TOKEN` | team meeting 알림 | `xoxb-...` |
| `SLACK_USER_TOKEN` | Slack 미사용 채널 조회/아카이브 | `xoxp-...` |
| `SLACK_BOT_TOKEN` | Slack 미사용 채널 공지 | `xoxb-...` |
| `SLACK_USER_MAP_JSON` | team issue 리마인더 | JSON object |
| `INVOICE_REQUEST_TARGETS_JSON` | 인보이스 요청 | JSON array 또는 `{ "targets": [...] }` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 인보이스 첨부파일 보관 | service account key JSON 전체 |
| `GOOGLE_DRIVE_INVOICE_FOLDER_ID` | 인보이스 첨부파일 보관 | Google Drive folder ID |

### 선택

| Secret | 용도 |
|---|---|
| `DUE_REMINDER_FAILURE_WEBHOOK_URL` | team issue 리마인더 실패 알림 |
| `FLEX_FAILURE_WEBHOOK_URL` | Flex 리마인더 실패 알림 |
| `INVOICE_FAILURE_WEBHOOK_URL` | 인보이스 요청/첨부파일 보관 실패 알림 |
| `HOLIDAY_FAILURE_WEBHOOK_URL` | 한국 공휴일 fallback 감사 실패 알림 |
| `SLACK_FAILURE_WEBHOOK_URL` | job별 webhook이 없을 때 쓰는 공통 실패 알림 |

Failure webhook은 자동화 실패 전용 incoming webhook으로 분리하는 것을 권장합니다.

## GitHub Actions Variables

토큰이 아닌 데이터베이스 ID, source ID, Slack channel ID는 `Settings > Secrets and variables > Actions > Variables`에 등록합니다.

Operations meeting copy를 실행하려면 다음 두 설정이 반드시 필요합니다.

| GitHub 설정 | 종류 | 값 |
|---|---|---|
| `NOTION_TOKEN` | Repository secret | Meeting Notes 데이터베이스에 연결된 Notion integration token |
| `OPERATIONS_MEETINGS_DATABASE_ID` | Repository variable | Operations 회의 문서가 들어 있는 Meeting Notes 데이터베이스 ID |

CLI로 등록할 때는 다음 명령을 사용합니다. Secret 값은 명령 기록에 남기지 않도록 대화형 입력을 사용합니다.

```bash
gh secret set NOTION_TOKEN --repo Namyujeong/notion-slack-automation
gh variable set OPERATIONS_MEETINGS_DATABASE_ID \
  --repo Namyujeong/notion-slack-automation \
  --body "<database-id>"
```

등록 후 `Notion Operations meeting copy`를 먼저 `dry-run`으로 수동 실행해 integration 권한과 데이터베이스 ID를 확인합니다.

운영팀 주간미팅 복사에는 다음 설정이 필요합니다.

| GitHub 설정 | 종류 | 값 |
|---|---|---|
| `NOTION_TOKEN` | Repository secret | Operations 페이지와 Meetings 데이터베이스에 연결된 Notion integration token |
| `WEEKLY_MEETINGS_DATABASE_ID` | Repository variable | `운영팀 주간미팅` 문서가 들어 있는 Meetings 데이터베이스 ID |
| `OPERATIONS_WEEKLY_AGENDA_URL` | Repository variable | 새 회의록에 linked view로 삽입할 Operations 중앙 `아젠다` 데이터베이스 URL |

정기 실행은 월요일 10:00 KST이며, 수동 검증 시 `days_ahead=7`을 사용하면 다음 주 문서를 대상으로 dry-run할 수 있습니다.

Flex 휴가/결재 리마인더에는 다음 설정이 필요합니다.

| GitHub 설정 | 종류 | 값 |
|---|---|---|
| `FLEX_SLACK_BOT_TOKEN` | Repository secret | `chat:write`, 채널 기록, `reactions:read`, `users:read` 권한이 있는 Bot token |
| `FLEX_SLACK_CHANNEL_ID` | Repository variable | 원본과 스레드 리마인드를 보낼 Slack 채널 ID |
| `FLEX_MESSAGE_MARKER` | Repository variable | 원본 식별 문구. 기본값은 `[Flex 승인 리마인드]` |
| `FLEX_TARGET_USER_IDS` | Repository variable | 11시 원본에서 멘션할 리드 Slack user ID 목록 |

`FLEX_TARGET_USER_IDS`는 쉼표로 구분합니다. 삭제·비활성·봇 계정은 `users.info` 결과에 따라 자동 제외됩니다.

## JSON Secret 형식

### `SLACK_USER_MAP_JSON`

Notion 사용자 이름, Notion user ID, 이메일 등 코드가 매칭할 수 있는 key를 Slack user ID로 매핑합니다.

```json
{
  "홍길동": "U0123456789",
  "notion-user-id": "U0987654321",
  "person@example.com": "U0246813579"
}
```

### `INVOICE_REQUEST_TARGETS_JSON`

```json
{
  "targets": [
    {
      "name": "Kevin",
      "slackUserId": "U0123456789",
      "services": ["Example SaaS", "Example Cloud"],
      "active": true
    }
  ]
}
```

비활성 담당자는 `active: false`로 둡니다. 삭제하지 않으면 과거 state나 운영 히스토리를 볼 때 담당자 맥락을 유지할 수 있습니다.

## 로컬 `.env`

`.env.example`을 필요한 파일로 복사해서 사용합니다.

```bash
cp .env.example .env.notion.local
cp .env.example .env.slack.local
cp .env.example .env.flex.local
cp .env.example .env.invoice.local
cp .env.example .env.google.local
```

권장 분리:

| 파일 | 용도 |
|---|---|
| `.env.notion.local` | Notion 토큰과 미팅 복사 설정 |
| `.env.slack.local` | team issue 리마인더 Slack 설정 |
| `.env.flex.local` | Flex 리마인더 Slack 설정 |
| `.env.invoice.local` | 인보이스 요청/아카이브 Slack 설정 |
| `.env.channel-cleanup.local` | Slack 미사용 채널 정리 설정 |
| `.env.google.local` | Google Drive service account 설정 |

Google service account key는 `.google-service-account.local.json`처럼 별도 파일로 보관합니다. 이 파일은 `.gitignore` 대상입니다.

## Notion 권한

Notion integration이 아래 대상에 접근할 수 있어야 합니다.

| 작업 | 필요한 접근 |
|---|---|
| 운영팀 주간미팅 문서 복사 | Operations 페이지의 Meetings 데이터베이스, 복사 대상 문서, 중앙 `아젠다` 데이터베이스 |
| Operations 문서 복사 | Meeting Notes 데이터베이스와 Operations 문서 |
| Team Weekly 회의록 복사 | Meeting Notes 데이터베이스와 `Team Weekly` 문서 |
| team issue 리마인더 | Issue Tracker 하위 team issue tracker |

접근 문제가 나면 Notion 페이지 오른쪽 상단 `...` 메뉴에서 integration이 연결되어 있는지 확인합니다. 상위 페이지만 공유되어 있고 실제 데이터베이스 source가 누락된 경우가 있으므로, 데이터베이스 자체의 연결 상태도 확인합니다.

## Meeting Copy 옵션

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MEETING_CHILD_DATABASE_COPY_MODE` | `copy_non_done` | child database 처리 방식. `copy_non_done`은 Done checkbox가 켜진 row만 제외하고 복사합니다. `schema_only`는 DB 스키마만 만들고 row는 복사하지 않습니다. `skip`은 child DB를 만들지 않습니다. |
| `MEETING_CHILD_DATABASE_SKIP_TITLES` | 빈 값 | 특정 child database title은 복사하지 않습니다. 쉼표로 구분합니다. 예: `Decision,Tracking` |
| `MEETING_CHILD_DATABASE_REFERENCE_URL` | 빈 값 | child database를 skip할 때 대신 삽입할 중앙 DB/상위 문서 URL입니다. |
| `MEETING_CHILD_DATABASE_REFERENCE_TEXT` | `중앙 일정 DB` | 중앙 DB 링크에 표시할 텍스트입니다. |
| `MEETING_CHILD_DATABASE_REFERENCE_JSON` | 빈 값 | child database title별 중앙 DB 링크 매핑입니다. 예: `{"Tracking":{"url":"https://...","text":"Operations Tracking"}}` |
| `MEETING_CHILD_DATABASE_REFERENCE_RENDER` | `paragraph` | `linked_view`이면 Notion Views API로 중앙 DB linked database view를 생성합니다. 실패하면 문단 링크로 fallback합니다. |
| `MEETING_CHILD_DATABASE_REFERENCE_VIEW_TYPE` | `table` | linked database view 생성 시 사용할 view 타입입니다. |
| `MEETING_CHILD_DATABASE_REFERENCE_APPEND_IF_MISSING` | `0` | `1`이면 원본에 skip 대상 child DB가 없어도 중앙 DB reference를 삽입합니다. |
| `MEETING_CHILD_DATABASE_REFERENCE_MISSING_TITLE` | `MEETING_CHILD_DATABASE_REFERENCE_TEXT` | missing reference를 삽입할 때 사용할 섹션/view 이름입니다. |
| `MEETING_CHILD_DATABASE_WRAP_CELLS` | `1` | child database를 새로 복제하거나 linked table view를 만들 때 cell wrap을 켭니다. `0`이면 비활성화합니다. |
| `OPERATIONS_WEEKLY_AGENDA_URL` | 빈 값 | 운영팀 주간미팅 아젠다 중앙 DB URL입니다. GitHub 운영 시 repository variable로 등록합니다. |
| `TEAM_SHARED_SCHEDULE_URL` | 빈 값 | Team schedule/time-off 중앙 DB URL입니다. 필요한 경우 repository variable로 등록합니다. |

GitHub Actions에서는 위 URL 값들을 secret이 아니라 repository variable로 등록해도 됩니다. 경로는 `Settings > Secrets and variables > Actions > Variables`입니다.

현재 기본 job 설정은 다음과 같습니다.

| 작업 | child database row 처리 |
|---|---|
| 운영팀 주간미팅 문서 복사 | `아젠다` child DB는 복사하지 않고 Operations 중앙 아젠다 DB를 table linked database view로 삽입 |
| Operations 문서 복사 | `Decision`, `Tracking` child DB는 기존 동작대로 복사 |
| Team Weekly 회의록 복사 | child DB는 복사하지 않고 `TEAM_SHARED_SCHEDULE_URL`을 calendar linked database view로 삽입 |

Team Weekly 회의록 복사는 기본값으로 `MEETING_CHILD_DATABASE_REFERENCE_RENDER=linked_view`, `MEETING_CHILD_DATABASE_REFERENCE_VIEW_TYPE=calendar`, `MEETING_CHILD_DATABASE_REFERENCE_APPEND_IF_MISSING=1`, `MEETING_CHILD_DATABASE_REFERENCE_MISSING_TITLE=휴가 공유`를 사용합니다. Notion Views API 호출이 실패하면 자동으로 중앙 DB 링크 문단을 삽입해 회의록 생성 자체는 실패하지 않게 합니다.

## Slack 앱 권한

### team issue 리마인더

- `chat:write`
- 대상 채널 초대

### Team Weekly 회의록 알림

- `chat:write`
- `chat:write.public` 또는 `#team` 채널 초대
- `@team` usergroup mention 권한

### Flex 리액션 리마인더

- `channels:history` 또는 private channel이면 `groups:history`
- `reactions:read`
- `chat:write`
- `users:read` (`FLEX_FILTER_INACTIVE_USERS=1`일 때 active user 자동 필터링)
- usergroup 확장을 켜는 경우 `usergroups:read`
- 대상 채널 초대

### 인보이스 요청/첨부파일 보관

- `chat:write`
- `channels:history` 또는 private channel이면 `groups:history`
- `files:read`
- 대상 채널 초대

### Slack 미사용 채널 정리

User OAuth Token:

- `channels:read`
- `channels:history`
- `channels:write`
- `chat:write`

Bot Token:

- `chat:write`
- `chat:write.public`

아카이브는 User token의 `channels:write`로 수행한다. Bot token은 공지 게시용이며, `chat:write.public`이 있어야 봇이 멤버가 아닌 공개 채널에도 공지할 수 있다.

## Google Drive 권한

인보이스 Drive 루트 폴더를 service account의 `client_email`에 편집자 권한으로 공유합니다.

필요한 secret:

| Secret | 설명 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | service account key JSON 전체 |
| `GOOGLE_DRIVE_INVOICE_FOLDER_ID` | Drive 루트 폴더 URL의 `/folders/` 뒤 ID |

기본 폴더 구조:

```text
GOOGLE_DRIVE_INVOICE_FOLDER_ID/
  FY2026/
    2026-05/
      _status_2026-05.md
      ...
```

## GitHub Actions 권한

Slack/Invoice 작업은 state 파일을 커밋합니다.

Repository 설정에서 아래 값을 확인합니다.

```text
Settings > Actions > General > Workflow permissions > Read and write permissions
```

이 값이 `Read repository contents permission`이면 state 커밋 단계에서 실패합니다.
