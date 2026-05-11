#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_KOREA_HOLIDAY_CALENDAR_URL, getKoreanHoliday } from "../../lib/korean-holidays.mjs";
import * as invoiceHelpers from "../../lib/invoice-request-helpers.mjs";

const DEFAULT_INVOICE_CHANNEL_ID = "";
const DEFAULT_CONFIG_FILE = "invoice-request-targets.local.json";
const DEFAULT_STATE_FILE = ".slack-invoice-request-state.json";
const VALID_MODES = invoiceHelpers.VALID_INVOICE_MODES;

const args = process.argv.slice(2);
const argv = new Set(args);

function argValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] || null;
}

async function loadEnvFile(filePath, { override = false } = {}) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!override && process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadEnvFile(path.join(process.cwd(), ".env.slack.local"));
await loadEnvFile(path.join(process.cwd(), ".env.invoice.local"), { override: true });

const dryRun = argv.has("--dry-run") || !argv.has("--apply");
const force = argv.has("--force");
const todayDate = argValue("--today") || dateInSeoul();
const currentHour = Number(argValue("--hour") || hourInSeoul());
const mode = argValue("--mode") || process.env.INVOICE_MODE || "auto";

if (!VALID_MODES.has(mode)) throw new Error(`Invalid --mode=${mode}. Use auto, request, or remind.`);

const slackToken = process.env.SLACK_BOT_TOKEN;
const channelId = process.env.INVOICE_SLACK_CHANNEL_ID
  || process.env.SLACK_INVOICE_CHANNEL_ID
  || DEFAULT_INVOICE_CHANNEL_ID;
const configFile = process.env.INVOICE_REQUEST_TARGETS_FILE || DEFAULT_CONFIG_FILE;
const stateFile = process.env.INVOICE_STATE_FILE || DEFAULT_STATE_FILE;
const requestDay = Number(process.env.INVOICE_REQUEST_DAY || "10");
const requestHour = Number(process.env.INVOICE_REQUEST_HOUR || "10");
const sameDayFirstReminderHour = Number(process.env.INVOICE_SAME_DAY_FIRST_REMINDER_HOUR || "15");
const sameDaySecondReminderHour = Number(process.env.INVOICE_SAME_DAY_SECOND_REMINDER_HOUR || "18");
const preDeadlineReminderHour = Number(process.env.INVOICE_PRE_DEADLINE_REMINDER_HOUR || "10");
const deadlineBusinessDays = Number(process.env.INVOICE_DEADLINE_BUSINESS_DAYS || "3");
const skipKoreanHolidays = process.env.INVOICE_SKIP_KR_HOLIDAYS !== "0";
const includeQuarterCatchup = process.env.INVOICE_INCLUDE_QUARTER_CATCHUP !== "0";
const remindersEnabled = process.env.INVOICE_REMINDERS_ENABLED !== "0";
const dryRunCheckThreads = process.env.INVOICE_DRY_RUN_CHECK_THREADS === "1";
const completionReactionName = (process.env.INVOICE_COMPLETE_REACTION_NAME || "white_check_mark").replace(/^:|:$/g, "");
const koreanHolidayCalendarUrl = process.env.KOREA_HOLIDAY_CALENDAR_URL || DEFAULT_KOREA_HOLIDAY_CALENDAR_URL;
const holidayCache = new Map();
let botUserId = process.env.INVOICE_BOT_USER_ID || null;

if (!dryRun && !slackToken) throw new Error("SLACK_BOT_TOKEN is required for --apply.");

function dateInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function hourInSeoul() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function addDays(date, days) {
  return invoiceHelpers.addDays(date, days);
}

function isWeekend(date) {
  return invoiceHelpers.isWeekend(date);
}

function monthKey(date) {
  return invoiceHelpers.monthKey(date);
}

function previousMonthKey(dateOrMonth) {
  return invoiceHelpers.previousMonthKey(dateOrMonth);
}

function dateForMonthDay(yearMonth, day) {
  return invoiceHelpers.dateForMonthDay(yearMonth, day);
}

async function getHoliday(date) {
  if (!skipKoreanHolidays) return { isHoliday: false, name: null, source: "disabled" };
  if (!holidayCache.has(date)) {
    holidayCache.set(date, await getKoreanHoliday(date, { calendarUrl: koreanHolidayCalendarUrl }));
  }
  return holidayCache.get(date);
}

async function isBusinessDay(date) {
  if (isWeekend(date)) return false;
  const holiday = await getHoliday(date);
  return !holiday.isHoliday;
}

