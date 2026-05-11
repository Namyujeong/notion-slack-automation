import assert from "node:assert/strict";
import test from "node:test";

import {
  formatFindings,
  scanTextForSecrets,
} from "../scripts/check-secrets.mjs";

test("secret scanner reports token locations without exposing values", () => {
  const slackToken = `xoxb-${"1".repeat(12)}-${"2".repeat(12)}-${"a".repeat(24)}`;
  const notionToken = `ntn_${"A".repeat(40)}`;
  const findings = scanTextForSecrets([
    "safe line",
    `SLACK_BOT_TOKEN=${slackToken}`,
    `NOTION_TOKEN=${notionToken}`,
  ].join("\n"), "example.env");

  assert.deepEqual(findings, [
    { filePath: "example.env", line: 2, label: "Slack token" },
    { filePath: "example.env", line: 3, label: "Notion integration token" },
  ]);

  const formatted = formatFindings(findings);
  assert.match(formatted, /example\.env:2 Slack token/);
  assert.equal(formatted.includes(slackToken), false);
  assert.equal(formatted.includes(notionToken), false);
});

test("secret scanner allows documented placeholder values", () => {
  const findings = scanTextForSecrets([
    "NOTION_TOKEN=ntn_xxx",
    "SLACK_BOT_TOKEN=xoxb_xxx",
  ].join("\n"), ".env.example");

  assert.deepEqual(findings, []);
});
