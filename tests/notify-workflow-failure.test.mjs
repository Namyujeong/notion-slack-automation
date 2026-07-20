import assert from "node:assert/strict";
import test from "node:test";

import { buildFailureMessage, notifyFailure } from "../scripts/notify-workflow-failure.mjs";

const silentLogger = { log() {}, warn() {} };

test("failure notification message includes workflow context and action link", () => {
  const message = buildFailureMessage({
    AUTOMATION_NAME: "Slack issue due reminder",
    GITHUB_REPOSITORY: "example/notion-slack-automation",
    GITHUB_JOB: "run",
    RUN_MODE: "apply",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: "abcdef1234567890",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "2",
  });

  assert.match(message, /Automation failed/);
  assert.match(message, /Slack issue due reminder/);
  assert.match(message, /example\/notion-slack-automation/);
  assert.match(message, /https:\/\/github\.com\/example\/notion-slack-automation\/actions\/runs\/123456/);
  assert.match(message, /attempt 2/);
});

test("failure notification skips when webhook is not configured", async () => {
  const result = await notifyFailure({
    webhookUrl: "",
    message: "failure",
    logger: silentLogger,
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });

  assert.deepEqual(result, { skipped: true });
});

test("failure notification posts redacted workflow message to Slack webhook", async () => {
  let request = null;
  const result = await notifyFailure({
    webhookUrl: "https://hooks.example.test/services/fake",
    message: "failure",
    logger: silentLogger,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    },
  });

  assert.deepEqual(result, { skipped: false, ok: true });
  assert.equal(request.url, "https://hooks.example.test/services/fake");
  assert.equal(JSON.parse(request.options.body).text, "failure");
});
