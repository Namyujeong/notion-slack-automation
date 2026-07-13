#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const JOB_ALIASES = new Map([
  ["weekly-meeting", "weekly-meeting"],
  ["notion-weekly-meeting", "weekly-meeting"],
  ["operations-meeting", "operations-meeting"],
  ["notion-operations-meeting", "operations-meeting"],
  ["team-weekly-meeting", "team-weekly-meeting"],
  ["notion-team-weekly-meeting", "team-weekly-meeting"],
  ["issue-reminder", "issue-reminder"],
  ["slack-issue-reminder", "issue-reminder"],
  ["flex-reminder", "flex-reminder"],
  ["slack-flex-reminder", "flex-reminder"],
  ["invoice-request", "invoice-request"],
  ["slack-invoice-request", "invoice-request"],
  ["invoice-archive", "invoice-archive"],
  ["invoice-attachment-archive", "invoice-archive"],
  ["slack-invoice-attachment-archive", "invoice-archive"],
  ["channel-cleanup", "channel-cleanup"],
  ["slack-channel-cleanup", "channel-cleanup"],
]);

const PLACEHOLDER_VALUES = new Set([
  "ntn_xxx",
  "xoxb_xxx",
  "drive_folder_id",
  "your_notion_database_id",
  "your_notion_data_source_id",
  "your_slack_channel_id",
  "your_slack_usergroup_mention",
  "your_drive_folder_id",
  "your-token",
  "your_token",
  "todo",
  "changeme",
]);

function isMissingValue(value) {
  if (value === undefined || value === null) return true;
  const trimmed = String(value).trim();
  return !trimmed || PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}

function isEnabled(value) {
  return value !== "0" && String(value || "").toLowerCase() !== "false";
}

function requireEnv(env, errors, name) {
  if (isMissingValue(env[name])) errors.push(`${name} is required`);
}

function requireAnyEnv(env, errors, names) {
  if (names.some((name) => !isMissingValue(env[name]))) return;
  errors.push(`${names.join(" or ")} is required`);
}

function requireInteger(env, errors, name, { min = null } = {}) {
  if (isMissingValue(env[name])) {
    errors.push(`${name} is required`);
    return;
  }
  const number = Number(env[name]);
  if (!Number.isInteger(number)) {
    errors.push(`${name} must be an integer`);
    return;
  }
  if (min !== null && number < min) errors.push(`${name} must be >= ${min}`);
}

function optionalInteger(env, errors, name, { min = null, max = null } = {}) {
  if (isMissingValue(env[name])) return;
  requireInteger(env, errors, name, { min });
  if (max !== null && Number(env[name]) > max) errors.push(`${name} must be <= ${max}`);
}

function optionalEnum(env, errors, name, allowedValues) {
  if (isMissingValue(env[name])) return;
  if (!allowedValues.includes(env[name])) {
    errors.push(`${name} must be one of: ${allowedValues.join(", ")}`);
  }
}

function requireJson(env, errors, name, validate = null) {
  if (isMissingValue(env[name])) {
    errors.push(`${name} is required`);
    return;
  }

  try {
    const parsed = JSON.parse(env[name]);
    if (validate) validate(parsed, errors, name);
  } catch (error) {
    errors.push(`${name} must be valid JSON: ${error.message}`);
  }
}

function requireChannelId(env, errors, name) {
  requireEnv(env, errors, name);
  if (!isMissingValue(env[name]) && !/^[CGD][A-Z0-9]+$/.test(env[name])) {
    errors.push(`${name} must look like a Slack channel or conversation ID`);
  }
}

function validateUserMap(value, errors, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${name} must be a JSON object`);
  }
}

function validateInvoiceTargets(value, errors, name) {
  const targets = Array.isArray(value) ? value : value?.targets;
  if (!Array.isArray(targets)) {
    errors.push(`${name} must be an array or an object with a targets array`);
    return;
  }
  if (!targets.length) errors.push(`${name} must contain at least one target`);
}

function validateServiceAccount(value, errors, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${name} must be a JSON object`);
    return;
  }
  if (isMissingValue(value.client_email)) errors.push(`${name}.client_email is required`);
  if (isMissingValue(value.private_key)) errors.push(`${name}.private_key is required`);
}

