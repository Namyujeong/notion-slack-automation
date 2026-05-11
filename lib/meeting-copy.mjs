#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_KOREA_HOLIDAY_CALENDAR_URL, getKoreanHoliday } from "./korean-holidays.mjs";
import * as meetingHelpers from "./meeting-copy-helpers.mjs";

const DEFAULT_MEETINGS_DATABASE_ID = "";
const DEFAULT_MEETING_TITLE_SUFFIX = "Weekly Meeting";
const NOTION_VERSION = "2022-06-28";
const NOTION_VIEWS_VERSION = "2026-03-11";
const TEMPERATURE_CHECK_HEADING = "온도 체크";
const CHECK_IN_SECTION_KEY = "checkin";

const argv = new Set(process.argv.slice(2));
const args = process.argv.slice(2);

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

const token = process.env.NOTION_TOKEN;
const meetingsDatabaseId = process.env.MEETINGS_DATABASE_ID || DEFAULT_MEETINGS_DATABASE_ID;
const titleSuffix = process.env.MEETING_TITLE_SUFFIX || DEFAULT_MEETING_TITLE_SUFFIX;
const titleContains = process.env.MEETING_TITLE_CONTAINS || titleSuffix;
const peoplePropertyName = process.env.MEETING_PEOPLE_PROPERTY || "Person";
const targetDaysAhead = Number(argValue("--days-ahead") || process.env.MEETING_TARGET_DAYS_AHEAD || "0");
const skipKoreanHolidays = process.env.MEETING_SKIP_KR_HOLIDAYS !== "0";
const koreanHolidayCalendarUrl = process.env.KOREA_HOLIDAY_CALENDAR_URL || DEFAULT_KOREA_HOLIDAY_CALENDAR_URL;
const dryRun = argv.has("--dry-run") || !argv.has("--apply");
const forceCreate = argv.has("--force") || process.env.MEETING_FORCE_CREATE === "1";
const targetDate = argValue("--date") || dateInSeoul(targetDaysAhead);
const { targetTitle } = meetingHelpers.buildMeetingTarget({ targetDate, titleSuffix });
const slackNotify = process.env.MEETING_SLACK_NOTIFY === "1";
const slackToken = process.env.MEETING_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
const slackChannelId = process.env.MEETING_SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID || "";
const slackMention = process.env.MEETING_SLACK_MENTION || "";
const childDatabaseCopyMode = process.env.MEETING_CHILD_DATABASE_COPY_MODE || process.env.MEETING_CHILD_DATABASE_ROW_MODE || "copy_non_done";
const childDatabaseSchemaOnlyTitles = meetingHelpers.csvList(process.env.MEETING_CHILD_DATABASE_SCHEMA_ONLY_TITLES);
const childDatabaseSkipTitles = meetingHelpers.csvList(process.env.MEETING_CHILD_DATABASE_SKIP_TITLES);
const childDatabaseReferenceUrl = process.env.MEETING_CHILD_DATABASE_REFERENCE_URL || "";
const childDatabaseReferenceText = process.env.MEETING_CHILD_DATABASE_REFERENCE_TEXT || "중앙 일정 DB";
const childDatabaseReferences = meetingHelpers.parseChildDatabaseReferences(process.env.MEETING_CHILD_DATABASE_REFERENCE_JSON || "");
const childDatabaseReferenceRender = (process.env.MEETING_CHILD_DATABASE_REFERENCE_RENDER || "paragraph").trim().toLowerCase();
const childDatabaseReferenceViewType = process.env.MEETING_CHILD_DATABASE_REFERENCE_VIEW_TYPE || "table";
const appendChildDatabaseReferenceIfMissing = process.env.MEETING_CHILD_DATABASE_REFERENCE_APPEND_IF_MISSING === "1";
const childDatabaseReferenceMissingTitle = process.env.MEETING_CHILD_DATABASE_REFERENCE_MISSING_TITLE || childDatabaseReferenceText;
const childDatabaseWrapCells = process.env.MEETING_CHILD_DATABASE_WRAP_CELLS !== "0";
const linkedDataSourceCache = new Map();
let sourceDateForReplacement = null;
let sourceTitleForReplacement = null;

if (!token) {
  throw new Error("NOTION_TOKEN is required. Set it in the environment or .env.notion.local.");
}
if (slackNotify && !dryRun) {
  if (!slackToken) throw new Error("SLACK_BOT_TOKEN or MEETING_SLACK_BOT_TOKEN is required when MEETING_SLACK_NOTIFY=1.");
  if (!slackChannelId) throw new Error("MEETING_SLACK_CHANNEL_ID or SLACK_CHANNEL_ID is required when MEETING_SLACK_NOTIFY=1.");
}

function dateInSeoul(daysAhead = 0) {
  return meetingHelpers.dateInTimeZone(daysAhead, { timeZone: "Asia/Seoul" });
}