async function firstBusinessDayOnOrAfter(date) {
  return invoiceHelpers.firstBusinessDayOnOrAfter(date, { isBusinessDay });
}

async function addBusinessDays(date, businessDays) {
  return invoiceHelpers.addBusinessDays(date, businessDays, { isBusinessDay });
}

async function subtractBusinessDays(date, businessDays) {
  return invoiceHelpers.subtractBusinessDays(date, businessDays, { isBusinessDay });
}

function formatDeadline(date) {
  return invoiceHelpers.formatDeadline(date);
}

function formatPeriodLabel(period) {
  return invoiceHelpers.formatPeriodLabel(period);
}

function quarterCatchupText(requestMonthKey) {
  return invoiceHelpers.quarterCatchupText(requestMonthKey);
}

function escapeSlackText(text = "") {
  return invoiceHelpers.escapeSlackText(text);
}

function targetMention(target) {
  return invoiceHelpers.targetMention(target);
}

function normalizeTarget(rawTarget, index) {
  return invoiceHelpers.normalizeTarget(rawTarget, index);
}

async function readJsonFileIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadTargets() {
  let rawTargets = null;

  if (process.env.INVOICE_REQUEST_TARGETS_JSON) {
    rawTargets = JSON.parse(process.env.INVOICE_REQUEST_TARGETS_JSON);
  } else {
    rawTargets = await readJsonFileIfExists(path.resolve(process.cwd(), configFile));
    if (!rawTargets && configFile === DEFAULT_CONFIG_FILE) {
      rawTargets = await readJsonFileIfExists(path.resolve(process.cwd(), "invoice-request-targets.json"));
    }
  }

  if (rawTargets && !Array.isArray(rawTargets) && Array.isArray(rawTargets.targets)) rawTargets = rawTargets.targets;
  if (!rawTargets) return [];
  if (!Array.isArray(rawTargets)) throw new Error("Invoice request targets must be an array or an object with a targets array.");

  return rawTargets.map(normalizeTarget).filter(Boolean);
}

async function loadState() {
  try {
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    return { version: 1, requests: {}, ...state, requests: state.requests || {} };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, requests: {} };
    throw error;
  }
}

