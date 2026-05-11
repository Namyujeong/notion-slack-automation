#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as archiveHelpers from "../../lib/invoice-attachment-archive-helpers.mjs";

const DEFAULT_INVOICE_CHANNEL_ID = "";
const DEFAULT_INVOICE_STATE_FILE = ".slack-invoice-request-state.json";
const DEFAULT_ARCHIVE_STATE_FILE = ".slack-invoice-archive-state.json";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

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
await loadEnvFile(path.join(process.cwd(), ".env.invoice.local"), { override: true });
await loadEnvFile(path.join(process.cwd(), ".env.google.local"), { override: true });

const dryRun = argv.has("--dry-run") || !argv.has("--apply");
const dryRunCheckSlack = argv.has("--check-slack") || process.env.INVOICE_ARCHIVE_DRY_RUN_CHECK_SLACK === "1";
const todayDate = argValue("--today") || dateInSeoul();
const targetPeriod = argValue("--period") || process.env.INVOICE_ARCHIVE_PERIOD || null;
const slackToken = process.env.SLACK_BOT_TOKEN;
const channelId = process.env.INVOICE_SLACK_CHANNEL_ID
  || process.env.SLACK_INVOICE_CHANNEL_ID
  || DEFAULT_INVOICE_CHANNEL_ID;
const invoiceStateFile = process.env.INVOICE_STATE_FILE || DEFAULT_INVOICE_STATE_FILE;
const archiveStateFile = process.env.INVOICE_ARCHIVE_STATE_FILE || DEFAULT_ARCHIVE_STATE_FILE;
const driveRootFolderId = process.env.GOOGLE_DRIVE_INVOICE_FOLDER_ID || process.env.INVOICE_DRIVE_FOLDER_ID || null;
const lookbackDays = Number(process.env.INVOICE_ARCHIVE_LOOKBACK_DAYS || "60");
const onlyTargetUserFiles = process.env.INVOICE_ARCHIVE_ONLY_TARGET_USER_FILES !== "0";
const statusFileEnabled = process.env.INVOICE_ARCHIVE_STATUS_FILE !== "0";
const folderLayout = process.env.INVOICE_ARCHIVE_FOLDER_LAYOUT || "fiscal-year/period";
const maxFilesPerRun = Number(process.env.INVOICE_ARCHIVE_MAX_FILES_PER_RUN || "100");
const googleDriveScope = process.env.GOOGLE_DRIVE_SCOPE || GOOGLE_DRIVE_SCOPE;
let cachedGoogleAccessToken = null;

if (!dryRun && !slackToken) throw new Error("SLACK_BOT_TOKEN is required for --apply.");
if (!dryRun && !driveRootFolderId) throw new Error("GOOGLE_DRIVE_INVOICE_FOLDER_ID is required for --apply.");

function dateInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBetween(a, b) {
  return archiveHelpers.daysBetween(a, b);
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function escapeDriveQueryText(text = "") {
  return String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function archiveFileName(request, file) {
  return archiveHelpers.archiveFileName(request, file);
}

function slackFileUrl(file) {
  return archiveHelpers.slackFileUrl(file);
}

function slackFileName(file) {
  return archiveHelpers.slackFileName(file);
}

function requestSortKey(request) {
  return archiveHelpers.requestSortKey(request);
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

async function slack(method, params = {}, { httpMethod = "GET" } = {}) {
  if (!slackToken) throw new Error("SLACK_BOT_TOKEN is required.");
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
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

async function threadReplies(request) {
  const messages = [];
  let cursor = null;
  do {
    const data = await slack("conversations.replies", {
      channel: request.channelId || channelId,
      ts: request.parentTs,
      limit: 200,
      cursor,
    });
    messages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);
  return messages;
}

function collectThreadFiles(request, messages, archiveState) {
  return archiveHelpers.collectThreadFiles(request, messages, archiveState, { onlyTargetUserFiles });
}

async function loadServiceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    return JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8"));
  }

  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (!jsonPath) {
    throw new Error("Set GOOGLE_SERVICE_ACCOUNT_JSON_PATH or GOOGLE_SERVICE_ACCOUNT_JSON.");
  }
  return JSON.parse(await fs.readFile(path.resolve(process.cwd(), jsonPath), "utf8"));
}

async function googleAccessToken() {
  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedGoogleAccessToken.token;
  }

  const serviceAccount = await loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: googleDriveScope,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key.replace(/\\n/g, "\n"));
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google token request failed: ${data.error_description || data.error || response.statusText}`);
  cachedGoogleAccessToken = {
    token: data.access_token,
    expiresAtMs: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return cachedGoogleAccessToken.token;
}

async function driveJson(method, pathname, body = null) {
  const token = await googleAccessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Drive ${method} ${pathname} failed: ${data.error?.message || response.statusText}`);
  return data;
}

