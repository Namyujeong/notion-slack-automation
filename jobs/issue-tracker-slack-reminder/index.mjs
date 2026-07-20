#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_KOREA_HOLIDAY_CALENDAR_URL, getKoreanHoliday } from "../../lib/korean-holidays.mjs";
import * as dueReminderHelpers from "../../lib/slack-due-reminder-helpers.mjs";

const NOTION_DATA_SOURCE_VERSION = "2025-09-03";
const NOTION_DATABASE_VERSION = "2022-06-28";
const DEFAULT_ISSUE_SOURCE_ID = "";
const DEFAULT_STATE_FILE = ".slack-due-reminder-state.json";
const DONE_STATUS_NAMES = dueReminderHelpers.DONE_STATUS_NAMES;

const args = process.argv.slice(2);
const argv = new Set(args);

function argValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] || null;
}

async function loadEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadEnvFile(path.join(process.cwd(), ".env.notion.local"));
await loadEnvFile(path.join(process.cwd(), ".env.slack.local"));

const notionToken = process.env.NOTION_TOKEN;
const slackToken = process.env.SLACK_BOT_TOKEN;
const issueSourceId = process.env.ISSUE_SOURCE_ID
  || process.env.ISSUE_DATA_SOURCE_ID
  || process.env.ISSUE_DATABASE_ID
  || DEFAULT_ISSUE_SOURCE_ID;
const dueDateProperty = process.env.DUE_DATE_PROPERTY || null;
const assigneeProperty = process.env.ASSIGNEE_PROPERTY || null;
const doneProperty = process.env.DONE_PROPERTY || null;
const slackChannelId = process.env.SLACK_CHANNEL_ID || null;
const deliveryMode = process.env.SLACK_DELIVERY || "channel";
const stateFile = process.env.REMINDER_STATE_FILE || DEFAULT_STATE_FILE;
const skipKoreanHolidays = process.env.SLACK_REMINDER_SKIP_KR_HOLIDAYS !== "0";
const koreanHolidayCalendarUrl = process.env.KOREA_HOLIDAY_CALENDAR_URL || DEFAULT_KOREA_HOLIDAY_CALENDAR_URL;
const dryRun = argv.has("--dry-run") || !argv.has("--apply");
const force = argv.has("--force");
const todayDate = argValue("--today") || dateInSeoul(0);
const targetDate = argValue("--date") || dateInSeoul(Number(process.env.DAYS_AHEAD || "1"));
const tomorrowDate = addDays(todayDate, 1);
const lookbackDays = Number(process.env.LOOKBACK_DAYS || "30");
const startDate = argValue("--from-date") || dateInSeoul(-lookbackDays);
const notionUserCache = new Map();
let slackUserDirectory = null;

const holiday = skipKoreanHolidays
  ? await getKoreanHoliday(todayDate, { calendarUrl: koreanHolidayCalendarUrl })
  : { isHoliday: false, name: null, source: "disabled" };
if (holiday.isHoliday) {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "today_is_korean_holiday",
    todayDate,
    targetDate,
    holidayName: holiday.name,
    holidaySource: holiday.source,
    holidayWarning: holiday.warning,
  }, null, 2));
  process.exit(0);
}

if (!notionToken) throw new Error("NOTION_TOKEN is required.");

