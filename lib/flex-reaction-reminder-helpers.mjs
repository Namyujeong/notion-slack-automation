export const MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;
export const USERGROUP_RE = /<!subteam\^([A-Z0-9]+)(?:\|[^>]+)?>/g;

export function envBool(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

export function splitUserIds(raw = "") {
  return raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

export function filterExcludedUserIds(targets = [], excluded = []) {
  const excludedSet = new Set(excluded);
  const includedUserIds = [];
  const excludedUserIds = [];
  for (const userId of targets) {
    if (excludedSet.has(userId)) {
      excludedUserIds.push(userId);
    } else {
      includedUserIds.push(userId);
    }
  }
  return { includedUserIds, excludedUserIds };
}

export function messageKey(channelId, messageTs) {
  return `${channelId}:${messageTs}`;
}

export function sourceDateInSeoul(messageTs) {
  const timestampMs = Number(messageTs) * 1000;
  if (!Number.isFinite(timestampMs)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampMs));
}

export function splitCanonicalDailySourceMessages(messages = []) {
  const seenByDate = new Map();
  const canonicalMessages = [];
  const duplicateMessages = [];

  for (const message of [...messages].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    const sourceDate = sourceDateInSeoul(message.ts);
    if (!sourceDate) {
      canonicalMessages.push(message);
      continue;
    }

    const canonicalTs = seenByDate.get(sourceDate);
    if (canonicalTs) {
      duplicateMessages.push({ message, sourceDate, canonicalTs });
      continue;
    }

    seenByDate.set(sourceDate, message.ts);
    canonicalMessages.push(message);
  }

  return { canonicalMessages, duplicateMessages };
}

export function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

export function messageSearchText(message) {
  const parts = [];
  if (typeof message.text === "string") parts.push(message.text);
  if (message.blocks) parts.push(...collectStrings(message.blocks));
  if (message.attachments) parts.push(...collectStrings(message.attachments));
  return parts.join("\n");
}

export function extractMatches(regex, text) {
  const seen = new Set();
  const matches = [];
  for (const match of text.matchAll(regex)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      matches.push(match[1]);
    }
  }
  return matches;
}

export function extractUserMentions(message) {
  return extractMatches(MENTION_RE, messageSearchText(message));
}

export function extractUsergroupMentions(message) {
  return extractMatches(USERGROUP_RE, messageSearchText(message));
}

export function shouldSendReminder(stateEntry, nowMs, { reminderIntervalMinutes }) {
  if (!stateEntry.lastRemindedAtMs) return true;
  const elapsedMinutes = (nowMs - Number(stateEntry.lastRemindedAtMs)) / 60_000;
  return elapsedMinutes >= reminderIntervalMinutes;
}

export function inactiveSlackUserReason(user) {
  if (!user || typeof user !== "object") return "missing";
  if (user.deleted) return "deleted";
  if (user.is_bot) return "bot";
  if (user.is_app_user) return "app_user";
  return null;
}

export function isActiveSlackReminderTarget(user) {
  return inactiveSlackUserReason(user) === null;
}

export function buildReminderText(missingUserIds, reminderNumber, targetCount, reactedCount, {
  maxReminders,
  reactionName,
}) {
  const mentions = missingUserIds.map((userId) => `<@${userId}>`).join(" ");
  const progress = `현재 완료: ${reactedCount}/${targetCount}`;

  if (reminderNumber >= maxReminders) {
    return [
      `[최종 리마인드 ${reminderNumber}/${maxReminders}]`,
      mentions,
      `오늘 마지막 자동 리마인드입니다. Flex 휴가 및 결재 승인 확인 후 원본 메시지에 :${reactionName}: 리액션을 남겨주세요. 이후에는 추가 자동 알림이 발송되지 않습니다.`,
      progress,
    ].join("\n");
  }

  if (reminderNumber === 2) {
    return [
      `[리마인드 ${reminderNumber}/${maxReminders}]`,
      mentions,
      `아직 Flex 휴가 및 결재 승인 확인 리액션(:${reactionName}:)이 확인되지 않았습니다. 승인 누락이 없도록 Flex 확인 후 원본 메시지에 :${reactionName}: 리액션 부탁드립니다.`,
      progress,
    ].join("\n");
  }

  return [
    `[리마인드 ${reminderNumber}/${maxReminders}]`,
    mentions,
    `Flex 휴가 및 결재 승인 확인 리액션(:${reactionName}:)이 아직 확인되지 않았습니다. 확인 후 원본 메시지에 :${reactionName}: 리액션 부탁드립니다.`,
    progress,
  ].join("\n");
}