async function notion(pathname, options = {}) {
  const { notionVersion = NOTION_VERSION, ...requestOptions } = options;
  const response = await fetch(`https://api.notion.com/v1${pathname}`, {
    ...requestOptions,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
      ...(requestOptions.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function slack(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error || response.statusText}`);
  }
  return data;
}

function buildSlackNotification(url) {
  return {
    channelId: slackChannelId || null,
    message: meetingHelpers.buildMeetingSlackMessage({
      mention: slackMention,
      url,
      targetDate,
    }),
  };
}

async function postSlackNotification(url) {
  const notification = buildSlackNotification(url);
  if (dryRun) return { status: "dry_run", ...notification };

  const data = await slack("chat.postMessage", {
    channel: slackChannelId,
    text: notification.message,
    unfurl_links: false,
    unfurl_media: false,
  });
  return {
    status: "sent",
    ...notification,
    ts: data.ts,
  };
}

function normalizeId(id) {
  return id.replace(/-/g, "");
}

function richTextPlain(richText = []) {
  return meetingHelpers.richTextPlain(richText);
}

function replaceSourceMeetingText(content = "") {
  return meetingHelpers.replaceMeetingText(content, {
    sourceTitle: sourceTitleForReplacement,
    sourceDate: sourceDateForReplacement,
    targetTitle,
    targetDate,
  });
}

function linkPreviewText(url = "", plainText = "") {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === "docs.google.com" && pathname.startsWith("/spreadsheets/")) return "Google Sheet";
    if (hostname.endsWith("google.com") || hostname === "drive.google.com") return "Google Drive";
    if (hostname.endsWith("slack.com")) return "Slack thread";
  } catch {
    // Fall through to the API-provided text.
  }
  return plainText || url;
}

function pageTitle(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === "title") return richTextPlain(prop.title);
  }
  return "";
}

function pageDate(page) {
  for (const prop of Object.values(page.properties || {})) {
    if (prop.type === "date") return prop.date?.start || "";
  }
  return "";
}

function personRefs(people = []) {
  return people.filter((person) => person.id).map((person) => ({ id: person.id }));
}

function getPeopleProperty(page, propertyName) {
  const prop = page.properties?.[propertyName];
  if (prop?.type !== "people") return [];
  return personRefs(prop.people);
}

function findPeoplePropertyName(page) {
  if (page.properties?.[peoplePropertyName]?.type === "people") return peoplePropertyName;
  if (page.properties?.["참석자"]?.type === "people") return "참석자";
  if (page.properties?.Person?.type === "people") return "Person";
  return null;
}

async function queryDatabase(databaseId, body) {
  const results = [];
  let startCursor;
  do {
    const payload = { page_size: 100, ...body };
    if (startCursor) payload.start_cursor = startCursor;
    const data = await notion(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    results.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);
  return results;
}

async function findExistingTarget() {
  const pages = await queryDatabase(meetingsDatabaseId, {
    filter: {
      and: [
        { property: "Date", date: { equals: targetDate } },
        { property: "Name", title: { equals: targetTitle } },
      ],
    },
    sorts: [{ property: "Date", direction: "descending" }],
  });
  return pages[0] || null;
}

async function findSourcePage() {
  const pages = await queryDatabase(meetingsDatabaseId, {
    filter: {
      and: [
        { property: "Date", date: { before: targetDate } },
        { property: "Name", title: { contains: titleContains } },
      ],
    },
    sorts: [{ property: "Date", direction: "descending" }],
  });
  return pages[0] || null;
}

async function listBlockChildren(blockId) {
  const results = [];
  let startCursor;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (startCursor) params.set("start_cursor", startCursor);
    const data = await notion(`/blocks/${blockId}/children?${params.toString()}`, {
      method: "GET",
    });
    results.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);
  return results;
}

function sanitizeAnnotations(annotations = {}) {
  return {
    bold: Boolean(annotations.bold),
    italic: Boolean(annotations.italic),
    strikethrough: Boolean(annotations.strikethrough),
    underline: Boolean(annotations.underline),
    code: Boolean(annotations.code),
    color: annotations.color || "default",
  };
}

function sanitizeRichTextItem(item) {
  const base = {
    type: item.type,
    annotations: sanitizeAnnotations(item.annotations),
  };
  if (item.type === "text") {
    return {
      ...base,
      text: {
        content: replaceSourceMeetingText(item.text?.content || item.plain_text || ""),
        link: item.text?.link ? { url: item.text.link.url } : null,
      },
    };
  }
  if (item.type === "mention") {
    const mention = item.mention || {};
    if (mention.type === "user") return { ...base, mention: { type: "user", user: { id: mention.user.id } } };
    if (mention.type === "page") return { ...base, mention: { type: "page", page: { id: mention.page.id } } };
    if (mention.type === "database") return { ...base, mention: { type: "database", database: { id: mention.database.id } } };
    if (mention.type === "date") {
      return {
        ...base,
        mention: {
          type: "date",
          date: {
            ...mention.date,
            start: mention.date?.start === sourceDateForReplacement ? targetDate : mention.date?.start,
            end: mention.date?.end === sourceDateForReplacement ? targetDate : mention.date?.end,
          },
        },
      };
    }
    if (mention.type === "link_preview") {
      const url = mention.link_preview?.url || item.href || item.plain_text || "";
      if (url) {
        return {
          type: "text",
          annotations: base.annotations,
          text: {
            content: linkPreviewText(url, item.plain_text),
            link: { url },
          },
        };
      }
      return { type: "text", text: { content: item.plain_text || "", link: null }, annotations: base.annotations };
    }
  }
  if (item.type === "equation") return { ...base, equation: { expression: item.equation?.expression || "" } };
  return { type: "text", text: { content: replaceSourceMeetingText(item.plain_text || ""), link: null }, annotations: base.annotations };
}

function sanitizeRichText(richText = []) {
  return richText.map(sanitizeRichTextItem).filter((item) => {
    if (item.type !== "text") return true;
    return item.text.content.length > 0 || item.text.link;
  });
}

function copyIcon(icon) {
  if (!icon) return undefined;
  if (icon.type === "emoji") return { type: "emoji", emoji: icon.emoji };
  if (icon.type === "external") return { type: "external", external: { url: icon.external.url } };
  return undefined;
}

function copyFile(file) {
  if (!file) return null;
  if (file.type === "external") return { type: "external", external: { url: file.external.url } };
  if (file.type === "file") return { type: "external", external: { url: file.file.url } };
  return null;
}

function blockToAppendPayload(block, options = {}) {
  const type = block.type;
  const value = block[type];
  if (!value || type === "child_database") return null;

  const richTextBlockTypes = new Set([
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "bulleted_list_item",
    "numbered_list_item",
    "to_do",
    "toggle",
    "quote",
    "callout",
  ]);

  if (richTextBlockTypes.has(type)) {
    const copied = {
      object: "block",
      type,
      [type]: {
        rich_text: sanitizeRichText(value.rich_text || []),
        color: value.color || "default",
      },
    };
    if (["heading_1", "heading_2", "heading_3"].includes(type)) {
      copied[type].is_toggleable = Boolean(value.is_toggleable);
    }
    if (type === "to_do") {
      copied[type].checked = options.resetToDoChecked ? false : Boolean(value.checked);
      if (options.resetToDoChecked && options.stats) options.stats.checkInTodoResetCount += 1;
    }
    if (type === "callout") {
      const icon = copyIcon(value.icon);
      if (icon) copied[type].icon = icon;
    }
    return copied;
  }

  if (type === "divider") return { object: "block", type: "divider", divider: {} };
  if (type === "child_page") {
    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: replaceSourceMeetingText(value.title || "Untitled") } }],
        color: "default",
      },
    };
  }
  if (type === "bookmark") return { object: "block", type: "bookmark", bookmark: { url: value.url, caption: sanitizeRichText(value.caption || []) } };
  if (type === "embed") return { object: "block", type: "embed", embed: { url: value.url, caption: sanitizeRichText(value.caption || []) } };
  if (type === "link_preview") return { object: "block", type: "bookmark", bookmark: { url: value.url, caption: [] } };
  if (type === "table") {
    return {
      object: "block",
      type: "table",
      table: {
        table_width: value.table_width,
        has_column_header: Boolean(value.has_column_header),
        has_row_header: Boolean(value.has_row_header),
      },
    };
  }
  if (type === "table_row") {
    return {
      object: "block",
      type: "table_row",
      table_row: {
        cells: (value.cells || []).map((cell) => sanitizeRichText(cell || [])),
      },
    };
  }
  if (type === "image") {
    const copiedFile = copyFile(value);
    if (!copiedFile) return null;
    return { object: "block", type: "image", image: { ...copiedFile, caption: sanitizeRichText(value.caption || []) } };
  }

  return null;
}

function scrubTemperatureCheckComments(blocks) {
  return meetingHelpers.scrubTemperatureCheckComments(blocks, { heading: TEMPERATURE_CHECK_HEADING });
}

function checkInCopyEntries(blocks) {
  return meetingHelpers.checkInCopyEntries(blocks, { section: CHECK_IN_SECTION_KEY });
}

async function countToDoBlocks(block) {
  let count = block.type === "to_do" ? 1 : 0;
  if (!block.has_children) return count;

  const children = await listBlockChildren(block.id);
  for (const child of children.filter((candidate) => candidate.type !== "child_database")) {
    count += await countToDoBlocks(child);
  }
  return count;
}

async function countCheckInTodoResets(blocks) {
  let count = 0;
  for (const entry of checkInCopyEntries(blocks)) {
    if (entry.resetToDoChecked) count += await countToDoBlocks(entry.block);
  }
  return count;
}

function blockEntrySource(entry) {
  return entry?.block || entry;
}

function blockEntryResetToDoChecked(entry, fallback = false) {
  return Boolean(entry?.resetToDoChecked || fallback);
}

async function syncedBlockChildren(block) {
  const sourceIds = [
    block.synced_block?.synced_from?.block_id,
    block.id,
  ].filter(Boolean);

  for (const sourceId of sourceIds) {
    const children = await listBlockChildren(sourceId);
    if (children.length) return children;
  }
  return [];
}

async function expandSyncedBlockEntries(sourceBlocks, options = {}) {
  const expanded = [];
  for (const entry of sourceBlocks) {
    const source = blockEntrySource(entry);
    const resetToDoChecked = blockEntryResetToDoChecked(entry, options.resetToDoChecked);
    if (source.type !== "synced_block") {
      expanded.push(entry);
      continue;
    }

    const children = await syncedBlockChildren(source);
    expanded.push(...await expandSyncedBlockEntries(children.map((block) => ({
      block,
      resetToDoChecked,
    })), options));
  }
  return expanded;
}

async function tableBlockToAppendPayload(block) {
  const payload = blockToAppendPayload(block);
  if (!payload || block.type !== "table") return payload;
  const rows = (await listBlockChildren(block.id))
    .filter((candidate) => candidate.type === "table_row")
    .map((row) => blockToAppendPayload(row))
    .filter(Boolean);
  if (!rows.length) return null;
  payload.table.children = rows;
  return payload;
}

async function appendBlocks(parentBlockId, sourceBlocks, options = {}) {
  const copyable = [];
  const expandedSourceBlocks = await expandSyncedBlockEntries(sourceBlocks, options);
  for (const [index, entry] of expandedSourceBlocks.entries()) {
    const source = blockEntrySource(entry);
    const resetToDoChecked = blockEntryResetToDoChecked(entry, options.resetToDoChecked);
    const payload = source.type === "table"
      ? await tableBlockToAppendPayload(source)
      : blockToAppendPayload(source, { resetToDoChecked, stats: options.stats });
    if (!payload) continue;
    copyable.push({
      source,
      index,
      resetToDoChecked,
      payload,
      childrenCopiedInline: source.type === "table",
    });
  }

  let copiedBlockCount = 0;
  for (let offset = 0; offset < copyable.length; offset += 100) {
    const batch = copyable.slice(offset, offset + 100);
    const appended = await notion(`/blocks/${parentBlockId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: batch.map((entry) => entry.payload) }),
    });

    for (let i = 0; i < appended.results.length; i += 1) {
      const entry = batch[i];
      const source = entry.source;
      const target = appended.results[i];
      if (source.has_children && !entry.childrenCopiedInline) {
        await copyNestedBlocks(source.id, target.id, { ...options, resetToDoChecked: entry.resetToDoChecked });
      }
    }
    copiedBlockCount += batch.length;
  }

  return { copiedBlockCount };
}

