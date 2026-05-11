import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReminderText,
  envBool,
  extractUserMentions,
  extractUsergroupMentions,
  filterExcludedUserIds,
  inactiveSlackUserReason,
  isActiveSlackReminderTarget,
  messageKey,
  messageSearchText,
  shouldSendReminder,
  sourceDateInSeoul,
  splitCanonicalDailySourceMessages,
  splitUserIds,
} from "../lib/flex-reaction-reminder-helpers.mjs";

test("flex helper parses boolean and explicit target user lists", () => {
  assert.equal(envBool("yes"), true);
  assert.equal(envBool("0"), false);
  assert.deepEqual(splitUserIds("U1, U2\nU3"), ["U1", "U2", "U3"]);
});

test("flex helper filters configured excluded user ids", () => {
  assert.deepEqual(
    filterExcludedUserIds(["U1", "U2", "U3"], ["U2", "U4"]),
    { includedUserIds: ["U1", "U3"], excludedUserIds: ["U2"] },
  );
});

test("flex message search text includes blocks and attachments for marker matching", () => {
  const message = {
    text: "본문",
    blocks: [{ text: { text: "Flex 승인" } }],
    attachments: [{ fallback: "결재 확인" }],
  };

  assert.equal(messageSearchText(message), "본문\nFlex 승인\n결재 확인");
});

test("flex reminder target extraction deduplicates user and usergroup mentions", () => {
  const message = {
    text: "<@U111AAA> <@U111AAA> <!subteam^S222BBB|ops>",
    blocks: [{ text: { text: "<@U333CCC> <!subteam^S222BBB|ops>" } }],
  };

  assert.deepEqual(extractUserMentions(message), ["U111AAA", "U333CCC"]);
  assert.deepEqual(extractUsergroupMentions(message), ["S222BBB"]);
});

test("flex reminder interval prevents repeated reminders too soon", () => {
  const nowMs = Date.parse("2026-05-03T01:00:00.000Z");

  assert.equal(shouldSendReminder({}, nowMs, { reminderIntervalMinutes: 60 }), true);
  assert.equal(shouldSendReminder({ lastRemindedAtMs: nowMs - 30 * 60_000 }, nowMs, { reminderIntervalMinutes: 60 }), false);
  assert.equal(shouldSendReminder({ lastRemindedAtMs: nowMs - 61 * 60_000 }, nowMs, { reminderIntervalMinutes: 60 }), true);
});

test("flex inactive Slack user detection excludes deleted and non-human accounts", () => {
  assert.equal(isActiveSlackReminderTarget({ id: "U111AAA", deleted: false, is_bot: false, is_app_user: false }), true);
  assert.equal(inactiveSlackUserReason({ id: "U222BBB", deleted: true }), "deleted");
  assert.equal(inactiveSlackUserReason({ id: "U333CCC", is_bot: true }), "bot");
  assert.equal(inactiveSlackUserReason({ id: "U444DDD", is_app_user: true }), "app_user");
  assert.equal(inactiveSlackUserReason(null), "missing");
});

test("flex reminder text switches to final reminder at the configured limit", () => {
  const text = buildReminderText(["U111AAA", "U333CCC"], 3, 5, 3, {
    maxReminders: 3,
    reactionName: "white_check_mark",
  });

  assert.match(text, /^\[최종 리마인드 3\/3\]/);
  assert.match(text, /<@U111AAA> <@U333CCC>/);
  assert.match(text, /현재 완료: 3\/5/);
});

test("flex state key includes channel and message timestamp", () => {
  assert.equal(messageKey("COPS", "1714700000.000100"), "COPS:1714700000.000100");
});

test("flex duplicate source detection keeps only the first source per KST date", () => {
  assert.equal(sourceDateInSeoul("1777861091.682029"), "2026-05-04");

  const first = { ts: "1777861091.682029", text: "[Flex 승인 리마인드]" };
  const duplicate = { ts: "1777885207.542319", text: "[Flex 승인 리마인드]" };
  const nextWeek = { ts: "1778465891.682029", text: "[Flex 승인 리마인드]" };
  const { canonicalMessages, duplicateMessages } = splitCanonicalDailySourceMessages([duplicate, nextWeek, first]);

  assert.deepEqual(canonicalMessages.map((message) => message.ts), [
    "1777861091.682029",
    "1778465891.682029",
  ]);
  assert.deepEqual(duplicateMessages.map(({ message, sourceDate, canonicalTs }) => ({
    ts: message.ts,
    sourceDate,
    canonicalTs,
  })), [{
    ts: "1777885207.542319",
    sourceDate: "2026-05-04",
    canonicalTs: "1777861091.682029",
  }]);
});