function dateInSeoul(daysAhead = 0) {
  const now = new Date();
  const shifted = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

function addDays(date, days) {
  return dueReminderHelpers.addDays(date, days);
}

function normalizeId(id = "") {
  return id.replace(/-/g, "");
}

function normalizeLookupKey(value = "") {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function lookupKeys(value = "") {
  const keys = new Set();
  const trimmed = value.trim();
  const normalized = normalizeLookupKey(trimmed);
  if (normalized) keys.add(normalized);

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const reversed = normalizeLookupKey([...parts].reverse().join(" "));
    if (reversed) keys.add(reversed);
  }

  return [...keys];
}

function richTextPlain(richText = []) {
  return dueReminderHelpers.richTextPlain(richText);
}

function parseNotionError(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function notion(pathname, options = {}, notionVersion = NOTION_DATABASE_VERSION) {
  const response = await fetch(`https://api.notion.com/v1${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    const details = parseNotionError(text);
    const error = new Error(`${response.status} ${response.statusText}: ${details.message || text}`);
    error.status = response.status;
    error.code = details.code;
    error.pathname = pathname;
    error.notionVersion = notionVersion;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

async function slack(method, body) {
  if (!slackToken) throw new Error("SLACK_BOT_TOKEN is required for --apply.");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

function isNotFound(error) {
  return error?.status === 404 || error?.code === "object_not_found";
}

async function getIssueSource() {
  const errors = [];

  try {
    const source = await notion(`/data_sources/${issueSourceId}`, { method: "GET" }, NOTION_DATA_SOURCE_VERSION);
    return {
      object: source,
      kind: "data_source",
      queryPath: `/data_sources/${issueSourceId}/query`,
      notionVersion: NOTION_DATA_SOURCE_VERSION,
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    errors.push(error);
  }

  try {
    const database = await notion(`/databases/${issueSourceId}`, { method: "GET" }, NOTION_DATABASE_VERSION);
    return {
      object: database,
      kind: "database",
      queryPath: `/databases/${issueSourceId}/query`,
      notionVersion: NOTION_DATABASE_VERSION,
    };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    errors.push(error);
  }

  const checked = errors
    .map((error) => `${error.pathname} (${error.notionVersion})`)
    .join(", ");
  throw new Error(
    `Could not access ISSUE_SOURCE_ID=${issueSourceId} as a Notion data source or legacy database. `
    + `Checked: ${checked}. Share the source database itself with the integration, or set ISSUE_SOURCE_ID to the actual data_source_id.`,
  );
}

async function queryIssueSource(source, body) {
  const results = [];
  let startCursor;
  do {
    const payload = { page_size: 100, ...body };
    if (startCursor) payload.start_cursor = startCursor;
    const data = await notion(source.queryPath, {
      method: "POST",
      body: JSON.stringify(payload),
    }, source.notionVersion);
    results.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);
  return results;
}

function sourceTitle(sourceObject) {
  if (sourceObject.object === "data_source") return sourceObject.name || richTextPlain(sourceObject.title);
  return richTextPlain(sourceObject.title);
}

function pickProperty(properties, configuredName, type, candidates) {
  if (configuredName && properties[configuredName]?.type === type) return configuredName;
  const loweredCandidates = candidates.map((candidate) => candidate.toLowerCase());
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === type && loweredCandidates.includes(name.toLowerCase())) return name;
  }
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === type) return name;
  }
  return null;
}

function pickDoneProperty(properties, configuredName) {
  if (configuredName && properties[configuredName]) return configuredName;
  const candidates = ["Status", "Done", "Done?", "상태", "완료"];
  const loweredCandidates = candidates.map((candidate) => candidate.toLowerCase());
  for (const [name, prop] of Object.entries(properties)) {
    if (["select", "status", "checkbox"].includes(prop.type) && loweredCandidates.includes(name.toLowerCase())) return name;
  }
  return null;
}

function doneExclusionFilters(properties, propertyName) {
  const prop = properties[propertyName];
  if (!prop) return [];

  if (prop.type === "checkbox") {
    return [{ property: propertyName, checkbox: { equals: false } }];
  }

  if (prop.type === "select" || prop.type === "status") {
    const filterType = prop.type;
    const options = prop[filterType]?.options || [];
    return options
      .filter((option) => DONE_STATUS_NAMES.has(option.name.toLowerCase()))
      .map((option) => ({ property: propertyName, [filterType]: { does_not_equal: option.name } }));
  }

  return [];
}

function getTitle(page) {
  return dueReminderHelpers.getTitle(page);
}

function getDueDate(page, propertyName) {
  return dueReminderHelpers.getDueDate(page, propertyName);
}

function isDueInReminderWindow(page, propertyName) {
  return dueReminderHelpers.isDueInReminderWindow(page, propertyName, { startDate, targetDate });
}

function getAssignees(page, propertyName) {
  const prop = page.properties?.[propertyName];
  return prop?.type === "people" ? prop.people || [] : [];
}

function isDone(page, configuredDoneProperty) {
  return dueReminderHelpers.isDone(page, configuredDoneProperty);
}

async function getNotionUser(userId) {
  if (notionUserCache.has(userId)) return notionUserCache.get(userId);
  try {
    const user = await notion(`/users/${userId}`, { method: "GET" });
    notionUserCache.set(userId, user);
    return user;
  } catch {
    notionUserCache.set(userId, null);
    return null;
  }
}

function parseSlackUserMap() {
  if (!process.env.SLACK_USER_MAP_JSON) return {};
  try {
    return JSON.parse(process.env.SLACK_USER_MAP_JSON);
  } catch (error) {
    throw new Error(`Invalid SLACK_USER_MAP_JSON: ${error.message}`);
  }
}

async function slackUserByEmail(email) {
  if (!email || !slackToken) return null;
  const params = new URLSearchParams({ email });
  const response = await fetch(`https://slack.com/api/users.lookupByEmail?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${slackToken}` },
  });
  const data = await response.json();
  if (!data.ok) return null;
  return data.user?.id || null;
}

async function fetchSlackUserDirectory() {
  if (slackUserDirectory) return slackUserDirectory;
  const directory = new Map();
  if (!slackToken) return directory;

  let cursor;
  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`https://slack.com/api/users.list?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${slackToken}` },
    });
    const data = await response.json();
    if (!data.ok) {
      slackUserDirectory = directory;
      return directory;
    }

    for (const member of data.members || []) {
      if (member.deleted || member.is_bot || member.id === "USLACKBOT") continue;
      const names = [
        member.name,
        member.real_name,
        member.profile?.display_name,
        member.profile?.real_name,
      ].filter(Boolean);
      for (const name of names) {
        for (const key of lookupKeys(name)) {
          if (!directory.has(key)) directory.set(key, member.id);
        }
      }
    }

    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);

  slackUserDirectory = directory;
  return directory;
}