function validateMeeting(env, errors, { requireSlackNotification = false } = {}) {
  requireEnv(env, errors, "NOTION_TOKEN");
  requireEnv(env, errors, "MEETINGS_DATABASE_ID");
  optionalEnum(env, errors, "MEETING_CHILD_DATABASE_COPY_MODE", ["copy_non_done", "schema_only", "skip"]);
  optionalEnum(env, errors, "MEETING_CHILD_DATABASE_ROW_MODE", ["copy_non_done", "schema_only", "skip"]);
  if (!isMissingValue(env.MEETING_CHILD_DATABASE_REFERENCE_JSON)) {
    requireJson(env, errors, "MEETING_CHILD_DATABASE_REFERENCE_JSON");
  }
  const runMode = env.RUN_MODE || "apply";
  if (requireSlackNotification && isEnabled(env.MEETING_SLACK_NOTIFY) && runMode !== "dry-run") {
    requireAnyEnv(env, errors, ["SLACK_BOT_TOKEN", "MEETING_SLACK_BOT_TOKEN"]);
    requireChannelId(env, errors, "MEETING_SLACK_CHANNEL_ID");
    requireEnv(env, errors, "MEETING_SLACK_MENTION");
  }
}

function validateIssueReminder(env, errors) {
  requireEnv(env, errors, "NOTION_TOKEN");
  requireEnv(env, errors, "SLACK_BOT_TOKEN");
  requireChannelId(env, errors, "SLACK_CHANNEL_ID");
  requireEnv(env, errors, "ISSUE_SOURCE_ID");
  requireEnv(env, errors, "DUE_DATE_PROPERTY");
  requireEnv(env, errors, "ASSIGNEE_PROPERTY");
  requireEnv(env, errors, "DONE_PROPERTY");
  requireEnv(env, errors, "REMINDER_STATE_FILE");
  requireInteger(env, errors, "DAYS_AHEAD", { min: 0 });
  requireInteger(env, errors, "LOOKBACK_DAYS", { min: 0 });
  requireJson(env, errors, "SLACK_USER_MAP_JSON", validateUserMap);
}

function validateFlexReminder(env, errors) {
  requireEnv(env, errors, "SLACK_BOT_TOKEN");
  requireChannelId(env, errors, "FLEX_SLACK_CHANNEL_ID");
  requireEnv(env, errors, "FLEX_MESSAGE_MARKER");
  requireEnv(env, errors, "FLEX_STATE_FILE");
  requireInteger(env, errors, "FLEX_CHECK_AFTER_MINUTES", { min: 0 });
  requireInteger(env, errors, "FLEX_REMINDER_INTERVAL_MINUTES", { min: 1 });
  requireInteger(env, errors, "FLEX_MAX_REMINDERS", { min: 1 });
  requireInteger(env, errors, "FLEX_LOOKBACK_HOURS", { min: 1 });
  optionalEnum(env, errors, "FLEX_JOB", ["source", "reminder"]);
  if (env.FLEX_JOB === "source") requireEnv(env, errors, "FLEX_TARGET_USER_IDS");
}

function validateInvoiceRequest(env, errors) {
  requireEnv(env, errors, "SLACK_BOT_TOKEN");
  requireChannelId(env, errors, "INVOICE_SLACK_CHANNEL_ID");
  requireJson(env, errors, "INVOICE_REQUEST_TARGETS_JSON", validateInvoiceTargets);
  requireEnv(env, errors, "INVOICE_STATE_FILE");
  requireInteger(env, errors, "INVOICE_REQUEST_DAY", { min: 1 });
  requireInteger(env, errors, "INVOICE_REQUEST_HOUR", { min: 0 });
  optionalInteger(env, errors, "INVOICE_SAME_DAY_FIRST_REMINDER_HOUR", { min: 0, max: 23 });
  optionalInteger(env, errors, "INVOICE_SAME_DAY_SECOND_REMINDER_HOUR", { min: 0, max: 23 });
  optionalInteger(env, errors, "INVOICE_PRE_DEADLINE_REMINDER_HOUR", { min: 0, max: 23 });
  requireInteger(env, errors, "INVOICE_DEADLINE_BUSINESS_DAYS", { min: 0 });
}

