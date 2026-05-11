export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
export const VALID_INVOICE_MODES = new Set(["auto", "request", "remind"]);

export function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function makeDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const { year, month, day } = parseDate(date);
  return makeDate(year, month, day + days);
}

export function dayOfWeek(date) {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekend(date) {
  const weekday = dayOfWeek(date);
  return weekday === 0 || weekday === 6;
}

export function monthKey(date) {
  return date.slice(0, 7);
}

export function previousMonthKey(dateOrMonth) {
  const [year, month] = dateOrMonth.slice(0, 7).split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return previous.toISOString().slice(0, 7);
}

export function monthLastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dateForMonthDay(yearMonth, day) {
  const [year, month] = yearMonth.split("-").map(Number);
  return makeDate(year, month, Math.min(day, monthLastDay(year, month)));
}

export async function firstBusinessDayOnOrAfter(date, { isBusinessDay }) {
  let cursor = date;
  for (let index = 0; index < 14; index += 1) {
    if (await isBusinessDay(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new Error(`Could not find a business day within 14 days after ${date}.`);
}

export async function addBusinessDays(date, businessDays, { isBusinessDay }) {
  let cursor = date;
  let remaining = businessDays;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (await isBusinessDay(cursor)) remaining -= 1;
  }
  return cursor;
}

export async function subtractBusinessDays(date, businessDays, { isBusinessDay }) {
  let cursor = date;
  let remaining = businessDays;
  while (remaining > 0) {
    cursor = addDays(cursor, -1);
    if (await isBusinessDay(cursor)) remaining -= 1;
  }
  return cursor;
}

export function weekdayLabel(date) {
  return WEEKDAY_LABELS[dayOfWeek(date)];
}

export function formatDeadline(date) {
  return `${date}(${weekdayLabel(date)}) 18:00 KST`;
}

export function formatPeriodLabel(period) {
  const [year, month] = period.split("-").map(Number);
  return `${year}년 ${month}월`;
}

export function quarterCatchupText(requestMonthKey) {
  const [year, month] = requestMonthKey.split("-").map(Number);
  if (![1, 4, 7, 10].includes(month)) return null;

  const quarter = month === 1 ? 4 : Math.floor((month - 2) / 3) + 1;
  const quarterYear = month === 1 ? year - 1 : year;
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return `이번 달은 분기 정산 월입니다. ${quarterYear}년 ${quarter}분기(${startMonth}~${endMonth}월) 누락분이 있으면 함께 올려주세요.`;
}

export function normalizeKey(value = "") {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function escapeSlackText(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function extractSlackUserId(value = "") {
  const trimmed = String(value).trim();
  const mentionMatch = trimmed.match(/^<@([UW][A-Z0-9]+)(?:\|[^>]+)?>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^[UW][A-Z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

export function targetMention(target) {
  return target.slackUserId ? `<@${target.slackUserId}>` : escapeSlackText(target.name);
}

export function normalizeService(service) {
  if (typeof service === "string") return service.trim();
  if (!service || typeof service !== "object") return "";

  const name = service.name || service.title || service.service || "";
  const note = service.note || service.description || "";
  const cadence = service.cadence ? ` (${service.cadence})` : "";
  return [name, note].filter(Boolean).join(" - ") + cadence;
}

export function normalizeTarget(rawTarget, index) {
  const source = typeof rawTarget === "string" ? { slackUserId: rawTarget } : rawTarget;
  if (!source || typeof source !== "object") throw new Error(`Invalid invoice target at index ${index}.`);
  if (source.active === false) return null;

  const slackUserId = extractSlackUserId(
    source.slackUserId
    || source.slack_user_id
    || source.userId
    || source.user_id
    || source.mention
    || "",
  );
  const name = String(source.name || source.displayName || source.display_name || slackUserId || `target-${index + 1}`).trim();
  const services = (source.services || source.items || source.expectedServices || [])
    .map(normalizeService)
    .filter(Boolean);
  const key = source.key || slackUserId || normalizeKey(name);

  if (!key) throw new Error(`Invoice target at index ${index} needs slackUserId, name, or key.`);
  return { key, slackUserId, name, services };
}

export function requestKey(period, target) {
  return `${period}:${target.key}`;
}

export function existingRequestResult({ state, key, force = false }) {
  const request = state?.requests?.[key];
  if (!request || force) return null;
  return { status: "skipped", reason: "already_sent", key, request };
}

export function existingReminderResult({ request, stage, force = false }) {
  const existingReminder = request?.reminders?.[stage];
  if (!existingReminder || force) return null;
  return { status: "skipped", reason: "already_reminded", key: request.key, stage };
}

export function reminderStageForRequest(request, {
  remindersEnabled = true,
  todayDate,
  currentHour,
  sameDayFirstReminderHour = 15,
  sameDaySecondReminderHour = 18,
  preDeadlineReminderHour = 10,
} = {}) {
  if (!remindersEnabled || !request.deadlineDate || request.status === "complete") return null;
  if (todayDate === request.deadlineDate && currentHour >= 15) return "deadline_day";
  if (todayDate === request.preDeadlineDate && currentHour >= preDeadlineReminderHour) return "pre_deadline";
  if (todayDate === request.requestDate) {
    if (currentHour >= sameDaySecondReminderHour) {
      return request.reminders?.same_day_first ? "same_day_second" : "same_day_first";
    }
    if (currentHour >= sameDayFirstReminderHour) return "same_day_first";
  }
  return null;
}

export async function buildInvoiceScheduleContext({
  todayDate,
  currentHour,
  mode = "auto",
  force = false,
  requestDay = 10,
  requestHour = 10,
  deadlineBusinessDays = 3,
  period = null,
  deadlineDate = null,
  isBusinessDay,
}) {
  const requestMonth = monthKey(todayDate);
  const scheduledRequestDate = await firstBusinessDayOnOrAfter(dateForMonthDay(requestMonth, requestDay), { isBusinessDay });
  const resolvedPeriod = period || previousMonthKey(requestMonth);
  const deadlineBaseDate = mode === "request" || force ? todayDate : scheduledRequestDate;
  const resolvedDeadlineDate = deadlineDate || await addBusinessDays(deadlineBaseDate, deadlineBusinessDays, { isBusinessDay });
  const preDeadlineDate = await subtractBusinessDays(resolvedDeadlineDate, 1, { isBusinessDay });
  const todayIsBusinessDay = await isBusinessDay(todayDate);
  const shouldSendRequests = mode !== "remind"
    && (
      force
      || (
        todayIsBusinessDay
        && (
          mode === "request"
          || (todayDate === scheduledRequestDate && currentHour >= requestHour)
        )
      )
    );

  return {
    requestMonth,
    period: resolvedPeriod,
    scheduledRequestDate,
    deadlineBaseDate,
    deadlineDate: resolvedDeadlineDate,
    preDeadlineDate,
    todayIsBusinessDay,
    shouldSendRequests,
  };
}