async function copyNestedBlocks(sourceBlockId, targetBlockId, options = {}) {
  const children = await listBlockChildren(sourceBlockId);
  await appendBlocks(targetBlockId, children.filter((block) => block.type !== "child_database"), options);
}

function propertySchema(prop, fallbackName) {
  switch (prop.type) {
    case "title":
      return { title: {} };
    case "rich_text":
      return { rich_text: {} };
    case "number":
      return { number: { format: prop.number?.format || "number" } };
    case "select":
      return { select: { options: (prop.select?.options || []).map((option) => ({ name: option.name, color: option.color || "default" })) } };
    case "multi_select":
      return { multi_select: { options: (prop.multi_select?.options || []).map((option) => ({ name: option.name, color: option.color || "default" })) } };
    case "date":
      return { date: {} };
    case "people":
      return { people: {} };
    case "files":
      return { files: {} };
    case "checkbox":
      return { checkbox: {} };
    case "url":
      return { url: {} };
    case "email":
      return { email: {} };
    case "phone_number":
      return { phone_number: {} };
    default:
      console.warn(`Skipping unsupported database property "${fallbackName}" (${prop.type})`);
      return null;
  }
}

function copyableDatabaseProperties(properties) {
  const output = {};
  const nameMap = {};
  for (const [name, prop] of Object.entries(properties)) {
    const targetName = name || "Done";
    const schema = propertySchema(prop, targetName);
    if (!schema) continue;
    output[targetName] = schema;
    nameMap[name] = targetName;
  }
  return { properties: output, nameMap };
}

