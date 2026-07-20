#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ALLOWLIST_EXACT,
  DEFAULT_ALLOWLIST_PREFIXES,
  candidateStatus,
  dateInSeoul,
  daysAfter,
  daysAgo,
  defaultNotice,
  hourInSeoul,
  isSharedChannel,
  skipReason,
  splitCsv,
  unixTsToIso,
} from "../../lib/slack-channel-cleanup-helpers.mjs";

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
await loadEnvFile(path.join(process.cwd(), ".env.channel-cleanup.local"), { override: true });

const apply = argv.has("--apply");
const dryRun = argv.has("--dry-run") || !apply;
const checkSlack = argv.has("--check-slack") || apply;
const now = argValue("--now") ? new Date(argValue("--now")) : new Date();
const requiredKstHour = numberOrNull(argValue("--require-kst-hour") || process.env.CHANNEL_CLEANUP_REQUIRE_KST_HOUR);

if (requiredKstHour !== null && hourInSeoul(now) !== requiredKstHour) {
  console.log(`Skipped: current KST hour is ${hourInSeoul(now)}, required ${requiredKstHour}.`);
  process.exit(0);
}

const readToken = process.env.SLACK_USER_TOKEN || process.env.CHANNEL_CLEANUP_READ_TOKEN || "";
const notifyToken = process.env.SLACK_BOT_TOKEN
  || process.env.CHANNEL_CLEANUP_NOTIFY_TOKEN
  || readToken;
const archiveToken = process.env.SLACK_USER_TOKEN || process.env.CHANNEL_CLEANUP_ARCHIVE_TOKEN || "";
const stateFile = process.env.CHANNEL_CLEANUP_STATE_FILE
  || argValue("--state-file")
  || "state/slack-channel-cleanup-state.json";
const inactiveDays = Number(process.env.CHANNEL_CLEANUP_INACTIVE_DAYS || argValue("--inactive-days") || "365");
const noticeDays = Number(process.env.CHANNEL_CLEANUP_NOTICE_DAYS || argValue("--notice-days") || "14");
const types = process.env.CHANNEL_CLEANUP_TYPES || argValue("--types") || "public_channel";
const limit = Number(process.env.CHANNEL_CLEANUP_LIMIT || "200");
const includeShared = process.env.CHANNEL_CLEANUP_INCLUDE_SHARED === "1";
const joinBeforeNotify = process.env.CHANNEL_CLEANUP_JOIN_BEFORE_NOTIFY === "1";
const joinBeforeArchive = process.env.CHANNEL_CLEANUP_JOIN_BEFORE_ARCHIVE !== "0";
const joinBeforeHistory = process.env.CHANNEL_CLEANUP_JOIN_BEFORE_HISTORY === "1";

if (checkSlack && !readToken) throw new Error("SLACK_USER_TOKEN is required.");
if (apply && !notifyToken) throw new Error("SLACK_BOT_TOKEN or SLACK_USER_TOKEN is required.");
if (apply && !archiveToken) throw new Error("SLACK_USER_TOKEN is required for archive actions.");

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`Expected integer, got ${value}`);
  return number;
}

function envAllowlists() {
  const exact = new Set([...DEFAULT_ALLOWLIST_EXACT, ...splitCsv(process.env.CHANNEL_CLEANUP_ALLOWLIST)]);
  const prefixes = [...DEFAULT_ALLOWLIST_PREFIXES, ...splitCsv(process.env.CHANNEL_CLEANUP_ALLOW_PREFIX)];
  return { exact, prefixes };
}

async function slack(token, method, params = {}, { httpMethod = "GET" } = {}) {
  if (!token) throw new Error(`Slack token is required for ${method}.`);
  const url = new URL(`https://slack.com/api/${method}`);
  const options = {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
  };

  if (httpMethod === "GET") {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  } else {
    options.body = JSON.stringify(params);
  }

  for (let attempt = 0; attempt <= 5; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status === 429 && attempt < 5) {
      const retryAfter = Number(response.headers.get("retry-after") || "30");
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    const data = await response.json();
    if (data.ok) return data;
    const scope = data.needed || data.provided
      ? ` needed=${data.needed || ""} provided=${data.provided || ""}`
      : "";
    throw new Error(`Slack ${method} failed: ${data.error || "unknown_error"}${scope}`);
  }

  throw new Error(`Slack ${method} failed: retry_exhausted`);
}

