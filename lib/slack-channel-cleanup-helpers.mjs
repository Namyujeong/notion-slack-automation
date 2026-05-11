export const DEFAULT_ALLOWLIST_EXACT = new Set([
  "general",
  "all-company",
  "announcements",
  "announcement",
  "announce",
  "company-announcements",
  "admin",
  "hr",
  "legal",
  "finance",
  "security",
]);

export const DEFAULT_ALLOWLIST_PREFIXES = [
  "all-",
  "announce-",
  "announcements-",
  "company-",
  "hr-",
  "legal-",
  "finance-",
  "security-",
];

export function splitCsv(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean);
}

export function unixTsToIso(ts) {
  if (!ts) return "";
  return new Date(Number(ts) * 1000).toISOString();
}

export function daysAgo(date, days) {
  return new Date(date.getTime() - Number(days) * 24 * 60 * 60 * 1000);
}

export function daysAfter(date, days) {
  return new Date(date.getTime() + Number(days) * 24 * 60 * 60 * 1000);
}

export function dateInSeoul(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function hourInSeoul(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value || "0");
}

export function isSharedChannel(channel) {
  return Boolean(
    channel?.is_shared
      || channel?.is_ext_shared
      || channel?.is_org_shared
      || channel?.is_pending_ext_shared,
  );
}

export function skipReason(channel, {
  allowlistExact = DEFAULT_ALLOWLIST_EXACT,
  allowlistPrefixes = DEFAULT_ALLOWLIST_PREFIXES,
  includeShared = false,
} = {}) {
  const name = String(channel?.name_normalized || channel?.name || "").toLowerCase();
  if (channel?.is_general) return "skip_general";
  if (channel?.is_archived) return "skip_already_archived";
  if (allowlistExact.has(name)) return "skip_allowlist_exact";
  if (allowlistPrefixes.some((prefix) => name.startsWith(prefix))) return "skip_allowlist_prefix";
  if (isSharedChannel(channel) && !includeShared) return "skip_shared_channel";
  return "";
}

export function candidateStatus({ latestAt, latestError, skip = "", cutoff }) {
  if (skip) return { candidate: false, status: skip, reason: skip };
  if (latestError) return { candidate: false, status: "skip_history_error", reason: latestError };
  if (latestAt && latestAt <= cutoff) {
    return {
      candidate: true,
      status: "candidate",
      reason: `inactive_since_${latestAt.toISOString().slice(0, 10)}`,
    };
  }
  return {
    candidate: false,
    status: "active",
    reason: `last_activity_after_cutoff_${latestAt ? latestAt.toISOString().slice(0, 10) : ""}`,
  };
}

export function defaultNotice({ inactiveDays, archiveAfterDate }) {
  return [
    "*채널 자동 아카이브 예정 안내*",
    `이 채널은 ${inactiveDays}일 이상 확인 가능한 활동이 없어 ${archiveAfterDate} 이후 자동 아카이브 후보에 포함됩니다.`,
    "- 채널을 계속 사용해야 한다면 예정일 전까지 이 채널에 새 메시지를 남겨주세요.",
    "- 스레드 답글은 자동 감지에서 누락될 수 있으니, 반드시 채널 본문에 새 메시지로 남겨주세요.",
    "- 아카이브 후에도 기존 메시지 기록은 보존되지만 새 메시지는 작성할 수 없습니다.",
  ].join("\n");
}