function pagePropertyValue(prop) {
  switch (prop.type) {
    case "title":
      return { title: sanitizeRichText(prop.title || []) };
    case "rich_text":
      return { rich_text: sanitizeRichText(prop.rich_text || []) };
    case "number":
      return { number: prop.number };
    case "select":
      return prop.select ? { select: { name: prop.select.name } } : { select: null };
    case "multi_select":
      return { multi_select: (prop.multi_select || []).map((option) => ({ name: option.name })) };
    case "date":
      return { date: prop.date ? { start: prop.date.start, end: prop.date.end || null, time_zone: prop.date.time_zone || null } : null };
    case "people":
      return { people: personRefs(prop.people || []) };
    case "files":
      return { files: (prop.files || []).map(copyFile).filter(Boolean) };
    case "checkbox":
      return { checkbox: Boolean(prop.checkbox) };
    case "url":
      return { url: prop.url || null };
    case "email":
      return { email: prop.email || null };
    case "phone_number":
      return { phone_number: prop.phone_number || null };
    default:
      return null;
  }
}

function copyPageProperties(row, nameMap) {
  const output = {};
  for (const [name, prop] of Object.entries(row.properties || {})) {
    const targetName = nameMap[name];
    if (!targetName) continue;
    const value = pagePropertyValue(prop);
    if (!value) continue;
    output[targetName] = value;
  }
  return output;
}

