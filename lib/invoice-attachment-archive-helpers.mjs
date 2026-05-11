export function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function daysBetween(a, b) {
  return Math.floor((parseDate(a).getTime() - parseDate(b).getTime()) / 86_400_000);
}

export function sanitizeFileName(name = "file") {
  const sanitized = String(name)
    .normalize("NFKC")
    .replace(/[/:*?"<>|#%{}\\^~[\]`]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "file";
}

export function archiveFileName(request, file) {
  const prefix = [
    request.period,
    sanitizeFileName(request.targetName || request.targetKey || "unknown"),
    file.id,
  ].filter(Boolean).join("_");
  return sanitizeFileName(`${prefix}_${file.name || file.title || "invoice-file"}`);
}

export function slackFileUrl(file) {
  return file.url_private_download || file.url_private || null;
}

export function slackFileName(file) {
  return file.name || file.title || file.id || "invoice-file";
}

export function requestSortKey(request) {
  return `${request.period || ""}:${request.targetName || ""}:${request.key || ""}`;
}

export function shouldIncludeMessageFile(message, request, { onlyTargetUserFiles = true } = {}) {
  if (!onlyTargetUserFiles) return true;
  return Boolean(request.slackUserId && message.user === request.slackUserId);
}

export function collectThreadFiles(request, messages, archiveState, { onlyTargetUserFiles = true } = {}) {
  const files = [];
  for (const message of messages) {
    if (!shouldIncludeMessageFile(message, request, { onlyTargetUserFiles })) continue;
    for (const file of message.files || []) {
      if (!file.id || archiveState.files[file.id]) continue;
      if (!slackFileUrl(file)) continue;
      files.push({
        request,
        messageTs: message.ts,
        file,
      });
    }
  }
  return files;
}

export function fiscalYearFolderName(period, { todayDate } = {}) {
  return `FY${String(period || todayDate).slice(0, 4)}`;
}

export function folderSegmentValue(segment, request, { todayDate } = {}) {
  if (segment === "period") return request.period;
  if (segment === "target") return sanitizeFileName(request.targetName || request.targetKey || "unknown");
  if (["fiscal-year", "fiscalYear", "fy"].includes(segment)) return fiscalYearFolderName(request.period, { todayDate });
  return segment;
}

export function folderSegmentsForRequest(request, {
  folderLayout = "fiscal-year/period",
  todayDate = null,
} = {}) {
  return folderLayout
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => folderSegmentValue(segment, request, { todayDate }))
    .filter(Boolean);
}

export function periodFolderSegments(period, {
  folderLayout = "fiscal-year/period",
  todayDate = null,
} = {}) {
  const syntheticRequest = { period, targetName: null, targetKey: null };
  const segments = folderSegmentsForRequest(syntheticRequest, { folderLayout, todayDate });
  const targetIndex = folderLayout.split("/").map((segment) => segment.trim()).indexOf("target");
  return targetIndex >= 0 ? segments.slice(0, targetIndex) : segments;
}

export function requestStatusRows(requests, archiveState) {
  return requests.map((request) => {
    const uploadedFiles = Object.values(archiveState.files || {})
      .filter((entry) => entry.requestKey === request.key);
    return {
      targetName: request.targetName || request.targetKey || "unknown",
      period: request.period,
      services: request.services || [],
      uploadedCount: uploadedFiles.length,
      status: uploadedFiles.length ? "수집됨" : "대기",
    };
  });
}

export function buildStatusMarkdown(period, requests, archiveState, {
  nowIso = new Date().toISOString(),
} = {}) {
  const rows = requestStatusRows(requests.filter((request) => request.period === period), archiveState);
  const lines = [
    `# ${period} 인보이스 수집 현황`,
    "",
    "| 담당자 | 요청 서비스 | 업로드 파일 수 | 상태 |",
    "|---|---|---:|---|",
  ];
  for (const row of rows) {
    lines.push(`| ${row.targetName} | ${row.services.join(", ") || "-"} | ${row.uploadedCount} | ${row.status} |`);
  }
  lines.push("", `Updated: ${nowIso}`);
  return `${lines.join("\n")}\n`;
}
