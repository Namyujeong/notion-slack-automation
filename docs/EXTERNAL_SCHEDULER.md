# External Scheduler

GitHub Actions `schedule` 이벤트는 GitHub 내부 스케줄러 부하에 따라 지연되거나 생성되지 않을 수 있습니다. Slack 메시지 발송처럼 정시성이 중요한 작업은 외부 스케줄러가 GitHub REST API의 `workflow_dispatch`를 호출하는 방식으로 실행합니다.

## 운영 원칙

- 외부 스케줄러는 GitHub API에 `workflow_dispatch` 요청만 보냅니다.
- 실제 Notion/Slack/Google 처리는 기존 GitHub Actions workflow가 수행합니다.
- 토큰은 외부 스케줄러의 secret 저장소에만 보관하고 저장소에는 커밋하지 않습니다.
- `workflow_dispatch` 호출은 `mode=apply`를 명시합니다.
- 실패 시 외부 스케줄러 자체의 retry와 alert를 사용합니다.

## GitHub Token

권장 방식은 fine-grained personal access token입니다.

필요 권한:

- Repository access: `OWNER/notion-slack-automation` only
- Repository permissions: `Actions` read/write

classic PAT를 써야 한다면 private repository dispatch를 위해 `repo` scope가 필요합니다.

## HTTP Request

공통 요청 형식:

```bash
curl -L \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_WORKFLOW_DISPATCH_TOKEN}" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/OWNER/notion-slack-automation/actions/workflows/slack-issue-reminder.yml/dispatches" \
  -d '{"ref":"main","inputs":{"mode":"apply"}}'
```

성공 응답은 2xx로 처리합니다. 현재 GitHub REST API는 workflow run ID와 URL을 포함한 성공 응답을 반환할 수 있습니다.

## Primary External Schedule

현재 외부 스케줄러로 전환한 작업:

| 작업 | Workflow | Timezone | Schedule | Payload |
|---|---|---|---|---|
| Team Weekly 회의록 복사/알림 | `notion-team-weekly-meeting.yml` | `Asia/Seoul` | 월 10:00 | `{"ref":"main","inputs":{"mode":"apply"}}` |
| team issue Slack 리마인더 | `slack-issue-reminder.yml` | `Asia/Seoul` | 월-금 10:00 | `{"ref":"main","inputs":{"mode":"apply"}}` |
| Flex 휴가/결재 리액션 리마인더 | `slack-flex-reaction-reminder.yml` | `Asia/Seoul` | 월 15:00/18:00 | `{"ref":"main","inputs":{"mode":"apply"}}` |
| 월별 인보이스 요청/리마인더 | `slack-invoice-request.yml` | `Asia/Seoul` | 월-금 10:00/15:00/18:00 | `{"ref":"main","inputs":{"mode":"apply"}}` |
| 인보이스 첨부파일 Drive 보관 | `slack-invoice-attachment-archive.yml` | `Asia/Seoul` | 월-금 18:10 | `{"ref":"main","inputs":{"mode":"apply"}}` |
| Slack 미사용 채널 정리 | `slack-channel-cleanup.yml` | `Asia/Seoul` | 매월 1일 14:00 | `{"ref":"main","inputs":{"mode":"apply"}}` |

외부 스케줄러가 cron 표현식만 받는다면 `Asia/Seoul` timezone을 명시하고 아래 값을 사용합니다.

| Workflow | Asia/Seoul cron |
|---|---:|
| `notion-team-weekly-meeting.yml` | `0 10 * * 1` |
| `slack-issue-reminder.yml` | `0 10 * * 1-5` |
| `slack-flex-reaction-reminder.yml` | `0 15,18 * * 1` |
| `slack-invoice-request.yml` | `0 10,15,18 * * 1-5` |
| `slack-invoice-attachment-archive.yml` | `10 18 * * 1-5` |
| `slack-channel-cleanup.yml` | `0 14 1 * *` |

Flex의 `slack-flex-reaction-reminder.yml`는 새 원본 메시지를 만들지 않고 기존 `[Flex 승인 리마인드]` 원본 스레드에만 답글을 남깁니다. Slack Workflow Builder 또는 다른 스케줄러에서 15:00/18:00에 새 원본 메시지를 보내는 작업이 있으면 중복 발송이므로 비활성화합니다.

UTC만 받는 스케줄러라면 아래 값을 사용합니다.

| Workflow | UTC cron |
|---|---:|
| `notion-team-weekly-meeting.yml` | `0 1 * * 1` |
| `slack-issue-reminder.yml` | `0 1 * * 1-5` |
| `slack-flex-reaction-reminder.yml` | `0 6,9 * * 1` |
| `slack-invoice-request.yml` | `0 1,6,9 * * 1-5` |
| `slack-invoice-attachment-archive.yml` | `10 9 * * 1-5` |
| `slack-channel-cleanup.yml` | `0 5 1 * *` |

## Recommended Settings

- HTTP method: `POST`
- Timeout: 30 seconds
- Retry: 2-3 attempts for 5xx/network timeout
- Do not retry automatically for 401/403/404; token or workflow ID 설정 문제를 먼저 확인합니다.
- Success condition: any 2xx response
- Failure alert: Slack 또는 email

## Verification

외부 스케줄러 설정 후 GitHub에서 run을 확인합니다.

```bash
gh run list \
  --repo OWNER/notion-slack-automation \
  --workflow slack-issue-reminder.yml \
  --limit 5
```

정상 호출이면 `EVENT`가 `workflow_dispatch`로 표시됩니다.

실제 실행 로그:

```bash
gh run view <RUN_ID> \
  --repo OWNER/notion-slack-automation \
  --log
```

team issue 리마인더의 정상 apply 로그는 `sentCount`, `skippedCount`, `failedCount`를 출력합니다.

## Other Workflows

다른 workflow도 동일한 방식으로 전환할 수 있습니다. `workflow_dispatch`에 `mode` 입력이 있는 workflow는 아래 body를 사용합니다.

```json
{"ref":"main","inputs":{"mode":"apply"}}
```

공휴일 fallback 감사 workflow는 값을 변경하지 않으므로 필요 시 아래처럼 호출합니다.

```json
{"ref":"main","inputs":{}}
```

| Workflow | KST schedule |
|---|---:|
| `notion-weekly-meeting.yml` | 월 10:00 |
| `notion-operations-meeting.yml` | 월 12:00 |
| `korean-holiday-fallback-audit.yml` | 매년 1월 2일 09:00 |