function copyModeForChildDatabase(title) {
  return meetingHelpers.childDatabaseCopyMode({
    title,
    copyMode: childDatabaseCopyMode,
    schemaOnlyTitles: childDatabaseSchemaOnlyTitles,
    skipTitles: childDatabaseSkipTitles,
  });
}

function shouldCopyRowsForChildDatabase(title) {
  return copyModeForChildDatabase(title) === "copy_non_done";
}

function childDatabaseReferenceForTitle(title = "") {
  return meetingHelpers.childDatabaseReference({
    title,
    references: childDatabaseReferences,
    fallbackUrl: childDatabaseReferenceUrl,
    fallbackText: childDatabaseReferenceText,
  });
}

function childDatabaseReferencePayload(title = "") {
  const reference = childDatabaseReferenceForTitle(title);
  if (!reference) return null;
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content: reference.text,
            link: { url: reference.url },
          },
        },
      ],
      color: "default",
    },
  };
}

function blockLinkUrls(block) {
  if (block?.type === "bookmark") return [block.bookmark?.url].filter(Boolean);
  const value = block?.[block.type];
  const richText = value?.rich_text || [];
  return richText.map((item) => item.text?.link?.url || item.href).filter(Boolean);
}

function isEmptyParagraph(block) {
  return block?.type === "paragraph" && !richTextPlain(block.paragraph?.rich_text || []).trim();
}

function isStaleReferenceBlock(block, reference) {
  if (!block || !reference) return false;
  if (isEmptyParagraph(block)) return true;
  const urls = blockLinkUrls(block);
  if (urls.includes(reference.url)) return true;
  const text = richTextPlain(block[block.type]?.rich_text || []).trim();
  return Boolean(text && (text === reference.text || text.includes(reference.url)));
}

function stripStaleReferenceSections(entries = []) {
  if (!appendChildDatabaseReferenceIfMissing) return entries;
  const reference = childDatabaseReferenceForTitle(childDatabaseReferenceMissingTitle);
  if (!reference) return entries;

  const stripped = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const block = blockEntrySource(entry);
    const isMatchingHeading = meetingHelpers.isHeading(block)
      && meetingHelpers.sectionKey(meetingHelpers.blockPlainText(block)) === meetingHelpers.sectionKey(childDatabaseReferenceMissingTitle);
    if (!isMatchingHeading) {
      stripped.push(entry);
      continue;
    }

    const section = [entry];
    let nextIndex = index + 1;
    while (nextIndex < entries.length && !meetingHelpers.isHeading(blockEntrySource(entries[nextIndex]))) {
      section.push(entries[nextIndex]);
      nextIndex += 1;
    }

    const sectionBlocks = section.slice(1).map(blockEntrySource);
    const isOnlyStaleReference = sectionBlocks.length > 0
      && sectionBlocks.every((candidate) => isStaleReferenceBlock(candidate, reference));
    if (isOnlyStaleReference) {
      index = nextIndex - 1;
      continue;
    }

    stripped.push(...section);
    index = nextIndex - 1;
  }
  return stripped;
}

async function linkedDatabaseDataSourceId(url) {
  if (linkedDataSourceCache.has(url)) return linkedDataSourceCache.get(url);
  const databaseId = meetingHelpers.notionIdFromUrl(url);
  if (!databaseId) throw new Error(`Could not extract Notion database ID from ${url}.`);
  const database = await notion(`/databases/${databaseId}`, {
    method: "GET",
    notionVersion: NOTION_VIEWS_VERSION,
  });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`No data source found for linked database ${url}.`);
  linkedDataSourceCache.set(url, dataSourceId);
  return dataSourceId;
}

