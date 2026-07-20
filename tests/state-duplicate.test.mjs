import assert from "node:assert/strict";
import test from "node:test";

import {
  existingReminderResult,
  existingRequestResult,
  requestKey,
} from "../lib/invoice-request-helpers.mjs";

test("invoice request key prevents duplicate monthly request sends", () => {
  const target = { key: "U123ABC" };
  const key = requestKey("2026-04", target);
  const state = {
    requests: {
      [key]: { key, parentTs: "111.222" },
    },
  };

  assert.equal(key, "2026-04:U123ABC");
  assert.deepEqual(existingRequestResult({ state, key, force: false }), {
    status: "skipped",
    reason: "already_sent",
    key,
    request: state.requests[key],
  });
  assert.equal(existingRequestResult({ state, key, force: true }), null);
});

test("invoice reminder state prevents duplicate stage reminders", () => {
  const request = {
    key: "2026-04:U123ABC",
    reminders: {
      pre_deadline: { sentAt: "2026-05-13T01:00:00.000Z" },
    },
  };

  assert.deepEqual(existingReminderResult({ request, stage: "pre_deadline", force: false }), {
    status: "skipped",
    reason: "already_reminded",
    key: "2026-04:U123ABC",
    stage: "pre_deadline",
  });
  assert.equal(existingReminderResult({ request, stage: "pre_deadline", force: true }), null);
  assert.equal(existingReminderResult({ request, stage: "deadline_day", force: false }), null);
});