async function saveState(state) {
  const tmpPath = `${stateFile}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmpPath, stateFile);
}

async function slack(method, params = {}, { httpMethod = "POST" } = {}) {
  if (!slackToken) throw new Error("SLACK_BOT_TOKEN is required.");

  const url = new URL(`https://slack.com/api/${method}`);
  const options = {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
  };

  if (httpMethod === "GET") {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
  } else {
    options.body = JSON.stringify(params);
  }

  const response = await fetch(url, options);
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

async function getBotUserId() {
  if (botUserId) return botUserId;
  const data = await slack("auth.test", {}, { httpMethod: "GET" });
  botUserId = data.user_id;
  return botUserId;
}

async function postMessage(text, threadTs = null) {
  return slack("chat.postMessage", {
    channel: channelId,
    text,
    thread_ts: threadTs || undefined,
    unfurl_links: false,
    unfurl_media: false,
  });
}

async function threadReplies(parentTs) {
  const messages = [];
  let cursor = null;
  do {
    const data = await slack("conversations.replies", {
      channel: channelId,
      ts: parentTs,
      limit: 200,
      cursor,
    }, { httpMethod: "GET" });
    messages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);
  return messages;
}

function requestKey(period, target) {
  return invoiceHelpers.requestKey(period, target);
}

function defaultServiceLines() {
  return [
    "해당 월 중 본인이 결제/관리한 구독, SaaS, 클라우드, 도메인, 광고, 툴 비용 전체",
  ];
}

function serviceLines(target) {
  const services = target.services.length ? target.services : defaultServiceLines();
  return services.map((service) => `• ${escapeSlackText(service)}`).join("\n");
}

function buildParentText(target, periodLabel) {
  return `[${periodLabel} 인보이스 요청] ${targetMention(target)}`;
}

function buildRequestText(target, { period, requestMonth, deadlineDate }) {
  const periodLabel = formatPeriodLabel(period);
  const lines = [
    `${targetMention(target)} 님, ${periodLabel} 인보이스 전달 요청드립니다.`,
    "",
    "아래 항목에 해당하는 인보이스/영수증을 이 스레드에 업로드해 주세요.",
    "",
    serviceLines(target),
  ];

  const quarterText = includeQuarterCatchup ? quarterCatchupText(requestMonth) : null;
  if (quarterText) {
    lines.push("", quarterText);
  }

  lines.push(
    "",
    `기한: ${formatDeadline(deadlineDate)}`,
    "",
    "이미 전달 완료했거나 본인 담당 결제가 아니면 이 스레드에 알려주세요.",
  );

  return lines.join("\n");
}

function buildReminderText(request, stage) {
  const mention = request.slackUserId ? `<@${request.slackUserId}>` : escapeSlackText(request.targetName);
  const periodLabel = formatPeriodLabel(request.period);

  if (stage === "same_day_first" || stage === "same_day_second") {
    const stageLabel = stage === "same_day_second" ? "2차" : "1차";
    return [
      `[당일 ${stageLabel} 리마인드]`,
      `${mention} 님, 오늘 요청드린 ${periodLabel} 인보이스가 아직 이 스레드에서 확인되지 않았습니다.`,
      `가능하면 오늘 중 파일 업로드 또는 회신 부탁드립니다.`,
      `기한: ${formatDeadline(request.deadlineDate)}`,
    ].join("\n");
  }

  if (stage === "deadline_day") {
    return [
      `[마감일 리마인드]`,
      `${mention} 님, ${periodLabel} 인보이스 제출 기한이 오늘입니다.`,
      `아직 이 스레드에서 회신 또는 파일 업로드가 확인되지 않았습니다.`,
      `기한: ${formatDeadline(request.deadlineDate)}`,
    ].join("\n");
  }

  return [
    `[기한 전 리마인드]`,
    `${mention} 님, ${periodLabel} 인보이스 제출 기한이 다음 영업일입니다.`,
    `아직 이 스레드에서 회신 또는 파일 업로드가 확인되지 않았습니다.`,
    `기한: ${formatDeadline(request.deadlineDate)}`,
  ].join("\n");
}

function hasCompletionReaction(message) {
  return (message.reactions || []).some((reaction) => reaction.name === completionReactionName);
}

function isBotMessage(message, currentBotUserId) {
  return message.user === currentBotUserId || Boolean(message.bot_id);
}

function replyCountsAsResponse(message, currentBotUserId) {
  if (isBotMessage(message, currentBotUserId)) return false;
  if (message.files?.length) return true;
  return Boolean(String(message.text || "").trim());
}

async function completionStatus(request, currentBotUserId) {
  const replies = await threadReplies(request.parentTs);
  if (replies.some(hasCompletionReaction)) return { status: "complete", reason: "completion_reaction" };
  if (replies.some((message) => !isBotMessage(message, currentBotUserId) && message.files?.length)) {
    return { status: "complete", reason: "file_uploaded" };
  }
  if (replies.some((message) => message.ts !== request.parentTs && replyCountsAsResponse(message, currentBotUserId))) {
    return { status: "responded", reason: "thread_reply" };
  }
  return { status: "pending", reason: "no_response" };
}

function reminderStageForRequest(request) {
  return invoiceHelpers.reminderStageForRequest(request, {
    remindersEnabled,
    todayDate,
    currentHour,
    sameDayFirstReminderHour,
    sameDaySecondReminderHour,
    preDeadlineReminderHour,
  });
}

async function sendRequest(target, context, state) {
  const key = requestKey(context.period, target);
  const existing = invoiceHelpers.existingRequestResult({ state, key, force });
  if (existing) return existing;

  const parentText = buildParentText(target, formatPeriodLabel(context.period));
  const requestText = buildRequestText(target, context);

  if (dryRun) {
    return {
      status: "dry_run",
      key,
      target,
      parentText,
      threadText: requestText,
    };
  }

  const parent = await postMessage(parentText);
  const thread = await postMessage(requestText, parent.ts);
  const request = {
    key,
    period: context.period,
    targetKey: target.key,
    targetName: target.name,
    slackUserId: target.slackUserId,
    channelId,
    requestDate: todayDate,
    scheduledRequestDate: context.scheduledRequestDate,
    deadlineDate: context.deadlineDate,
    preDeadlineDate: context.preDeadlineDate,
    parentTs: parent.ts,
    detailTs: thread.ts,
    sentAt: new Date().toISOString(),
    services: target.services,
    reminders: {},
    status: "requested",
  };

  state.requests[key] = request;
  return { status: "sent", key, request };
}

async function sendReminder(request, stage, currentBotUserId) {
  const existingReminder = invoiceHelpers.existingReminderResult({ request, stage, force });
  if (existingReminder) return existingReminder;

  if (dryRun && !dryRunCheckThreads) {
    return { status: "dry_run", key: request.key, stage, text: buildReminderText(request, stage), completion: "not_checked_in_dry_run" };
  }

  if (!slackToken) {
    return { status: "skipped", reason: "missing_slack_token", key: request.key, stage };
  }

  const completion = await completionStatus(request, currentBotUserId);
  if (completion.status !== "pending") {
    request.status = completion.status;
    request.completedAt = new Date().toISOString();
    request.completionReason = completion.reason;
    return { status: "skipped", reason: completion.reason, key: request.key, stage };
  }

  const text = buildReminderText(request, stage);
  if (dryRun) {
    return { status: "dry_run", key: request.key, stage, text };
  }

  const message = await postMessage(text, request.parentTs);
  request.reminders = request.reminders || {};
  request.reminders[stage] = { sentAt: new Date().toISOString(), ts: message.ts };
  return { status: "sent", key: request.key, stage, ts: message.ts };
}

const requestMonth = monthKey(todayDate);
const scheduledRequestDate = await firstBusinessDayOnOrAfter(dateForMonthDay(requestMonth, requestDay));
const period = argValue("--period") || previousMonthKey(requestMonth);
const deadlineBaseDate = mode === "request" || force ? todayDate : scheduledRequestDate;
const deadlineDate = argValue("--deadline") || await addBusinessDays(deadlineBaseDate, deadlineBusinessDays);
const preDeadlineDate = await subtractBusinessDays(deadlineDate, 1);
const todayHoliday = await getHoliday(todayDate);
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
const state = await loadState();
const targets = await loadTargets();
const results = {
  status: "completed",
  dryRun,
  mode,
  todayDate,
  currentHour,
  channelId,
  requestMonth,
  period,
  scheduledRequestDate,
  deadlineBaseDate,
  deadlineDate,
  preDeadlineDate,
  todayIsBusinessDay,
  todayHoliday,
  targetCount: targets.length,
  requestResults: [],
  reminderResults: [],
};

if (!todayIsBusinessDay && !force) {
  results.status = "skipped";
  results.reason = isWeekend(todayDate) ? "today_is_weekend" : "today_is_korean_holiday";
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

if (shouldSendRequests && !targets.length) {
  results.requestResults.push({
    status: "skipped",
    reason: "no_targets_configured",
    configFile,
  });
} else if (shouldSendRequests) {
  for (const target of targets) {
    results.requestResults.push(await sendRequest(target, {
      period,
      requestMonth,
      scheduledRequestDate,
      deadlineDate,
      preDeadlineDate,
    }, state));
  }
} else {
  results.requestResults.push({
    status: "skipped",
    reason: mode === "remind" ? "remind_mode" : "not_scheduled_request_time",
  });
}

if (mode !== "request" && remindersEnabled) {
  const sentRequestKeys = new Set(
    results.requestResults
      .filter((result) => result.status === "sent")
      .map((result) => result.key),
  );
  const dueRequests = Object.values(state.requests)
    .filter((request) => request.channelId === channelId)
    .filter((request) => request.parentTs)
    .filter((request) => !sentRequestKeys.has(request.key))
    .map((request) => ({ ...request, reminders: request.reminders || {} }))
    .filter((request) => reminderStageForRequest(request));
  const shouldCheckThreads = !dryRun || dryRunCheckThreads;
  const currentBotUserId = dueRequests.length && slackToken && shouldCheckThreads ? await getBotUserId() : null;

  for (const request of dueRequests) {
    const stateRequest = state.requests[request.key] || request;
    const stage = reminderStageForRequest(request);
    results.reminderResults.push(await sendReminder(stateRequest, stage, currentBotUserId));
    state.requests[request.key] = stateRequest;
  }
}

if (!dryRun) await saveState(state);

const sentRequestCount = results.requestResults.filter((result) => result.status === "sent").length;
const sentReminderCount = results.reminderResults.filter((result) => result.status === "sent").length;
const dryRunActionCount = results.requestResults
  .concat(results.reminderResults)
  .filter((result) => result.status === "dry_run").length;

results.sentRequestCount = sentRequestCount;
results.sentReminderCount = sentReminderCount;
results.dryRunActionCount = dryRunActionCount;
results.status = dryRun
  ? "dry_run"
  : (sentRequestCount || sentReminderCount ? "completed" : results.status);

console.log(JSON.stringify(results, null, 2));
