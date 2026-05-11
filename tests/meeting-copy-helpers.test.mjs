import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMeetingSlackMessage,
  buildMeetingTarget,
  checkInCopyEntries,
  childDatabaseReference,
  childDatabaseCopyMode,
  childDatabaseDisplayTitle,
  dateInTimeZone,
  formatMeetingShortDate,
  isDoneChecked,
  notionIdFromUrl,
  parseChildDatabaseReferences,
  replaceMeetingText,
  scrubTemperatureCheckComments,
  shouldCopyChildDatabaseRows,
  shouldSkipMeetingForHoliday,
  tableViewWrapConfiguration,
} from "../lib/meeting-copy-helpers.mjs";

function text(content) {
  return { type: "text", text: { content }, plain_text: content };
}

function userMention(id) {
  return { type: "mention", mention: { type: "user", user: { id } }, plain_text: "@" };
}

function heading(content, type = "heading_2") {
  return { type, [type]: { rich_text: [text(content)] } };
}

function paragraph(richText) {
  return { type: "paragraph", paragraph: { rich_text: richText } };
}

function toDo(checked) {
  return { type: "to_do", to_do: { rich_text: [], checked } };
}

test("meeting target date and title are derived in Asia/Seoul", () => {
  const date = dateInTimeZone(1, {
    now: new Date("2026-05-03T15:30:00.000Z"),
    timeZone: "Asia/Seoul",
  });
  const target = buildMeetingTarget({ targetDate: date, titleSuffix: "Operations" });

  assert.equal(date, "2026-05-05");
  assert.deepEqual(target, {
    targetDate: "2026-05-05",
    targetTitle: "2026-05-05 Operations",
  });
});

test("source meeting title and date are replaced in copied rich text content", () => {
  assert.equal(
    replaceMeetingText("2026-04-28 Operations / 2026-04-28", {
      sourceTitle: "2026-04-28 Operations",
      sourceDate: "2026-04-28",
      targetTitle: "2026-05-05 Operations",
      targetDate: "2026-05-05",
    }),
    "2026-05-05 Operations / 2026-05-05",
  );
});

test("meeting Slack notification uses short date and linked Notion URL", () => {
  assert.equal(formatMeetingShortDate("2026-05-11"), "26-05-11");
  assert.equal(
    buildMeetingSlackMessage({
      mention: "<!subteam^S1234567890|team>",
      url: "https://www.notion.so/example/2026-05-11-team-weekly-example",
      targetDate: "2026-05-11",
    }),
    "<!subteam^S1234567890|team> <https://www.notion.so/example/2026-05-11-team-weekly-example> 26-05-11 주간 회의 회의록입니다. 갱신 부탁드립니다.",
  );
});

test("meeting creation is skipped only when holiday skipping is enabled", () => {
  const holiday = { isHoliday: true, name: "어린이날" };

  assert.equal(shouldSkipMeetingForHoliday({ skipKoreanHolidays: true, holiday }), true);
  assert.equal(shouldSkipMeetingForHoliday({ skipKoreanHolidays: false, holiday }), false);
  assert.equal(shouldSkipMeetingForHoliday({ skipKoreanHolidays: true, holiday: { isHoliday: false } }), false);
});

test("temperature check copy leaves only user mentions and blank comment slots", () => {
  const blocks = [
    heading("온도 체크"),
    paragraph([userMention("user-a")]),
    paragraph([text("이번 주 코멘트")]),
    heading("Agenda"),
    paragraph([text("보존할 내용")]),
  ];

  const { blocks: scrubbed, stats } = scrubTemperatureCheckComments(blocks);

  assert.equal(stats.temperatureMentionCount, 1);
  assert.equal(stats.temperatureBlankBlockCount, 1);
  assert.equal(stats.temperatureRemovedBlockCount, 1);
  assert.equal(scrubbed.length, 5);
  assert.equal(scrubbed[1], blocks[1]);
  assert.deepEqual(scrubbed[2].paragraph.rich_text, []);
  assert.equal(scrubbed[3], blocks[3]);
  assert.equal(scrubbed[4], blocks[4]);
});