async function findChild(parentId, name, { folder = false } = {}) {
  const queryParts = [
    `'${escapeDriveQueryText(parentId)}' in parents`,
    `name = '${escapeDriveQueryText(name)}'`,
    "trashed = false",
  ];
  if (folder) queryParts.push(`mimeType = '${DRIVE_FOLDER_MIME}'`);
  const params = new URLSearchParams({
    q: queryParts.join(" and "),
    spaces: "drive",
    fields: "files(id,name,mimeType,webViewLink)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = await driveJson("GET", `/files?${params.toString()}`);
  return data.files?.[0] || null;
}

async function createFolder(parentId, name) {
  return driveJson("POST", "/files?supportsAllDrives=true&fields=id,name,webViewLink", {
    name,
    mimeType: DRIVE_FOLDER_MIME,
    parents: [parentId],
  });
}

async function ensureFolder(parentId, name) {
  const existing = await findChild(parentId, name, { folder: true });
  if (existing) return existing;
  return createFolder(parentId, name);
}

function folderSegmentsForRequest(request) {
  return archiveHelpers.folderSegmentsForRequest(request, { folderLayout, todayDate });
}

function periodFolderSegments(period) {
  return archiveHelpers.periodFolderSegments(period, { folderLayout, todayDate });
}

async function ensureFolderPath(segments) {
  if (!driveRootFolderId) return null;
  let folder = { id: driveRootFolderId, name: "root" };

  for (const segment of segments) {
    folder = await ensureFolder(folder.id, segment);
  }
  return folder;
}

async function ensureRequestFolder(request) {
  return ensureFolderPath(folderSegmentsForRequest(request));
}

async function ensurePeriodFolder(period) {
  return ensureFolderPath(periodFolderSegments(period));
}

function multipartBody(metadata, contentBuffer, mimeType, boundary) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    contentBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

async function driveUpload({ name, parentId, contentBuffer, mimeType, existingFileId = null }) {
  const token = await googleAccessToken();
  const boundary = `invoice_archive_${crypto.randomUUID()}`;
  const metadata = { name };
  if (parentId && !existingFileId) metadata.parents = [parentId];
  const pathname = existingFileId
    ? `/upload/drive/v3/files/${existingFileId}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`
    : "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink";
  const response = await fetch(`https://www.googleapis.com${pathname}`, {
    method: existingFileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody(metadata, contentBuffer, mimeType, boundary),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Drive upload failed: ${data.error?.message || response.statusText}`);
  return data;
}

async function downloadSlackFile(file) {
  const url = slackFileUrl(file);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${slackToken}` },
  });
  if (!response.ok) throw new Error(`Slack file download failed for ${file.id}: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

function relevantRequests(invoiceState) {
  const cutoffDate = todayDate;
  return Object.values(invoiceState.requests || {})
    .filter((request) => request.parentTs)
    .filter((request) => !targetPeriod || request.period === targetPeriod)
    .filter((request) => {
      const date = request.requestDate || request.scheduledRequestDate || request.period?.replace(/$/, "-01");
      if (!date) return true;
      return daysBetween(cutoffDate, date.slice(0, 10)) <= lookbackDays;
    })
    .sort((a, b) => requestSortKey(a).localeCompare(requestSortKey(b)));
}

function buildStatusMarkdown(period, requests, archiveState) {
  return archiveHelpers.buildStatusMarkdown(period, requests, archiveState);
}

async function upsertStatusFiles(requests, archiveState, periodFolders) {
  const results = [];
  const periods = [...new Set(requests.map((request) => request.period).filter(Boolean))];
  for (const period of periods) {
    const periodFolder = periodFolders.get(period) || await ensurePeriodFolder(period);
    periodFolders.set(period, periodFolder);
    const name = `_status_${period}.md`;
    const existing = await findChild(periodFolder.id, name, { folder: false });
    const uploaded = await driveUpload({
      name,
      parentId: periodFolder.id,
      existingFileId: existing?.id || null,
      mimeType: "text/markdown; charset=utf-8",
      contentBuffer: Buffer.from(buildStatusMarkdown(period, requests, archiveState), "utf8"),
    });
    results.push({ period, fileId: uploaded.id, webViewLink: uploaded.webViewLink });
  }
  return results;
}

async function archiveOne(collected, archiveState, periodFolders) {
  const { request, messageTs, file } = collected;
  const folder = await ensureRequestFolder(request);
  periodFolders.set(request.period, await ensurePeriodFolder(request.period));

  const contentBuffer = await downloadSlackFile(file);
  const uploaded = await driveUpload({
    name: archiveFileName(request, file),
    parentId: folder.id,
    contentBuffer,
    mimeType: file.mimetype || file.filetype || "application/octet-stream",
  });
  archiveState.files[file.id] = {
    requestKey: request.key,
    period: request.period,
    targetName: request.targetName,
    slackUserId: request.slackUserId,
    slackFileId: file.id,
    slackFileName: slackFileName(file),
    slackMessageTs: messageTs,
    driveFileId: uploaded.id,
    driveFileName: uploaded.name,
    driveWebViewLink: uploaded.webViewLink,
    archivedAt: new Date().toISOString(),
  };
  return archiveState.files[file.id];
}

const invoiceState = await readJsonFile(invoiceStateFile, { requests: {} });
const archiveState = await readJsonFile(archiveStateFile, { version: 1, files: {} });
archiveState.version = 1;
archiveState.files = archiveState.files || {};

const requests = relevantRequests(invoiceState);
const results = {
  status: dryRun ? "dry_run" : "completed",
  dryRun,
  dryRunCheckSlack,
  todayDate,
  channelId,
  invoiceStateFile,
  archiveStateFile,
  driveRootFolderId,
  folderLayout,
  lookbackDays,
  targetPeriod,
  requestCount: requests.length,
  candidateFileCount: 0,
  archivedFileCount: 0,
  skippedFileCount: 0,
  failedFileCount: 0,
  requests: requests.map((request) => ({
    key: request.key,
    period: request.period,
    targetName: request.targetName,
    slackUserId: request.slackUserId,
    parentTs: request.parentTs,
  })),
  archivedFiles: [],
  skippedFiles: [],
  failedFiles: [],
  statusFiles: [],
};

if (dryRun && !dryRunCheckSlack) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

if (!slackToken) throw new Error("SLACK_BOT_TOKEN is required to scan Slack threads.");
if (!dryRun && !driveRootFolderId) throw new Error("GOOGLE_DRIVE_INVOICE_FOLDER_ID is required for --apply.");

const collectedFiles = [];
for (const request of requests) {
  const messages = await threadReplies(request);
  collectedFiles.push(...collectThreadFiles(request, messages, archiveState));
}

results.candidateFileCount = collectedFiles.length;

if (dryRun) {
  results.candidateFiles = collectedFiles.map(({ request, messageTs, file }) => ({
    requestKey: request.key,
    period: request.period,
    targetName: request.targetName,
    slackFileId: file.id,
    slackFileName: slackFileName(file),
    slackMessageTs: messageTs,
    targetDriveFileName: archiveFileName(request, file),
  }));
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const periodFolders = new Map();
for (const collected of collectedFiles.slice(0, maxFilesPerRun)) {
  try {
    const archived = await archiveOne(collected, archiveState, periodFolders);
    results.archivedFileCount += 1;
    results.archivedFiles.push(archived);
  } catch (error) {
    results.failedFileCount += 1;
    results.failedFiles.push({
      requestKey: collected.request.key,
      slackFileId: collected.file.id,
      slackFileName: slackFileName(collected.file),
      error: error.message,
    });
  }
}

if (collectedFiles.length > maxFilesPerRun) {
  for (const collected of collectedFiles.slice(maxFilesPerRun)) {
    results.skippedFileCount += 1;
    results.skippedFiles.push({
      requestKey: collected.request.key,
      slackFileId: collected.file.id,
      slackFileName: slackFileName(collected.file),
      reason: "max_files_per_run",
    });
  }
}

if (statusFileEnabled && driveRootFolderId) {
  results.statusFiles = await upsertStatusFiles(requests, archiveState, periodFolders);
}

await writeJsonFile(archiveStateFile, archiveState);

if (results.failedFileCount) results.status = "completed_with_failures";
console.log(JSON.stringify(results, null, 2));
if (results.failedFileCount) process.exitCode = 1;