async function renameDatabase(databaseId, title = "") {
  if (!databaseId || !title) return;
  await notion(`/databases/${databaseId}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: [{ type: "text", text: { content: title } }],
    }),
  });
}

async function createLinkedDatabaseReferenceView(targetPageId, title = "") {
  const reference = meetingHelpers.childDatabaseReference({
    title,
    references: childDatabaseReferences,
    fallbackUrl: childDatabaseReferenceUrl,
    fallbackText: childDatabaseReferenceText,
  });
  if (!reference) return null;
  const dataSourceId = await linkedDatabaseDataSourceId(reference.url);
  const view = await notion("/views", {
    method: "POST",
    notionVersion: NOTION_VIEWS_VERSION,
    body: JSON.stringify({
      create_database: {
        parent: {
          type: "page_id",
          page_id: targetPageId,
        },
      },
      data_source_id: dataSourceId,
      name: title || reference.text || "Linked database",
      type: childDatabaseReferenceViewType,
      ...(childDatabaseReferenceViewType === "table" && childDatabaseWrapCells
        ? { configuration: meetingHelpers.tableViewWrapConfiguration({ wrapCells: true }) }
        : {}),
    }),
  });
  await renameDatabase(view.parent?.database_id, title || reference.text || "Linked database");
  return view;
}

async function listViews(params = {}) {
  const results = [];
  let startCursor;
  do {
    const searchParams = new URLSearchParams({ page_size: "100" });
    for (const [key, value] of Object.entries(params)) {
      if (value) searchParams.set(key, value);
    }
    if (startCursor) searchParams.set("start_cursor", startCursor);
    const data = await notion(`/views?${searchParams.toString()}`, {
      method: "GET",
      notionVersion: NOTION_VIEWS_VERSION,
    });
    results.push(...(data.results || []));
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);
  return results;
}

async function retrieveView(viewId) {
  return notion(`/views/${viewId}`, {
    method: "GET",
    notionVersion: NOTION_VIEWS_VERSION,
  });
}

async function enableTableViewCellWrap(databaseId) {
  if (!childDatabaseWrapCells) return null;
  try {
    const views = await listViews({ database_id: databaseId });
    for (const viewRef of views) {
      const view = await retrieveView(viewRef.id);
      if (view.type !== "table") continue;
      return await notion(`/views/${view.id}`, {
        method: "PATCH",
        notionVersion: NOTION_VIEWS_VERSION,
        body: JSON.stringify({
          configuration: meetingHelpers.tableViewWrapConfiguration({ wrapCells: true }),
        }),
      });
    }
  } catch (error) {
    console.warn(`Could not enable table cell wrap for copied database ${databaseId}: ${error.message}`);
  }
  return null;
}

async function appendBlockPayloads(parentBlockId, payloads = []) {
  let copiedBlockCount = 0;
  for (let offset = 0; offset < payloads.length; offset += 100) {
    const batch = payloads.slice(offset, offset + 100);
    await notion(`/blocks/${parentBlockId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: batch }),
    });
    copiedBlockCount += batch.length;
  }
  return { copiedBlockCount };
}

function childDatabaseReferenceReport({
  linkedView = null,
  linkedViewError = null,
  sourceId = null,
  sourceTitle = null,
  title = "",
  fallbackReferenceBlockCount = 0,
  referenceUrl = null,
  virtual = false,
} = {}) {
  return {
    id: linkedView?.parent?.database_id || null,
    viewId: linkedView?.id || null,
    sourceId: sourceId ? normalizeId(sourceId) : null,
    sourceTitle,
    title,
    mode: "skip",
    referenceRender: linkedView ? "linked_view" : "paragraph",
    linkedViewType: linkedView?.type || null,
    linkedViewError,
    sourceRowCount: null,
    rowCount: 0,
    copiedRowCount: 0,
    skippedDoneRowCount: 0,
    skippedSchemaOnlyRowCount: 0,
    skippedCopiedDatabaseCount: virtual ? 0 : 1,
    fallbackReferenceBlockCount,
    referenceUrl,
    virtual,
  };
}

async function appendChildDatabaseReferenceView(targetPageId, {
  sourceId = null,
  sourceTitle = null,
  title = "",
  virtual = false,
} = {}) {
  let copiedBlockCount = 0;
  if (virtual && title) {
    const result = await appendBlockPayloads(targetPageId, [{
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [{ type: "text", text: { content: title } }],
        color: "default",
        is_toggleable: false,
      },
    }]);
    copiedBlockCount += result.copiedBlockCount;
  }
  let referenceUrl = childDatabaseReferenceForTitle(title)?.url || null;
  let linkedView = null;
  let linkedViewError = null;
  let fallbackReferenceBlockCount = 0;
  if (childDatabaseReferenceRender === "linked_view" && referenceUrl) {
    try {
      linkedView = await createLinkedDatabaseReferenceView(targetPageId, title);
    } catch (error) {
      linkedViewError = error.message;
    }
  }
  if (!linkedView) {
    const reference = childDatabaseReferencePayload(title);
    if (reference) {
      const result = await appendBlockPayloads(targetPageId, [reference]);
      fallbackReferenceBlockCount = result.copiedBlockCount;
      copiedBlockCount += result.copiedBlockCount;
    }
  }
  return {
    copiedBlockCount,
    report: childDatabaseReferenceReport({
      linkedView,
      linkedViewError,
      sourceId,
      sourceTitle,
      title,
      fallbackReferenceBlockCount,
      referenceUrl,
      virtual,
    }),
  };
}

