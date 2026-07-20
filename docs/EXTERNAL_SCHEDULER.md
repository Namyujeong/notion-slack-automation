# External Scheduler Example

이 문서는 비공개 배포 저장소에서 사용할 수 있는 범용 예시입니다. 이 공개 저장소에는 dispatch 대상 운영 workflow가 없습니다.

정시성이 중요한 작업은 외부 스케줄러가 비공개 저장소의 `workflow_dispatch`를 호출하도록 구성할 수 있습니다.

```bash
curl -L \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_WORKFLOW_DISPATCH_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/OWNER/PRIVATE_REPOSITORY/actions/workflows/WORKFLOW_FILE/dispatches" \
  -d '{"ref":"main","inputs":{"mode":"dry-run"}}'
```

## 운영 원칙

- fine-grained token은 대상 비공개 저장소와 Actions write 권한으로 제한합니다.
- token은 스케줄러의 secret store에 보관합니다.
- 처음에는 `dry-run`으로 호출하고 검증 후 `apply`로 전환합니다.
- 같은 작업을 GitHub cron, 외부 스케줄러, 로컬 scheduler에 동시에 등록하지 않습니다.
- timezone, retry, timeout, 실패 알림을 명시합니다.
- 401/403/404는 자동 재시도보다 token·권한·workflow 경로를 먼저 확인합니다.