async function conversationsList() {
  const channels = [];
  let cursor = null;
  do {
    const data = await slack(readToken, "conversations.list", {
      types,
      exclude_archived: "true",
      limit,
      cursor,
    });
    channels.push(...(data.channels || []));
    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);
  return channels;
}

async function latestActivity(channel) {
  if (joinBeforeHistory && !channel.is_private && !channel.is_member) {
    try {
      await slack(readToken, "conversations.join", { channel: channel.id }, { httpMethod: "POST" });
    } catch (error) {
      if (!String(error.message).includes("already_in_channel")) {
        return { source: "history_join_error", error: error.message, ts: null, at: null };
      }
    }
  }

  try {
    const data = await slack(readToken, "conversations.history", {
      channel: channel.id,
      limit: 1,
    });
    const message = data.messages?.[0];
    if (message?.ts) {
      return {
        source: "latest_message",
        error: "",
        ts: Number(message.ts),
        at: new Date(Number(message.ts) * 1000),
      };
    }
    return {
      source: "created_no_messages",
      error: "",
      ts: Number(channel.created || 0),
      at: channel.created ? new Date(Number(channel.created) * 1000) : null,
    };
  } catch (error) {
    return { source: "history_error", error: cleanupSlackError(error), ts: null, at: null };
  }
}

function cleanupSlackError(error) {
  return String(error.message || error).replace(/^Slack conversations\.history failed: /, "");
}

function rowFor(channel, activity, skip, cutoff) {
  const status = candidateStatus({
    latestAt: activity.at,
    latestError: activity.error,
    skip,
    cutoff,
  });
  return {
    candidate: String(status.candidate),
    status: status.status,
    reason: status.reason,
    channel_id: channel.id,
    channel_name: channel.name_normalized || channel.name || "",
    is_private: String(Boolean(channel.is_private)),
    is_member: String(Boolean(channel.is_member)),
    is_shared: String(isSharedChannel(channel)),
    num_members: String(channel.num_members || ""),
    created_at: unixTsToIso(channel.created),
    last_activity_at: activity.at ? activity.at.toISOString() : "",
    last_activity_source: activity.source,
    latest_message_ts: activity.ts ? String(activity.ts) : "",
  };
}