async function slackUserByName(name) {
  if (!name || !slackToken) return null;
  const directory = await fetchSlackUserDirectory();
  for (const key of lookupKeys(name)) {
    const slackUserId = directory.get(key);
    if (slackUserId) return slackUserId;
  }
  return null;
}

async function resolveSlackUser(notionUser, userMap) {
  const candidates = [
    notionUser.id,
    normalizeId(notionUser.id),
    notionUser.name,
    notionUser.person?.email,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (userMap[candidate]) return userMap[candidate];
  }

  if (!slackToken && !Object.keys(userMap).length) return null;

  const fullUser = await getNotionUser(notionUser.id);
  const email = fullUser?.person?.email || notionUser.person?.email || null;
  if (email) {
    if (userMap[email]) return userMap[email];
    const slackId = await slackUserByEmail(email);
    if (slackId) return slackId;
  }

  return slackUserByName(fullUser?.name || notionUser.name);
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function saveState(state) {
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function reminderKey(pageId, notionUserId, date) {
  return dueReminderHelpers.reminderKey(pageId, notionUserId, date);
}

function pageUrl(page) {
  return page.url || `https://www.notion.so/${normalizeId(page.id)}`;
}

function escapeSlackText(text = "") {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function dueDateLabel(dueDate) {
  return dueReminderHelpers.dueDateLabel(dueDate, { todayDate, tomorrowDate });
}

function reminderWindowText() {
  return dueReminderHelpers.reminderWindowText({ todayDate, targetDate, tomorrowDate });
}

function groupRemindersByAssignee(reminders) {
  const groups = new Map();
  for (const reminder of reminders) {
    const key = reminder.slackUserId || reminder.notionUserId || reminder.assigneeName;
    if (!groups.has(key)) {
      groups.set(key, {
        mention: reminder.slackUserId ? `<@${reminder.slackUserId}>` : escapeSlackText(reminder.assigneeName),
        reminders: [],
      });
    }
    groups.get(key).reminders.push(reminder);
  }
  return [...groups.values()];
}

function buildChannelSummary(reminders) {
  const lines = [
    `:bell: *team issues Due date 리마인더*`,
    `최근 ${lookbackDays}일 내 기한이 지났거나 ${reminderWindowText()} 마무리해야 하는 이슈입니다.`,
    "",
  ];

  for (const group of groupRemindersByAssignee(reminders)) {
    lines.push(`${group.mention}`);
    for (const reminder of group.reminders) {
      lines.push(`• ${dueDateLabel(reminder.dueDate)} <${reminder.pageUrl}|${escapeSlackText(reminder.pageTitle)}>`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

async function sendChannelSummary(reminders) {
  if (deliveryMode !== "channel") {
    throw new Error("Only SLACK_DELIVERY=channel is supported for due reminders.");
  }
  if (!slackChannelId) throw new Error("SLACK_CHANNEL_ID is required.");
  if (!reminders.length) return null;
  return slack("chat.postMessage", {
    channel: slackChannelId,
    text: buildChannelSummary(reminders),
    unfurl_links: false,
  });
}

const issueSource = await getIssueSource();
const properties = issueSource.object.properties || {};
const resolvedDueDateProperty = pickProperty(properties, dueDateProperty, "date", ["Due date", "Due Date", "Due", "DueDate", "Deadline", "마감일", "기한", "날짜"]);
const resolvedAssigneeProperty = pickProperty(properties, assigneeProperty, "people", ["Assignee", "Asignee", "담당자", "담당", "Person", "사람"]);
const resolvedDoneProperty = pickDoneProperty(properties, doneProperty);

if (!resolvedDueDateProperty) throw new Error("Could not resolve Due date property. Set DUE_DATE_PROPERTY.");
if (!resolvedAssigneeProperty) throw new Error("Could not resolve Assignee property. Set ASSIGNEE_PROPERTY.");

const queryFilters = [
  { property: resolvedDueDateProperty, date: { on_or_before: targetDate } },
  ...doneExclusionFilters(properties, resolvedDoneProperty),
];
const candidatePages = await queryIssueSource(issueSource, {
  filter: { and: queryFilters },
  sorts: [{ property: resolvedDueDateProperty, direction: "ascending" }],
});
const pages = candidatePages
  .filter((page) => isDueInReminderWindow(page, resolvedDueDateProperty))
  .sort((a, b) => getDueDate(a, resolvedDueDateProperty).localeCompare(getDueDate(b, resolvedDueDateProperty)));
const openPages = pages.filter((page) => !isDone(page, resolvedDoneProperty));
const userMap = parseSlackUserMap();
const state = await loadState();
const reminders = [];

for (const page of openPages) {
  const assignees = getAssignees(page, resolvedAssigneeProperty);
  for (const assignee of assignees) {
    const key = reminderKey(page.id, assignee.id, targetDate);
    const slackUserId = await resolveSlackUser(assignee, userMap);
    reminders.push({
      key,
      pageId: page.id,
      pageTitle: getTitle(page),
      pageUrl: pageUrl(page),
      dueDate: getDueDate(page, resolvedDueDateProperty),
      assigneeName: assignee.name || "담당자 확인 필요",
      notionUserId: assignee.id,
      slackUserId,
      skippedAlreadySent: Boolean(state[key]) && !force,
    });
  }
}

if (dryRun) {
  console.log(JSON.stringify({
    status: "dry_run",
    sourceTitle: sourceTitle(issueSource.object),
    sourceKind: issueSource.kind,
    issueSourceId,
    todayDate,
    targetDate,
    startDate,
    lookbackDays,
    dueDateProperty: resolvedDueDateProperty,
    assigneeProperty: resolvedAssigneeProperty,
    doneProperty: resolvedDoneProperty,
    candidatePageCount: candidatePages.length,
    matchedPageCount: pages.length,
    openPageCount: openPages.length,
    reminderCount: reminders.length,
    pendingReminderCount: reminders.filter((reminder) => !reminder.skippedAlreadySent).length,
    channelSummaryPreview: buildChannelSummary(reminders.filter((reminder) => !reminder.skippedAlreadySent)),
    reminders,
  }, null, 2));
  process.exit(0);
}

const sent = [];
const skipped = [];
const failed = [];
const pending = [];

for (const reminder of reminders) {
  if (reminder.skippedAlreadySent) {
    skipped.push({ ...reminder, reason: "already_sent" });
  } else {
    pending.push(reminder);
  }
}

try {
  await sendChannelSummary(pending);
  for (const reminder of pending) {
    state[reminder.key] = { sentAt: new Date().toISOString(), targetDate, pageId: reminder.pageId, notionUserId: reminder.notionUserId };
    sent.push(reminder);
  }
} catch (error) {
  for (const reminder of pending) failed.push({ ...reminder, error: error.message });
}

if (sent.length) await saveState(state);

console.log(JSON.stringify({
  status: failed.length ? "completed_with_failures" : "completed",
  todayDate,
  targetDate,
  startDate,
  lookbackDays,
  sentCount: sent.length,
  skippedCount: skipped.length,
  failedCount: failed.length,
  sent,
  skipped,
  failed,
}, null, 2));

if (failed.length) process.exitCode = 1;
