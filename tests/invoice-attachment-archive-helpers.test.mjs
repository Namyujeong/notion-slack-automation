import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveFileName,
  buildStatusMarkdown,
  collectThreadFiles,
  folderSegmentsForRequest,
  periodFolderSegments,
  sanitizeFileName,
} from "../lib/invoice-attachment-archive-helpers.mjs";

test("invoice archive sanitizes Drive file names and prefixes request metadata", () => {
  const request = { period: "2026-05", targetName: "최/명진", targetKey: "u1" };
  const file = { id: "F123", name: "aws:invoice?.pdf" };

  assert.equal(sanitizeFileName("aws:invoice?.pdf"), "aws_invoice_.pdf");
  assert.equal(archiveFileName(request, file), "2026-05_최_명진_F123_aws_invoice_.pdf");
});

test("invoice archive collects only new files from the target user by default", () => {
  const request = { key: "2026-05:U123", slackUserId: "U123" };
  const messages = [
    {
      ts: "1.1",
      user: "U123",
      files: [
        { id: "FNEW", name: "new.pdf", url_private_download: "https://slack/files/new" },
        { id: "FOLD", name: "old.pdf", url_private_download: "https://slack/files/old" },
        { id: "FNOURI", name: "broken.pdf" },
      ],
    },
    {
      ts: "1.2",
      user: "U999",
      files: [{ id: "FOTHER", name: "other.pdf", url_private: "https://slack/files/other" }],
    },
  ];
  const archiveState = { files: { FOLD: { archivedAt: "2026-05-12T00:00:00.000Z" } } };

  const files = collectThreadFiles(request, messages, archiveState);

  assert.equal(files.length, 1);
  assert.equal(files[0].file.id, "FNEW");
  assert.equal(files[0].messageTs, "1.1");
});

test("invoice archive can include non-target user files when configured", () => {
  const request = { key: "2026-05:U123", slackUserId: "U123" };
  const messages = [{
    ts: "1.2",
    user: "U999",
    files: [{ id: "FOTHER", name: "other.pdf", url_private: "https://slack/files/other" }],
  }];

  const files = collectThreadFiles(request, messages, { files: {} }, { onlyTargetUserFiles: false });

  assert.equal(files.length, 1);
  assert.equal(files[0].file.id, "FOTHER");
});

test("invoice archive folder layout maps fiscal year, period, and target segments", () => {
  const request = { period: "2026-05", targetName: "최/명진", targetKey: "U123" };
  const options = { folderLayout: "fiscal-year/period/target", todayDate: "2026-05-12" };

  assert.deepEqual(folderSegmentsForRequest(request, options), ["FY2026", "2026-05", "최_명진"]);
  assert.deepEqual(periodFolderSegments("2026-05", options), ["FY2026", "2026-05"]);
});

test("invoice archive status markdown summarizes uploaded counts", () => {
  const requests = [
    { key: "2026-05:U123", period: "2026-05", targetName: "최명진", services: ["AWS"] },
    { key: "2026-05:U456", period: "2026-05", targetName: "노윤경", services: [] },
  ];
  const archiveState = {
    files: {
      F123: { requestKey: "2026-05:U123" },
    },
  };

  const markdown = buildStatusMarkdown("2026-05", requests, archiveState, {
    nowIso: "2026-05-12T00:00:00.000Z",
  });

  assert.match(markdown, /# 2026-05 인보이스 수집 현황/);
  assert.match(markdown, /\| 최명진 \| AWS \| 1 \| 수집됨 \|/);
  assert.match(markdown, /\| 노윤경 \| - \| 0 \| 대기 \|/);
  assert.match(markdown, /Updated: 2026-05-12T00:00:00.000Z/);
});
