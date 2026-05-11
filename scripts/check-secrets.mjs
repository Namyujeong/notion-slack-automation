#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const SECRET_PATTERNS = [
  {
    label: "Slack token",
    regex: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    label: "Notion integration token",
    regex: /\bntn_[A-Za-z0-9]{30,}\b/g,
  },
  {
    label: "GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g,
  },
  {
    label: "Slack incoming webhook",
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{30,}/g,
  },
  {
    label: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    label: "Private key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
  },
  {
    label: "Google service account private_key",
    regex: /"private_key"\s*:\s*"-----BEGIN/g,
  },
];

function lineNumberForIndex(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

export function scanTextForSecrets(text, filePath = "<text>") {
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      findings.push({
        filePath,
        line: lineNumberForIndex(text, match.index || 0),
        label: pattern.label,
      });
    }
  }
  return findings;
}

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"]);
  return output.toString("utf8").split("\0").filter(Boolean);
}

function isProbablyBinary(buffer) {
  return buffer.includes(0);
}

export function scanTrackedFiles(files = trackedFiles()) {
  const findings = [];
  for (const filePath of files) {
    const buffer = fs.readFileSync(filePath);
    if (isProbablyBinary(buffer)) continue;
    findings.push(...scanTextForSecrets(buffer.toString("utf8"), filePath));
  }
  return findings;
}

export function formatFindings(findings) {
  return findings
    .map((finding) => `${finding.filePath}:${finding.line} ${finding.label}`)
    .join("\n");
}

export function main() {
  const findings = scanTrackedFiles();
  if (findings.length) {
    console.error("Potential committed secrets found. Values are redacted; inspect these locations:");
    console.error(formatFindings(findings));
    process.exitCode = 1;
    return;
  }

  console.log("No committed secrets found.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