test("Check-in to-do blocks are marked for unchecked copy until the next heading", () => {
  const blocks = [
    heading("Check-in"),
    toDo(true),
    paragraph([text("메모")]),
    heading("Agenda"),
    toDo(true),
  ];

  const entries = checkInCopyEntries(blocks);

  assert.equal(entries[1].resetToDoChecked, true);
  assert.equal(entries[2].resetToDoChecked, true);
  assert.equal(entries[4].resetToDoChecked, false);
});

test("child Agenda DB rows with Done checkbox are excluded from copy", () => {
  assert.equal(isDoneChecked({ properties: { Done: { type: "checkbox", checkbox: true } } }), true);
  assert.equal(isDoneChecked({ properties: { "": { type: "checkbox", checkbox: true } } }), true);
  assert.equal(isDoneChecked({ properties: { Reviewed: { type: "checkbox", checkbox: true } } }), false);
});

test("child database rows can be copied as schema only by mode or title", () => {
  assert.equal(shouldCopyChildDatabaseRows({ title: "Agenda" }), true);
  assert.equal(shouldCopyChildDatabaseRows({ title: "Agenda", copyMode: "schema_only" }), false);
  assert.equal(
    shouldCopyChildDatabaseRows({
      title: "Tracking",
      schemaOnlyTitles: ["Decision", "Tracking"],
    }),
    false,
  );
  assert.throws(
    () => shouldCopyChildDatabaseRows({ title: "Agenda", copyMode: "bad_mode" }),
    /Unsupported child database copy mode/,
  );
});

test("child database copy mode can skip central data duplicated in meeting notes", () => {
  assert.equal(childDatabaseCopyMode({ title: "휴가 공유", copyMode: "skip" }), "skip");
  assert.equal(childDatabaseCopyMode({ title: "Tracking", skipTitles: ["Tracking"] }), "skip");
  assert.equal(childDatabaseCopyMode({ title: "Tracking", schemaOnlyTitles: ["Tracking"] }), "schema_only");
  assert.equal(childDatabaseCopyMode({ title: "Agenda" }), "copy_non_done");
});

test("child database reference resolves title-specific and fallback links", () => {
  const references = parseChildDatabaseReferences(JSON.stringify({
    Tracking: { url: "https://notion.so/tracking", text: "Operations Tracking" },
  }));

  assert.deepEqual(
    childDatabaseReference({ title: "Tracking", references }),
    { url: "https://notion.so/tracking", text: "Operations Tracking" },
  );
  assert.deepEqual(
    childDatabaseReference({
      title: "아젠다",
      references,
      fallbackUrl: "https://notion.so/operations",
      fallbackText: "Operations Agenda",
    }),
    { url: "https://notion.so/operations", text: "Operations Agenda" },
  );
});

test("child database references can use a section title when the source view is untitled", () => {
  assert.equal(childDatabaseDisplayTitle("Untitled", "휴가 공유"), "휴가 공유");
  assert.equal(childDatabaseDisplayTitle("Agenda", "휴가 공유"), "Agenda");
});

test("copied child database table views are configured to wrap cell content", () => {
  assert.deepEqual(tableViewWrapConfiguration(), {
    type: "table",
    wrap_cells: true,
  });
  assert.deepEqual(tableViewWrapConfiguration({ wrapCells: false }), {
    type: "table",
    wrap_cells: false,
  });
});

test("notion IDs can be extracted from plain and slugged Notion URLs", () => {
  assert.equal(
    notionIdFromUrl("https://www.notion.so/11111111111111111111111111111111"),
    "11111111-1111-1111-1111-111111111111",
  );
  assert.equal(
    notionIdFromUrl("https://www.notion.so/example/2026-05-11-team-weekly-22222222222222222222222222222222"),
    "22222222-2222-2222-2222-222222222222",
  );
});
