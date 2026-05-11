#!/usr/bin/env node
import { pathToFileURL } from "node:url";

function slackEscape(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildFailureMessage(env = process.env) {
  const repository = env.GITHUB_REPOSITORY || "unknown repository";
  const workflow = env.AUTOMATION_NAME || env.GITHUB_WORKFLOW || "GitHub Actions workflow";
  const job = env.GITHUB_JOB || "run";
  const runId = env.GITHUB_RUN_ID || "";
  const runAttempt = env.GITHUB_RUN_ATTEMPT || "";
  const refName = env.GITHUB_REF_NAME || "";
  const sha = env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 7) : "";
  const mode = env.RUN_MODE || "";
  const serverUrl = env.GITHUB_SERVER_URL || "https://github.com";
  const runUrl = runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : `${serverUrl}/${repository}/actions`;

  return [
    `:warning: *Automation failed*: ${slackEscape(workflow)}`,
    `Repository: \`${slackEscape(repository)}\``,
    `Job: \`${slackEscape(job)}\`${mode ? ` / Mode: \`${slackEscape(mode)}\`` : ""}`,
    `Ref: \`${slackEscape(refName)}\`${sha ? ` / SHA: \`${sha}\`` : ""}`,
    `Run: <${runUrl}|open GitHub Actions>${runAttempt ? ` (attempt ${slackEscape(runAttempt)})` : ""}`,
  ].join("\n");
}

export async function notifyFailure({
  webhookUrl = process.env.SLACK_FAILURE_WEBHOOK_URL,
  message = buildFailureMessage(process.env),
  fetchImpl = fetch,
  logger = console,
} = {}) {
  if (!webhookUrl) {
    logger.log("SLACK_FAILURE_WEBHOOK_URL is not set; skipping failure notification.");
    return { skipped: true };
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.warn(`Slack failure notification was not delivered: ${response.status} ${response.statusText} ${text}`.trim());
    return { skipped: false, ok: false };
  }

  logger.log("Failure notification delivered.");
  return { skipped: false, ok: true };
}

export async function main() {
  try {
    await notifyFailure();
  } catch (error) {
    console.warn(`Slack failure notification failed: ${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