async function createCopiedChildDatabase(sourceDatabaseId, targetPageId) {
  const sourceDatabase = await notion(`/databases/${sourceDatabaseId}`, { method: "GET" });
  const title = richTextPlain(sourceDatabase.title) || "Untitled database";
  const { properties, nameMap } = copyableDatabaseProperties(sourceDatabase.properties || {});
  const mode = copyModeForChildDatabase(title);
  const copyRows = mode === "copy_non_done";

  const createdDatabase = await notion("/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: targetPageId },
      title: [{ type: "text", text: { content: title } }],
      is_inline: true,
      properties,
    }),
  });
  const wrappedTableView = await enableTableViewCellWrap(createdDatabase.id);

  const sourceRows = await queryDatabase(sourceDatabaseId, {});
  const rows = copyRows ? sourceRows.filter((row) => !isDoneChecked(row)) : [];
  const skippedDoneRowCount = copyRows ? sourceRows.length - rows.length : 0;
  const skippedSchemaOnlyRowCount = copyRows ? 0 : sourceRows.length;

  for (const row of rows) {
    const createdRow = await notion("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: createdDatabase.id },
        properties: copyPageProperties(row, nameMap),
      }),
    });
    const rowChildren = await listBlockChildren(row.id);
    if (rowChildren.length) await appendBlocks(createdRow.id, rowChildren.filter((block) => block.type !== "child_database"));
  }

  return {
    id: createdDatabase.id,
    title,
    mode,
    sourceRowCount: sourceRows.length,
    rowCount: rows.length,
    copiedRowCount: rows.length,
    wrappedTableViewId: wrappedTableView?.id || null,
    skippedDoneRowCount,
    skippedSchemaOnlyRowCount,
  };
}

function isDoneChecked(row) {
  return meetingHelpers.isDoneChecked(row);
}

async function copyPageContent(sourcePageId, targetPageId) {
  const children = await listBlockChildren(sourcePageId);
  const { blocks, stats } = scrubTemperatureCheckComments(children);
  const entries = stripStaleReferenceSections(checkInCopyEntries(blocks));
  let copiedBlockCount = 0;
  const copiedDatabases = [];
  let currentHeadingTitle = "";

  let pending = [];
  async function flushPending() {
    if (!pending.length) return;
    const result = await appendBlocks(targetPageId, pending, { stats });
    copiedBlockCount += result.copiedBlockCount;
    pending = [];
  }

  for (const entry of entries) {
    const block = entry.block;
    if (meetingHelpers.isHeading(block)) {
      currentHeadingTitle = meetingHelpers.blockPlainText(block);
    }
    if (block.type === "child_database") {
      await flushPending();
      const sourceTitle = block.child_database.title;
      const title = meetingHelpers.childDatabaseDisplayTitle(sourceTitle, currentHeadingTitle);
      const mode = copyModeForChildDatabase(title);
      if (mode === "skip") {
        const result = await appendChildDatabaseReferenceView(targetPageId, {
          sourceId: block.id,
          sourceTitle,
          title,
        });
        copiedBlockCount += result.copiedBlockCount;
        copiedDatabases.push(result.report);
      } else {
        copiedDatabases.push(await createCopiedChildDatabase(block.id, targetPageId));
      }
    } else {
      pending.push(entry);
    }
  }
  await flushPending();

  const missingReference = childDatabaseReferenceForTitle(childDatabaseReferenceMissingTitle);
  const hasReference = missingReference
    ? copiedDatabases.some((database) => database.referenceUrl === missingReference.url)
    : true;
  if (appendChildDatabaseReferenceIfMissing && missingReference && !hasReference) {
    const result = await appendChildDatabaseReferenceView(targetPageId, {
      title: childDatabaseReferenceMissingTitle,
      virtual: true,
    });
    copiedBlockCount += result.copiedBlockCount;
    copiedDatabases.push(result.report);
  }

  return { copiedBlockCount, copiedDatabases, ...stats };
}

async function createMeetingPage(sourcePage) {
  const newTitle = targetTitle;
  const resolvedPeoplePropertyName = findPeoplePropertyName(sourcePage);
  const attendees = resolvedPeoplePropertyName ? getPeopleProperty(sourcePage, resolvedPeoplePropertyName) : [];
  const properties = {
    Name: { title: [{ type: "text", text: { content: newTitle } }] },
    Date: { date: { start: targetDate } },
  };
  if (attendees.length && resolvedPeoplePropertyName) properties[resolvedPeoplePropertyName] = { people: attendees };

  const created = await notion("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: meetingsDatabaseId },
      properties,
    }),
  });

  const copied = await copyPageContent(sourcePage.id, created.id);
  return { created, newTitle, ...copied };
}

const holiday = skipKoreanHolidays
  ? await getKoreanHoliday(targetDate, { calendarUrl: koreanHolidayCalendarUrl })
  : { isHoliday: false, name: null, source: "disabled" };
if (meetingHelpers.shouldSkipMeetingForHoliday({ skipKoreanHolidays, holiday })) {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "target_date_is_korean_holiday",
    targetDate,
    targetTitle,
    holidayName: holiday.name,
    holidaySource: holiday.source,
    holidayWarning: holiday.warning,
  }, null, 2));
  process.exit(0);
}

const existing = await findExistingTarget();
if (existing && !forceCreate) {
  console.log(JSON.stringify({
    status: "skipped",
    reason: "target_date_already_exists",
    targetDate,
    existingTitle: pageTitle(existing),
    existingUrl: existing.url,
  }, null, 2));
  process.exit(0);
}

const source = await findSourcePage();
if (!source) throw new Error(`No source meeting found before ${targetDate}.`);
sourceDateForReplacement = pageDate(source);
sourceTitleForReplacement = pageTitle(source);

