#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import * as flexHelpers from "../../lib/flex-reaction-reminder-helpers.mjs";

const DEFAULT_STATE_FILE = ".slack-flex-reaction-reminder-state.json";

const args = process.argv.slice(2);
const argv = new Set(args);
const dryRun = argv.has("--dry-run") || !argv.has("--apply");

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
await loadEnvFile(path.join(process.cwd(), ".env.flex.local"), { override: true });

const flexJob = argv.has("--source") ? "source" : String(process.env.FLEX_JOB || "reminder").trim().toLowerCase();
const slackToken = process.env.SLACK_BOT_TOKEN;
const channelId = process.env.FLEX_SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
const marker = process.env.FLEX_MESSAGE_MARKER || process.env.SLACK_MESSAGE_MARKER;
const reactionName = (process.env.FLEX_REACTION_NAME || process.env.SLACK_REACTION_NAME || "white_check_mark").replace(/^:|:$/g, "");
const checkAfterMinutes = Number(process.env.FLEX_CHECK_AFTER_MINUTES || process.env.CHECK_AFTER_MINUTES || "60");
const reminderIntervalMinutes = Number(process.env.FLEX_REMINDER_INTERVAL_MINUTES || process.env.REMINDER_INTERVAL_MINUTES || "60");
const maxReminders = Number(process.env.FLEX_MAX_REMINDERS || process.env.MAX_REMINDERS || "3");
const lookbackHours = Number(process.env.FLEX_LOOKBACK_HOURS || process.env.LOOKBACK_HOURS || "24");
const stateFile = process.env.FLEX_STATE_FILE || process.env.STATE_FILE || DEFAULT_STATE_FILE;
const explicitTargets = splitUserIds(process.env.FLEX_TARGET_USER_IDS || process.env.SLACK_TARGET_USER_IDS);
const excludedTargets = new Set(splitUserIds(process.env.FLEX_EXCLUDED_USER_IDS || process.env.SLACK_EXCLUDED_USER_IDS));
const expandUsergroups = envBool(process.env.FLEX_EXPAND_USERGROUPS || process.env.SLACK_EXPAND_USERGROUPS);
const filterInactiveUsers = process.env.FLEX_FILTER_INACTIVE_USERS !== "0";
const sourceChannelMention = process.env.FLEX_SOURCE_CHANNEL_MENTION !== "0";
const sourceFlexUrl = process.env.FLEX_SOURCE_URL || "https://www.flex.team/";

if (!slackToken) throw new Error("SLACK_BOT_TOKEN is required.");
if (!channelId) throw new Error("FLEX_SLACK_CHANNEL_ID is required.");
if (!marker) throw new Error("FLEX_MESSAGE_MARKER is required.");
if (!["source", "reminder"].includes(flexJob)) throw new Error("FLEX_JOB must be source or reminder.");
if (flexJob === "source" && !explicitTargets.length) throw new Error("FLEX_TARGET_USER_IDS is required for source creation.");

function envBool(value) {
  return flexHelpers.envBool(value);
}

function splitUserIds(raw = "") {
  return flexHelpers.splitUserIds(raw);
}

function messageKey(messageTs) {
  return flexHelpers.messageKey(channelId, messageTs);
}

function messageSearchText(message) {
  return flexHelpers.messageSearchText(message);
}

function extractUserMentions(message) {
  return flexHelpers.extractUserMentions(message);
}

function extractUsergroupMentions(message) {
  return flexHelpers.extractUsergroupMentions(message);
}

async function readState() {
  try {
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    if (!state || typeof state !== "object") return { messages: {} };
    return { ...state, messages: state.messages || {} };
  } catch (error) {
    if (error.code === "ENOENT") return { messages: {} };
    throw error;
  }
}

