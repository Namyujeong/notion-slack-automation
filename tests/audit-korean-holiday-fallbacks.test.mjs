import assert from "node:assert/strict";
import test from "node:test";

import {
  auditKoreanHolidayFallbacks,
  calendarEntriesForYear,
  formatAuditReport,
  runHolidayAudit,
} from "../scripts/audit-korean-holiday-fallbacks.mjs";
import {
  staticKoreanHoliday,
  staticKoreanHolidayDates,
} from "../lib/korean-holiday-fallbacks.mjs";

function event(date, summary) {
  return [
    "BEGIN:VEVENT",
    `DTSTART;VALUE=DATE:${date.replaceAll("-", "")}`,
    `SUMMARY:${summary}`,
    "END:VEVENT",
  ].join("\n");
}

function calendarFor(entries) {
  return [
    "BEGIN:VCALENDAR",
    ...entries.map(({ date, name }) => event(date, name)),
    "END:VCALENDAR",
  ].join("\n");
}

function staticEntriesForYear(year) {
  return staticKoreanHolidayDates()
    .filter((date) => date.startsWith(`${year}-`))
    .map((date) => ({ date, ...staticKoreanHoliday(date) }));
}

test("calendarEntriesForYear keeps only legal Korean public holidays for the target year", () => {
  const entries = calendarEntriesForYear(calendarFor([
    { date: "2026-01-01", name: "신정" },
    { date: "2026-07-17", name: "제헌절" },
    { date: "2027-01-01", name: "신정" },
  ]), 2026);

  assert.deepEqual(entries, [{ date: "2026-01-01", name: "신정" }]);
});

test("holiday fallback audit passes when calendar and static fallback match", async () => {
  const staticEntries = staticEntriesForYear(2026);
  const ics = calendarFor(staticEntries);
  const result = await runHolidayAudit({
    env: { HOLIDAY_AUDIT_YEAR: "2026" },
    fetchImpl: async () => ({
      ok: true,
      text: async () => ics,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.calendarCount, staticEntries.length);
  assert.equal(result.staticCount, staticEntries.length);
  assert.deepEqual(result.errors, []);
});

test("holiday fallback audit flags missing, extra, and provisional entries", () => {
  const result = auditKoreanHolidayFallbacks({
    year: 2099,
    calendarEntries: [
      { date: "2099-01-01", name: "신정" },
      { date: "2099-05-05", name: "어린이날" },
    ],
    staticEntries: [
      { date: "2099-01-01", name: "신정", source: "static_2099_provisional" },
      { date: "2099-12-25", name: "성탄절", source: "static_2099_official" },
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingFromStatic, [{ date: "2099-05-05", name: "어린이날" }]);
  assert.deepEqual(result.extraStatic, [{ date: "2099-12-25", name: "성탄절", source: "static_2099_official" }]);
  assert.deepEqual(result.provisionalStatic, [{ date: "2099-01-01", name: "신정", source: "static_2099_provisional" }]);

  const report = formatAuditReport(result);
  assert.match(report, /FAIL/);
  assert.match(report, /missing from the static fallback/);
  assert.match(report, /still marked provisional/);
});