function validateInvoiceArchive(env, errors) {
  requireEnv(env, errors, "SLACK_BOT_TOKEN");
  requireChannelId(env, errors, "INVOICE_SLACK_CHANNEL_ID");
  requireEnv(env, errors, "INVOICE_STATE_FILE");
  requireEnv(env, errors, "INVOICE_ARCHIVE_STATE_FILE");
  requireInteger(env, errors, "INVOICE_ARCHIVE_LOOKBACK_DAYS", { min: 1 });
  requireInteger(env, errors, "INVOICE_ARCHIVE_MAX_FILES_PER_RUN", { min: 1 });

  const mode = env.RUN_MODE || "apply";
  if (mode === "apply") {
    requireEnv(env, errors, "GOOGLE_DRIVE_INVOICE_FOLDER_ID");
    requireJson(env, errors, "GOOGLE_SERVICE_ACCOUNT_JSON", validateServiceAccount);
    requireEnv(env, errors, "GOOGLE_DRIVE_SCOPE");
  }
}

function validateChannelCleanup(env, errors) {
  requireEnv(env, errors, "SLACK_USER_TOKEN");
  requireEnv(env, errors, "SLACK_BOT_TOKEN");
  requireEnv(env, errors, "CHANNEL_CLEANUP_STATE_FILE");
  requireInteger(env, errors, "CHANNEL_CLEANUP_INACTIVE_DAYS", { min: 1 });
  requireInteger(env, errors, "CHANNEL_CLEANUP_NOTICE_DAYS", { min: 1 });
  if (!isMissingValue(env.CHANNEL_CLEANUP_REQUIRE_KST_HOUR)) {
    requireInteger(env, errors, "CHANNEL_CLEANUP_REQUIRE_KST_HOUR", { min: 0 });
    if (Number(env.CHANNEL_CLEANUP_REQUIRE_KST_HOUR) > 23) {
      errors.push("CHANNEL_CLEANUP_REQUIRE_KST_HOUR must be <= 23");
    }
  }
}

export function validateConfig(jobName, env = process.env) {
  const normalizedJob = JOB_ALIASES.get(jobName);
  if (!normalizedJob) {
    return {
      ok: false,
      jobName,
      errors: [`Unknown job "${jobName}". Use one of: ${[...new Set(JOB_ALIASES.values())].join(", ")}`],
    };
  }

  const errors = [];
  if (normalizedJob === "weekly-meeting" || normalizedJob === "operations-meeting") validateMeeting(env, errors);
  if (normalizedJob === "team-weekly-meeting") validateMeeting(env, errors, { requireSlackNotification: true });
  if (normalizedJob === "issue-reminder") validateIssueReminder(env, errors);
  if (normalizedJob === "flex-reminder") validateFlexReminder(env, errors);
  if (normalizedJob === "invoice-request") validateInvoiceRequest(env, errors);
  if (normalizedJob === "invoice-archive") validateInvoiceArchive(env, errors);
  if (normalizedJob === "channel-cleanup") validateChannelCleanup(env, errors);

  return {
    ok: errors.length === 0,
    jobName: normalizedJob,
    errors,
  };
}

export function main() {
  const jobName = process.argv[2];
  if (!jobName) {
    console.error("Usage: node scripts/validate-config.mjs <job>");
    process.exitCode = 1;
    return;
  }

  const result = validateConfig(jobName, process.env);
  if (!result.ok) {
    console.error(`Invalid configuration for ${result.jobName}:`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Configuration OK for ${result.jobName}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