async function writeState(state) {
  const tmpPath = `${stateFile}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, stateFile);
}

async function slack(method, params = {}, { httpMethod = "GET" } = {}) {
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
  if (!data.ok) {
    const error = new Error(`Slack ${method} failed: ${data.error}`);
    error.slackError = data.error;
    error.needed = data.needed;
    error.provided = data.provided;
    throw error;
  }
  return data;
}

async function conversationsHistory(oldest) {
  const messages = [];
  let cursor = null;
  do {
    const data = await slack("conversations.history", {
      channel: channelId,
      oldest,
      limit: 100,
      cursor,
    });
    messages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);
  return messages;
}

async function resolveTargets(message) {
  if (explicitTargets.length) return explicitTargets;

  const targets = extractUserMentions(message);
  if (!expandUsergroups) return targets;

  for (const usergroupId of extractUsergroupMentions(message)) {
    const data = await slack("usergroups.users.list", {
      usergroup: usergroupId,
      include_disabled: false,
    });
    for (const userId of data.users || []) {
      if (!targets.includes(userId)) targets.push(userId);
    }
  }
  return targets;
}

async function userInfo(userId) {
  const data = await slack("users.info", { user: userId });
  return data.user;
}

async function filterActiveTargets(targets) {
  const { includedUserIds, excludedUserIds } = flexHelpers.filterExcludedUserIds(targets, excludedTargets);
  if (excludedUserIds.length) {
    console.log(`Excluded configured Flex target(s): ${excludedUserIds.join(",")}`);
  }
  if (!filterInactiveUsers || !includedUserIds.length) return includedUserIds;

  const activeTargets = [];
  const inactiveTargets = [];
  for (const userId of includedUserIds) {
    try {
      const user = await userInfo(userId);
      const reason = flexHelpers.inactiveSlackUserReason(user);
      if (reason) {
        inactiveTargets.push({ userId, reason });
      } else {
        activeTargets.push(userId);
      }
    } catch (error) {
      if (error.slackError === "missing_scope") {
        const needed = error.needed ? ` Needed scope: ${error.needed}.` : "";
        console.warn(`Skip Slack active-user filtering: FLEX_SLACK_BOT_TOKEN needs users:read.${needed}`);
        return includedUserIds;
      }
      if (error.slackError === "user_not_found" || error.slackError === "account_inactive") {
        inactiveTargets.push({ userId, reason: error.slackError });
        continue;
      }
      throw error;
    }
  }

  if (inactiveTargets.length) {
    const summary = inactiveTargets.map(({ userId, reason }) => `${userId}:${reason}`).join(",");
    console.log(`Excluded inactive Slack target(s): ${summary}`);
  }
  return activeTargets;
}

async function reactionUsers(messageTs) {
  const data = await slack("reactions.get", {
    channel: channelId,
    timestamp: messageTs,
    full: true,
  });
  const reaction = (data.message?.reactions || []).find((item) => item.name === reactionName);
  return new Set(reaction?.users || []);
}

function shouldSendReminder(stateEntry, nowMs) {
  return flexHelpers.shouldSendReminder(stateEntry, nowMs, { reminderIntervalMinutes });
}

function buildReminderText(missingUserIds, reminderNumber, targetCount, reactedCount) {
  return flexHelpers.buildReminderText(missingUserIds, reminderNumber, targetCount, reactedCount, {
    maxReminders,
    reactionName,
  });
}

async function postThreadReminder(messageTs, text) {
  await slack("chat.postMessage", {
    channel: channelId,
    text,
    thread_ts: messageTs,
    unfurl_links: false,
    unfurl_media: false,
  }, { httpMethod: "POST" });
}

async function postSourceMessage(text) {
  return slack("chat.postMessage", {
    channel: channelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  }, { httpMethod: "POST" });
}

async function runSourceCreation() {
  const nowMs = Date.now();
  const today = flexHelpers.sourceDateInSeoul(String(nowMs / 1000));
  const oldest = String(Math.floor((nowMs - 24 * 60 * 60 * 1000) / 1000));
  const messages = await conversationsHistory(oldest);
  const existing = messages.find((message) => (
    message.ts
    && flexHelpers.sourceDateInSeoul(message.ts) === today
    && messageSearchText(message).includes(marker)
  ));

  if (existing) {
    console.log(`Skip source creation: ${today} source already exists at ${existing.ts}.`);
    return;
  }

  const targets = await filterActiveTargets(explicitTargets);
  if (!targets.length) throw new Error("No active Flex source target users remain after filtering.");
  const text = flexHelpers.buildSourceMessage(targets, {
    marker,
    reactionName,
    channelMention: sourceChannelMention,
    flexUrl: sourceFlexUrl,
  });

  if (dryRun) {
    console.log(`[DRY_RUN] Would post Flex source to ${channelId}:\n${text}`);
    console.log("Done. Dry run only; source was not posted.");
    return;
  }

  const data = await postSourceMessage(text);
  console.log(`Posted Flex source for ${today} to ${channelId}: ${data.ts}`);
}

async function runReminders() {
  const state = await readState();
  const nowMs = Date.now();
  const oldest = String(Math.floor((nowMs - lookbackHours * 60 * 60 * 1000) / 1000));
  const messages = await conversationsHistory(oldest);
  const matchingMessages = messages
    .filter((message) => message.ts && messageSearchText(message).includes(marker))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const { canonicalMessages, duplicateMessages } = flexHelpers.splitCanonicalDailySourceMessages(matchingMessages);

  console.log(`Found ${matchingMessages.length} matching message(s) in channel ${channelId} for marker ${JSON.stringify(marker)}.`);
  if (duplicateMessages.length) {
    for (const { message, sourceDate, canonicalTs } of duplicateMessages) {
      console.log(`Skip ${message.ts}: duplicate Flex source for ${sourceDate}; canonical source is ${canonicalTs}.`);
    }
  }

  let postedCount = 0;
  let stateChanged = false;

  for (const message of canonicalMessages) {
    const messageTs = message.ts;
    const key = messageKey(messageTs);
    const stateEntry = state.messages[key] || {};

    if (stateEntry.status === "complete") {
      console.log(`Skip ${messageTs}: already complete.`);
      continue;
    }

    const ageMinutes = (nowMs - Number(messageTs) * 1000) / 60_000;
    if (ageMinutes < checkAfterMinutes) {
      console.log(`Skip ${messageTs}: age ${ageMinutes.toFixed(1)}m < ${checkAfterMinutes}m.`);
      continue;
    }

    const targets = await filterActiveTargets(await resolveTargets(message));
    if (!targets.length) {
      console.log(`Skip ${messageTs}: no active target users found.`);
      continue;
    }

    const reactedUsers = await reactionUsers(messageTs);
    const missingUsers = targets.filter((userId) => !reactedUsers.has(userId));
    const reactedTargetCount = targets.filter((userId) => reactedUsers.has(userId)).length;

    if (!missingUsers.length) {
      if (!dryRun) {
        state.messages[key] = {
          ...stateEntry,
          status: "complete",
          updatedAt: new Date().toISOString(),
          completedAtMs: nowMs,
          targetUserIds: targets,
        };
        stateChanged = true;
      }
      console.log(`Complete ${messageTs}: ${reactedTargetCount}/${targets.length}.`);
      continue;
    }

    if (!shouldSendReminder(stateEntry, nowMs)) {
      const elapsedMinutes = (nowMs - Number(stateEntry.lastRemindedAtMs)) / 60_000;
      console.log(`Skip ${messageTs}: last reminder ${elapsedMinutes.toFixed(1)}m ago < ${reminderIntervalMinutes}m.`);
      continue;
    }

    const reminderNumber = Number(stateEntry.reminderCount || 0) + 1;
    if (reminderNumber > maxReminders) {
      if (stateEntry.status !== "maxed" && !dryRun) {
        state.messages[key] = {
          ...stateEntry,
          status: "maxed",
          updatedAt: new Date().toISOString(),
          missingUserIds: missingUsers,
          targetUserIds: targets,
        };
        stateChanged = true;
      }
      console.log(`Skip ${messageTs}: reminder limit reached (${maxReminders}).`);
      continue;
    }

    const reminderText = buildReminderText(missingUsers, reminderNumber, targets.length, reactedTargetCount);

    if (dryRun) {
      console.log(`[DRY_RUN] Would post to thread ${messageTs}:\n${reminderText}`);
    } else {
      await postThreadReminder(messageTs, reminderText);
      postedCount += 1;
      state.messages[key] = {
        status: reminderNumber >= maxReminders ? "maxed" : "reminded",
        updatedAt: new Date().toISOString(),
        lastRemindedAtMs: nowMs,
        reminderCount: reminderNumber,
        missingUserIds: missingUsers,
        targetUserIds: targets,
      };
      stateChanged = true;
      console.log(`Posted reminder ${reminderNumber}/${maxReminders} to thread ${messageTs}: ${missingUsers.join(",")}`);
    }
  }

  if (dryRun) {
    console.log("Done. Dry run only; state was not written.");
  } else if (stateChanged) {
    await writeState(state);
    console.log(`Done. Posted reminders: ${postedCount}. State: ${stateFile}`);
  } else {
    console.log(`Done. Posted reminders: ${postedCount}. No state changes.`);
  }
}

if (flexJob === "source") {
  await runSourceCreation();
} else {
  await runReminders();
}
