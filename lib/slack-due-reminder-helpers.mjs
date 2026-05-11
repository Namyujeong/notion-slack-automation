export const DONE_STATUS_NAMES = new Set([
  "done",
  "완료",
  "complete",
  "completed",
  "closed",
  "resolved",
  "canceled",
  "cancelled",
  "취소",
]);

const CHECKBOX_DONE_PROPERTY_NAMES = new Set(["", "done", "완료", "done?", "complete", "completed"]);

export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function richTextPlain(richText = []) {
  return richText.map((item) => item.plain_text || item.text?.content || "").join("");
}

export function getTitle(page) {
  for (const prop of Object.values(page?.properties || {})) {
    if (prop.type === "title") {
      const title = richTextPlain(prop.title).trim();
      return title || "제목 없음";
    }
  }
  return "제목 없음";
}

export function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

export function getDueDate(page, propertyName) {
  const prop = page?.properties?.[propertyName];
  if (prop?.type !== "date") return null;
  return dateOnly(prop.date?.end || prop.date?.start);
}

export function isDueInReminderWindow(page, propertyName, {
  startDate = null,
  targetDate = null,
} = {}) {
  const dueDate = getDueDate(page, propertyName);
  if (!dueDate) return false;
  if (startDate && dueDate < startDate) return false;
  if (targetDate && dueDate > targetDate) return false;
  return true;
}

export function isDone(page, configuredDoneProperty = null) {
  for (const [name, prop] of Object.entries(page?.properties || {})) {
    const normalizedName = name.trim().toLowerCase();
    if (configuredDoneProperty && name !== configuredDoneProperty) continue;

    if (prop.type === "checkbox" && prop.checkbox && (configuredDoneProperty || CHECKBOX_DONE_PROPERTY_NAMES.has(normalizedName))) {
      return true;
    }
    if (prop.type === "status" && prop.status && DONE_STATUS_NAMES.has(prop.status.name.toLowerCase())) return true;
    if (prop.type === "select" && prop.select && DONE_STATUS_NAMES.has(prop.select.name.toLowerCase())) return true;
  }
  return false;
}

export function reminderKey(pageId, notionUserId, date) {
  return `${date}:${pageId}:${notionUserId}`;
}

export function dueDateLabel(dueDate, {
  todayDate = null,
  tomorrowDate = null,
} = {}) {
  if (!dueDate) return "`날짜 없음`";
  if (todayDate && dueDate < todayDate) return `\`${dueDate} 기한 지남\``;
  if (todayDate && dueDate === todayDate) return `\`${dueDate} 오늘 마감\``;
  if (tomorrowDate && dueDate === tomorrowDate) return `\`${dueDate} 내일 마감\``;
  return `\`${dueDate} 마감\``;
}

export function reminderWindowText({
  todayDate,
  targetDate,
  tomorrowDate = null,
} = {}) {
  if (targetDate === todayDate) return `오늘(${todayDate})까지`;
  if (targetDate === tomorrowDate) return `오늘(${todayDate}) 또는 내일(${targetDate})까지`;
  return `오늘(${todayDate})부터 ${targetDate}까지`;
}
