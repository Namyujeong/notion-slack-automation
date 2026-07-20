import assert from "node:assert/strict";
import test from "node:test";

import { validateConfig } from "../scripts/validate-config.mjs";

function baseEnv(overrides = {}) {
  return {
    NOTION_TOKEN: "configured",
    MEETINGS_DATABASE_ID: "12345678-1234-1234-1234-123456789abc",
    SLACK_USER_TOKEN: "configured",
    SLACK_BOT_TOKEN: "configured",
    SLACK_CHANNEL_ID: "C1234567890",
    SLACK_USER_MAP_JSON: JSON.stringify({ notion: "U123ABC" }),
    ISSUE_SOURCE_ID: "23456789-2345-2345-2345-23456789abcd",
    DUE_DATE_PROPERTY: "Date",
    ASSIGNEE_PROPERTY: "Person",
    DONE_PROPERTY: "Status",
    DAYS_AHEAD: "1",
    LOOKBACK_DAYS: "30",
    REMINDER_STATE_FILE: "state/slack-due-reminder-state.json",
    FLEX_SLACK_CHANNEL_ID: "C1234567890",
    FLEX_MESSAGE_MARKER: "[Reaction reminder]",
    FLEX_STATE_FILE: "state/slack-flex-reaction-reminder-state.json",
    FLEX_CHECK_AFTER_MINUTES: "60",
    FLEX_REMINDER_INTERVAL_MINUTES: "60",
    FLEX_MAX_REMINDERS: "3",
    FLEX_LOOKBACK_HOURS: "24",
    FLEX_JOB: "reminder",
    FLEX_TARGET_USER_IDS: "U123ABC,U456DEF",
    INVOICE_SLACK_CHANNEL_ID: "C1234567890",
    INVOICE_REQUEST_TARGETS_JSON: JSON.stringify([{ name: "Kevin", slackUserId: "U123ABC" }]),
    INVOICE_STATE_FILE: "state/slack-invoice-request-state.json",
    INVOICE_REQUEST_DAY: "10",
    INVOICE_REQUEST_HOUR: "10",
    INVOICE_SAME_DAY_FIRST_REMINDER_HOUR: "15",
    INVOICE_SAME_DAY_SECOND_REMINDER_HOUR: "18",
    INVOICE_PRE_DEADLINE_REMINDER_HOUR: "10",
    INVOICE_DEADLINE_BUSINESS_DAYS: "3",
    INVOICE_ARCHIVE_STATE_FILE: "state/slack-invoice-archive-state.json",
    INVOICE_ARCHIVE_LOOKBACK_DAYS: "60",
    INVOICE_ARCHIVE_MAX_FILES_PER_RUN: "100",
    CHANNEL_CLEANUP_STATE_FILE: "state/slack-channel-cleanup-state.json",
    CHANNEL_CLEANUP_INACTIVE_DAYS: "365",
    CHANNEL_CLEANUP_NOTICE_DAYS: "14",
    CHANNEL_CLEANUP_REQUIRE_KST_HOUR: "14",
    GOOGLE_DRIVE_INVOICE_FOLDER_ID: "folder-id",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "invoice@example.iam.gserviceaccount.com",
      private_key: "configured-private-key",
    }),
    GOOGLE_DRIVE_SCOPE: "https://www.googleapis.com/auth/drive",
    RUN_MODE: "apply",
    ...overrides,
  };
}