if (dryRun) {
  const children = await listBlockChildren(source.id);
  const { blocks, stats } = scrubTemperatureCheckComments(children);
  stats.checkInTodoResetCount = await countCheckInTodoResets(blocks);
  const copyEntries = stripStaleReferenceSections(checkInCopyEntries(blocks));
  const childDatabases = [];
  let currentHeadingTitle = "";
  for (const block of blocks.filter((candidate) => candidate.type === "child_database")) {
    const blockIndex = blocks.indexOf(block);
    for (let index = 0; index < blockIndex; index += 1) {
      if (meetingHelpers.isHeading(blocks[index])) currentHeadingTitle = meetingHelpers.blockPlainText(blocks[index]);
    }
    const sourceTitle = block.child_database.title;
    const title = meetingHelpers.childDatabaseDisplayTitle(sourceTitle, currentHeadingTitle);
    const mode = copyModeForChildDatabase(title);
    let rows = [];
    let queryError = null;
    if (mode !== "skip") {
      try {
        rows = await queryDatabase(block.id, {});
      } catch (error) {
        queryError = error.message;
      }
    }
    const copyRows = mode === "copy_non_done" && !queryError;
    const skippedDoneRowCount = copyRows ? rows.filter(isDoneChecked).length : 0;
    const skippedSchemaOnlyRowCount = mode === "schema_only" ? rows.length : 0;
    const reference = mode === "skip" ? childDatabaseReferenceForTitle(title) : null;
    childDatabases.push({
      title,
      sourceTitle,
      id: normalizeId(block.id),
      mode,
      queryError,
      rowCount: mode === "skip" ? null : rows.length,
      copiedRowCount: copyRows ? rows.length - skippedDoneRowCount : 0,
      skippedDoneRowCount,
      skippedSchemaOnlyRowCount,
      skippedCopiedDatabaseCount: mode === "skip" ? 1 : 0,
      referenceRender: mode === "skip" && reference ? childDatabaseReferenceRender : null,
      linkedViewType: mode === "skip" && reference && childDatabaseReferenceRender === "linked_view" ? childDatabaseReferenceViewType : null,
      referenceUrl: reference?.url || null,
    });
  }
  const missingReference = childDatabaseReferenceForTitle(childDatabaseReferenceMissingTitle);
  const hasReference = missingReference
    ? childDatabases.some((database) => database.referenceUrl === missingReference.url)
    : true;
  if (appendChildDatabaseReferenceIfMissing && missingReference && !hasReference) {
    childDatabases.push({
      title: childDatabaseReferenceMissingTitle,
      sourceTitle: null,
      id: null,
      mode: "skip",
      queryError: null,
      rowCount: null,
      copiedRowCount: 0,
      skippedDoneRowCount: 0,
      skippedSchemaOnlyRowCount: 0,
      skippedCopiedDatabaseCount: 0,
      referenceRender: childDatabaseReferenceRender,
      linkedViewType: childDatabaseReferenceRender === "linked_view" ? childDatabaseReferenceViewType : null,
      referenceUrl: missingReference.url,
      virtual: true,
    });
  }
  console.log(JSON.stringify({
    status: "dry_run",
    meetingsDatabaseId,
    targetDate,
    targetTitle,
    titleContains,
    targetDaysAhead,
    forceCreate,
    holiday,
    sourceDate: pageDate(source),
    sourceTitle: pageTitle(source),
    titleReplacement: {
      from: sourceTitleForReplacement,
      to: targetTitle,
    },
    sourceUrl: source.url,
    topLevelBlockCount: children.length,
    copiedTopLevelBlockCount: copyEntries.filter((entry) => blockToAppendPayload(entry.block, { resetToDoChecked: entry.resetToDoChecked })).length,
    temperatureCheck: {
      mentionCount: stats.temperatureMentionCount,
      blankBlockCount: stats.temperatureBlankBlockCount,
      removedBlockCount: stats.temperatureRemovedBlockCount,
    },
    checkIn: {
      todoResetCount: stats.checkInTodoResetCount,
    },
    slackNotification: slackNotify
      ? buildSlackNotification("https://www.notion.so/created-page-url")
      : null,
    childDatabases,
    note: "Run with --apply to create the meeting page.",
  }, null, 2));
  process.exit(0);
}

const result = await createMeetingPage(source);
const slackNotification = slackNotify ? await postSlackNotification(result.created.url) : null;
console.log(JSON.stringify({
  status: "created",
  meetingsDatabaseId,
  targetDate,
  title: result.newTitle,
  forceCreate,
  holiday,
  url: result.created.url,
  sourceTitle: pageTitle(source),
  sourceUrl: source.url,
  copiedBlockCount: result.copiedBlockCount,
  temperatureCheck: {
    mentionCount: result.temperatureMentionCount,
    blankBlockCount: result.temperatureBlankBlockCount,
    removedBlockCount: result.temperatureRemovedBlockCount,
  },
  checkIn: {
    todoResetCount: result.checkInTodoResetCount,
  },
  slackNotification,
  copiedDatabases: result.copiedDatabases,
}, null, 2));
