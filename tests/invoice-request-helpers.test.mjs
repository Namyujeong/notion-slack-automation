import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvoiceScheduleContext,
  formatDeadline,
  formatPeriodLabel,
  isWeekend,
  normalizeTarget,
  quarterCatchupText,
  reminderStageForRequest,
} from "../lib/invoice-request-helpers.mjs";

const weekendOnlyBusinessDay = async (date) => !isWeekend(date);

function businessDayExcept(holidayDates = []) {
  const holidays = new Set(holidayDates);
  return async (date) => !isWeekend(date) && !holidays.has(date);
}

test("invoice auto schedule moves the 10th to the next business day and calculates deadline", async () => {
  const context = await buildInvoiceScheduleContext({
    todayDate: "2026-05-11",
    currentHour: 10,
    mode: "auto",
    requestDay: 10,
    requestHour: 10,
    deadlineBusinessDays: 3,
    isBusinessDay: weekendOnlyBusinessDay,
  });

  assert.equal(context.requestMonth, "2026-05");
  assert.equal(context.period, "2026-04");
  assert.equal(context.scheduledRequestDate, "2026-05-11");
  assert.equal(context.deadlineBaseDate, "2026-05-11");
  assert.equal(context.deadlineDate, "2026-05-14");
  assert.equal(context.preDeadlineDate, "2026-05-13");
  assert.equal(context.shouldSendRequests, true);
});

test("invoice auto schedule waits until the configured request hour", async () => {
  const context = await buildInvoiceScheduleContext({
    todayDate: "2026-05-11",
    currentHour: 9,
    mode: "auto",
    requestDay: 10,
    requestHour: 10,
    deadlineBusinessDays: 3,
    isBusinessDay: weekendOnlyBusinessDay,
  });

  assert.equal(context.shouldSendRequests, false);
});

test("invoice auto schedule skips holiday after weekend request day", async () => {
  const holidayBusinessDay = businessDayExcept(["2026-05-11"]);
  const holidayContext = await buildInvoiceScheduleContext({
    todayDate: "2026-05-11",
    currentHour: 10,
    mode: "auto",
    requestDay: 10,
    requestHour: 10,
    deadlineBusinessDays: 3,
    isBusinessDay: holidayBusinessDay,
  });

  assert.equal(holidayContext.scheduledRequestDate, "2026-05-12");
  assert.equal(holidayContext.todayIsBusinessDay, false);
  assert.equal(holidayContext.shouldSendRequests, false);

  const nextBusinessDayContext = await buildInvoiceScheduleContext({
    todayDate: "2026-05-12",
    currentHour: 10,
    mode: "auto",
    requestDay: 10,
    requestHour: 10,
    deadlineBusinessDays: 3,
    isBusinessDay: holidayBusinessDay,
  });

  assert.equal(nextBusinessDayContext.scheduledRequestDate, "2026-05-12");
  assert.equal(nextBusinessDayContext.deadlineBaseDate, "2026-05-12");
  assert.equal(nextBusinessDayContext.deadlineDate, "2026-05-15");
  assert.equal(nextBusinessDayContext.preDeadlineDate, "2026-05-14");
  assert.equal(nextBusinessDayContext.shouldSendRequests, true);
});

test("invoice formatting and quarter catch-up text are deterministic", () => {
  assert.equal(formatPeriodLabel("2026-04"), "2026년 4월");
  assert.equal(formatDeadline("2026-05-14"), "2026-05-14(목) 18:00 KST");
  assert.equal(
    quarterCatchupText("2026-04"),
    "이번 달은 분기 정산 월입니다. 2026년 1분기(1~3월) 누락분이 있으면 함께 올려주세요.",
  );
  assert.equal(quarterCatchupText("2026-05"), null);
});

test("invoice targets normalize Slack mentions and service metadata", () => {
  const target = normalizeTarget({
    name: "최명진",
    mention: "<@U123ABC>",
    services: [{ name: "AWS", note: "EC2", cadence: "monthly" }],
  }, 0);

  assert.deepEqual(target, {
    key: "U123ABC",
    slackUserId: "U123ABC",
    name: "최명진",
    services: ["AWS - EC2 (monthly)"],
  });
});

test("invoice reminder stage respects pre-deadline and deadline-day timing", () => {
  const request = {
    requestDate: "2026-05-11",
    deadlineDate: "2026-05-14",
    preDeadlineDate: "2026-05-13",
    status: "requested",
  };

  assert.equal(reminderStageForRequest(request, { remindersEnabled: true, todayDate: "2026-05-11", currentHour: 14 }), null);
  assert.equal(reminderStageForRequest(request, { remindersEnabled: true, todayDate: "2026-05-11", currentHour: 15 }), "same_day_first");
  assert.equal(reminderStageForRequest(request, { remindersEnabled: true, todayDate: "2026-05-11", currentHour: 18 }), "same_day_first");
  assert.equal(
    reminderStageForRequest(
      { ...request, reminders: { same_day_first: { sentAt: "2026-05-11T06:00:00.000Z" } } },
      { remindersEnabled: true, todayDate: "2026-05-11", currentHour: 18 },
    ),
    "same_day_second",
  );
  assert.equal(reminderStageForRequest(request, { remindersEnabled: true, todayDate: "2026-05-13", currentHour: 9 }), null);
  assert.equal(reminderStageForRequest(request, { remindersEnabled: true, todayDate: "2026-05-13", currentHour: 10 }), "pre_deadline");
  assert.equal(reminderStageForRequest(request, { remindersEnabled: true, todayDate: "2026-05-13", currentHour: 18 }), "pre_deadline");
  assert.equal(
    reminderStageForRequest(request, {
      remindersEnabled: true,
      todayDate: "2026-05-13",
      currentHour: 10,
      preDeadlineReminderHour: 11,
    }),
    null,
  );
  assert.equal(reminderStageForRequest(request, { remindersEnabled: true, todayDate: "2026-05-14", currentHour: 15 }), "deadline_day");
  assert.equal(reminderStageForRequest({ ...request, status: "complete" }, { remindersEnabled: true, todayDate: "2026-05-14", currentHour: 15 }), null);
});
