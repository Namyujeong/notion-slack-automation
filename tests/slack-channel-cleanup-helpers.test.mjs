import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateStatus,
  defaultNotice,
  hourInSeoul,
  skipReason,
  splitCsv,
} from "../lib/slack-channel-cleanup-helpers.mjs";

test("channel cleanup helper parses comma lists", () => {
  assert.deepEqual(splitCsv("#foo, bar, ,BAZ"), ["foo", "bar", "baz"]);
});

test("channel cleanup helper skips protected channels", () => {
  assert.equal(skipReason({ name: "general", is_general: true }), "skip_general");
  assert.equal(skipReason({ name: "hr-benefits" }), "skip_allowlist_prefix");
  assert.equal(skipReason({ name: "client", is_ext_shared: true }), "skip_shared_channel");
});

test("channel cleanup helper marks inactive candidates", () => {
  const cutoff = new Date("2026-01-01T00:00:00.000Z");
  const inactive = candidateStatus({
    latestAt: new Date("2025-12-31T00:00:00.000Z"),
    latestError: "",
    cutoff,
  });
  const active = candidateStatus({
    latestAt: new Date("2026-01-02T00:00:00.000Z"),
    latestError: "",
    cutoff,
  });

  assert.equal(inactive.candidate, true);
  assert.equal(active.candidate, false);
});

test("channel cleanup helper formats Korean notice", () => {
  const notice = defaultNotice({ inactiveDays: 365, archiveAfterDate: "2026-06-01" });
  assert.match(notice, /채널 자동 아카이브 예정 안내/);
  assert.match(notice, /2026-06-01/);
});

test("channel cleanup helper reads Korea hour", () => {
  assert.equal(hourInSeoul(new Date("2026-05-01T05:00:00.000Z")), 14);
});
