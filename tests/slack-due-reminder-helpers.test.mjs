import assert from "node:assert/strict";
import test from "node:test";

import {
  dueDateLabel,
  getDueDate,
  getTitle,
  isDone,
  isDueInReminderWindow,
  reminderKey,
  reminderWindowText,
} from "../lib/slack-due-reminder-helpers.mjs";

function titleProperty(content) {
  return { type: "title", title: content ? [{ type: "text", text: { content }, plain_text: content }] : [] };
}

function dateProperty(start, end = null) {
  return { type: "date", date: { start, end } };
}

test("issue title falls back to 제목 없음 when Notion title is empty", () => {
  assert.equal(getTitle({ properties: { Name: titleProperty("계약 갱신") } }), "계약 갱신");
  assert.equal(getTitle({ properties: { Name: titleProperty("") } }), "제목 없음");
  assert.equal(getTitle({ properties: {} }), "제목 없음");
});

test("due date uses Notion end date before start date", () => {
  const page = {
    properties: {
      "Due date": dateProperty("2026-05-01", "2026-05-03"),
    },
  };

  assert.equal(getDueDate(page, "Due date"), "2026-05-03");
});

test("due reminder window includes overdue and tomorrow issues within lookback", () => {
  const overdue = { properties: { "Due date": dateProperty("2026-04-20") } };
  const tomorrow = { properties: { "Due date": dateProperty("2026-05-04") } };
  const tooOld = { properties: { "Due date": dateProperty("2026-03-31") } };
  const later = { properties: { "Due date": dateProperty("2026-05-05") } };
  const window = { startDate: "2026-04-03", targetDate: "2026-05-04" };

  assert.equal(isDueInReminderWindow(overdue, "Due date", window), true);
  assert.equal(isDueInReminderWindow(tomorrow, "Due date", window), true);
  assert.equal(isDueInReminderWindow(tooOld, "Due date", window), false);
  assert.equal(isDueInReminderWindow(later, "Due date", window), false);
});

test("due date labels distinguish overdue, today, and tomorrow", () => {
  const context = { todayDate: "2026-05-03", tomorrowDate: "2026-05-04" };

  assert.equal(dueDateLabel("2026-05-02", context), "`2026-05-02 기한 지남`");
  assert.equal(dueDateLabel("2026-05-03", context), "`2026-05-03 오늘 마감`");
  assert.equal(dueDateLabel("2026-05-04", context), "`2026-05-04 내일 마감`");
});

test("done detection handles checkbox, status, and select properties", () => {
  assert.equal(isDone({ properties: { Done: { type: "checkbox", checkbox: true } } }), true);
  assert.equal(isDone({ properties: { Status: { type: "status", status: { name: "완료" } } } }), true);
  assert.equal(isDone({ properties: { Status: { type: "select", select: { name: "Canceled" } } } }), true);
  assert.equal(isDone({ properties: { Status: { type: "status", status: { name: "In progress" } } } }), false);
});

test("reminder key and window text stay stable", () => {
  assert.equal(reminderKey("page-id", "notion-user-id", "2026-05-04"), "2026-05-04:page-id:notion-user-id");
  assert.equal(
    reminderWindowText({ todayDate: "2026-05-03", targetDate: "2026-05-04", tomorrowDate: "2026-05-04" }),
    "오늘(2026-05-03) 또는 내일(2026-05-04)까지",
  );
});