async function scanChannels() {
  const channels = await conversationsList();
  const cutoff = daysAgo(now, inactiveDays);
  const { exact, prefixes } = envAllowlists();
  const rows = [];

  for (const channel of channels) {
    const skip = skipReason(channel, {
      allowlistExact: exact,
      allowlistPrefixes: prefixes,
      includeShared,
    });
    const activity = skip
      ? { source: "not_checked_skip", error: "", ts: null, at: null }
      : await latestActivity(channel);
    rows.push(rowFor(channel, activity, skip, cutoff));
  }

  return rows;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

async function postNotice(channelId, text) {
  if (joinBeforeNotify) {
    try {
      await slack(notifyToken, "conversations.join", { channel: channelId }, { httpMethod: "POST" });
    } catch (error) {
      if (!String(error.message).includes("already_in_channel")) throw error;
    }
  }
  return slack(notifyToken, "chat.postMessage", { channel: channelId, text }, { httpMethod: "POST" });
}

async function archiveChannel(channelId, isPrivate) {
  if (joinBeforeArchive && !isPrivate) {
    try {
      await slack(archiveToken, "conversations.join", { channel: channelId }, { httpMethod: "POST" });
    } catch (error) {
      if (!String(error.message).includes("already_in_channel")) throw error;
    }
  }
  return slack(archiveToken, "conversations.archive", { channel: channelId }, { httpMethod: "POST" });
}

async function processPendingArchives(state) {
  const counts = new Map();
  const channels = state.channels || {};

  for (const [channelId, record] of Object.entries(channels)) {
    if (record.status !== "notified") continue;

    const archiveAfter = record.archive_after_at ? new Date(record.archive_after_at) : null;
    if (archiveAfter && now < archiveAfter) {
      increment(counts, "pending_notice_window");
      continue;
    }

    const activity = await latestActivity({ id: channelId, is_private: record.is_private === "true" });
    if (activity.error) {
      record.last_error = activity.error;
      record.last_checked_at = now.toISOString();
      increment(counts, "archive_skipped_history_error");
      continue;
    }

    const noticeTs = Number(record.notice_ts || 0);
    if (activity.ts && activity.ts > noticeTs) {
      record.status = "kept_active_after_notice";
      record.last_activity_at = activity.at?.toISOString() || "";
      record.latest_message_ts = String(activity.ts);
      record.last_checked_at = now.toISOString();
      increment(counts, "kept_active_after_notice");
      continue;
    }

    if (dryRun) {
      increment(counts, "would_archive");
      continue;
    }

    try {
      await archiveChannel(channelId, record.is_private === "true");
      record.status = "archived";
      record.archived_at = now.toISOString();
      record.last_checked_at = now.toISOString();
      record.last_error = "";
      increment(counts, "archived");
    } catch (error) {
      record.last_error = String(error.message || error);
      record.last_checked_at = now.toISOString();
      increment(counts, "archive_failed");
    }
  }

  return Object.fromEntries(counts);
}

async function notifyNewCandidates(state, rows) {
  const counts = new Map();
  const channels = state.channels || {};
  const archiveAfter = daysAfter(now, noticeDays);
  const noticeText = process.env.CHANNEL_CLEANUP_NOTICE_TEXT || defaultNotice({
    inactiveDays,
    archiveAfterDate: dateInSeoul(archiveAfter),
  });

  for (const row of rows) {
    if (row.candidate !== "true") continue;
    const existing = channels[row.channel_id];
    if (existing?.status === "notified") {
      increment(counts, "notify_skipped_existing_notice");
      continue;
    }

    if (dryRun) {
      increment(counts, "would_notify");
      continue;
    }

    try {
      const data = await postNotice(row.channel_id, noticeText);
      channels[row.channel_id] = {
        channel_id: row.channel_id,
        channel_name: row.channel_name,
        status: "notified",
        notice_ts: data.ts || "",
        notified_at: now.toISOString(),
        archive_after_at: archiveAfter.toISOString(),
        is_private: row.is_private,
        last_activity_at: row.last_activity_at,
        latest_message_ts: row.latest_message_ts,
        last_error: "",
      };
      increment(counts, "notified");
    } catch (error) {
      channels[row.channel_id] = {
        ...existing,
        channel_id: row.channel_id,
        channel_name: row.channel_name,
        status: "notify_failed",
        last_error: String(error.message || error),
        last_checked_at: now.toISOString(),
      };
      increment(counts, "notify_failed");
    }
  }

  state.channels = channels;
  return Object.fromEntries(counts);
}

function increment(counts, key) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows) increment(counts, row[field] || "");
  return Object.fromEntries(counts);
}

export async function main() {
  if (!checkSlack) {
    console.log("Dry run without --check-slack: no Slack API calls made.");
    return;
  }

  const state = await readJson(stateFile, { version: 1, channels: {} });
  const archiveActions = await processPendingArchives(state);
  const rows = await scanChannels();
  const notifyActions = await notifyNewCandidates(state, rows);

  if (apply) await writeJson(stateFile, state);

  const statusCounts = countBy(rows, "status");
  const reasonCounts = countBy(rows, "reason");
  const candidateCount = rows.filter((row) => row.candidate === "true").length;

  console.log(`Run mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`KST date: ${dateInSeoul(now)}`);
  console.log(`Scanned channels: ${rows.length}`);
  console.log(`Candidates: ${candidateCount}`);
  console.log(`Scan status counts: ${JSON.stringify(statusCounts)}`);
  console.log(`Archive actions: ${JSON.stringify(archiveActions)}`);
  console.log(`Notify actions: ${JSON.stringify(notifyActions)}`);
  if (statusCounts.skip_history_error) {
    console.log(`Warning: history errors may make candidate detection incomplete. Reasons: ${JSON.stringify(reasonCounts)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