test("config validator accepts configured issue reminder", () => {
  const result = validateConfig("issue-reminder", baseEnv());

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("config validator accepts team weekly meeting Slack notification", () => {
  const result = validateConfig("team-weekly-meeting", baseEnv({
    MEETING_SLACK_NOTIFY: "1",
    MEETING_SLACK_CHANNEL_ID: "C1234567890",
    MEETING_SLACK_MENTION: "<!subteam^S1234567890|team>",
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("config validator rejects missing team Slack notification target for apply mode", () => {
  const result = validateConfig("team-weekly-meeting", baseEnv({
    MEETING_SLACK_NOTIFY: "1",
    MEETING_SLACK_CHANNEL_ID: "",
    MEETING_SLACK_MENTION: "",
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /MEETING_SLACK_CHANNEL_ID is required/);
  assert.match(result.errors.join("\n"), /MEETING_SLACK_MENTION is required/);
});

test("config validator allows team meeting dry-run without Slack credentials", () => {
  const result = validateConfig("team-weekly-meeting", baseEnv({
    RUN_MODE: "dry-run",
    SLACK_BOT_TOKEN: "",
    MEETING_SLACK_NOTIFY: "1",
    MEETING_SLACK_CHANNEL_ID: "",
    MEETING_SLACK_MENTION: "",
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("config validator rejects invalid meeting child database row mode", () => {
  const result = validateConfig("team-weekly-meeting", baseEnv({
    MEETING_SLACK_NOTIFY: "1",
    MEETING_SLACK_CHANNEL_ID: "C1234567890",
    MEETING_SLACK_MENTION: "<!subteam^S1234567890|team>",
    MEETING_CHILD_DATABASE_COPY_MODE: "copy_everything",
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /MEETING_CHILD_DATABASE_COPY_MODE must be one of/);
});

test("config validator rejects missing and malformed values", () => {
  const result = validateConfig("issue-reminder", baseEnv({
    NOTION_TOKEN: "",
    SLACK_CHANNEL_ID: "team-ops",
    SLACK_USER_MAP_JSON: "{bad-json",
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /NOTION_TOKEN is required/);
  assert.match(result.errors.join("\n"), /SLACK_CHANNEL_ID must look like/);
  assert.match(result.errors.join("\n"), /SLACK_USER_MAP_JSON must be valid JSON/);
});

test("Flex source creation requires explicit target users", () => {
  const result = validateConfig("flex-reminder", baseEnv({
    FLEX_JOB: "source",
    FLEX_TARGET_USER_IDS: "",
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /FLEX_TARGET_USER_IDS is required/);
});

test("invoice archive requires Google Drive credentials only for apply mode", () => {
  const dryRun = validateConfig("invoice-archive", baseEnv({
    RUN_MODE: "dry-run",
    GOOGLE_DRIVE_INVOICE_FOLDER_ID: "",
    GOOGLE_SERVICE_ACCOUNT_JSON: "",
  }));
  const apply = validateConfig("invoice-archive", baseEnv({
    RUN_MODE: "apply",
    GOOGLE_DRIVE_INVOICE_FOLDER_ID: "",
    GOOGLE_SERVICE_ACCOUNT_JSON: "",
  }));

  assert.equal(dryRun.ok, true);
  assert.equal(apply.ok, false);
  assert.match(apply.errors.join("\n"), /GOOGLE_DRIVE_INVOICE_FOLDER_ID is required/);
  assert.match(apply.errors.join("\n"), /GOOGLE_SERVICE_ACCOUNT_JSON is required/);
});

test("config validator accepts Slack channel cleanup", () => {
  const result = validateConfig("slack-channel-cleanup", baseEnv());

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("config validator rejects invalid Slack channel cleanup hour", () => {
  const result = validateConfig("slack-channel-cleanup", baseEnv({
    CHANNEL_CLEANUP_REQUIRE_KST_HOUR: "24",
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /CHANNEL_CLEANUP_REQUIRE_KST_HOUR must be <= 23/);
});

test("config validator rejects invalid invoice same-day reminder hour", () => {
  const result = validateConfig("invoice-request", baseEnv({
    INVOICE_SAME_DAY_SECOND_REMINDER_HOUR: "24",
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /INVOICE_SAME_DAY_SECOND_REMINDER_HOUR must be <= 23/);
});

test("config validator rejects invalid invoice pre-deadline reminder hour", () => {
  const result = validateConfig("invoice-request", baseEnv({
    INVOICE_PRE_DEADLINE_REMINDER_HOUR: "24",
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /INVOICE_PRE_DEADLINE_REMINDER_HOUR must be <= 23/);
});

test("config validator rejects unknown jobs", () => {
  const result = validateConfig("unknown-job", baseEnv());

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Unknown job/);
});
