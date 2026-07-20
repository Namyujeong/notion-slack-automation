import assert from "node:assert/strict";
import test from "node:test";

import {
  fixedKoreanHoliday,
  getKoreanHoliday,
  isLegalKoreanPublicHolidayName,
  parseIcsHolidays,
} from "../lib/korean-holidays.mjs";
import {
  staticKoreanHoliday,
  staticKoreanHolidayDates,
} from "../lib/korean-holiday-fallbacks.mjs";

test("ICS holiday parser handles all-day dates, folded lines, and escaped commas", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260301",
    "SUMMARY:삼일절",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260506",
    "SUMMARY:대체공휴일 ",
    " 어린이날",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260924",
    "SUMMARY:추석\\, 연휴",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");

  const holidays = parseIcsHolidays(ics);

  assert.equal(holidays.get("2026-03-01"), "삼일절");
  assert.equal(holidays.get("2026-05-06"), "대체공휴일 어린이날");
  assert.equal(holidays.get("2026-09-24"), "추석, 연휴");
});

test("legal Korean holiday filter accepts 법정 공휴일 and substitutes only", () => {
  assert.equal(isLegalKoreanPublicHolidayName("삼일절"), true);
  assert.equal(isLegalKoreanPublicHolidayName("대체공휴일 삼일절"), true);
  assert.equal(isLegalKoreanPublicHolidayName("삼일절 대체공휴일"), true);
  assert.equal(isLegalKoreanPublicHolidayName("제9회 전국동시지방선거일"), true);

  assert.equal(isLegalKoreanPublicHolidayName("제헌절"), false);
  assert.equal(isLegalKoreanPublicHolidayName("식목일"), false);
});

test("fixed holiday fallback keeps canonical fixed-date holidays", () => {
  assert.equal(fixedKoreanHoliday("2026-03-01"), "삼일절");
  assert.equal(fixedKoreanHoliday("2026-08-15"), "광복절");
  assert.equal(fixedKoreanHoliday("2026-10-03"), "개천절");
  assert.equal(fixedKoreanHoliday("2026-07-17"), null);
});

test("static holiday fallback covers 2026 lunar, substitute, and election holidays", () => {
  assert.equal(staticKoreanHoliday("2026-02-17").name, "설날");
  assert.equal(staticKoreanHoliday("2026-03-02").name, "삼일절 대체공휴일");
  assert.equal(staticKoreanHoliday("2026-05-25").name, "부처님오신날 대체공휴일");
  assert.equal(staticKoreanHoliday("2026-06-03").name, "전국동시지방선거일");
  assert.equal(staticKoreanHoliday("2026-08-17").name, "광복절 대체공휴일");
  assert.equal(staticKoreanHoliday("2026-10-05").name, "개천절 대체공휴일");
  assert.equal(staticKoreanHoliday("2026-09-28"), null);
});

test("static holiday fallback includes provisional 2027 holidays", () => {
  assert.equal(staticKoreanHoliday("2027-02-09").name, "설날 대체공휴일");
  assert.equal(staticKoreanHoliday("2027-09-15").name, "추석");
  assert.equal(staticKoreanHoliday("2027-10-11").name, "한글날 대체공휴일");
  assert.equal(staticKoreanHoliday("2027-12-27").name, "성탄절 대체공휴일");
});

test("static holiday dates are unique", () => {
  const dates = staticKoreanHolidayDates();
  assert.equal(new Set(dates).size, dates.length);
});

test("getKoreanHoliday uses static fallback when calendar fetch fails", async () => {
  const result = await getKoreanHoliday("2026-02-17", {
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(result.isHoliday, true);
  assert.equal(result.name, "설날");
  assert.equal(result.source, "static_fallback");
  assert.equal(result.staticSource, "static_2026_kasa");
  assert.match(result.warning, /offline/);
});

test("getKoreanHoliday supplements known static holidays missing from calendar", async () => {
  const result = await getKoreanHoliday("2026-06-03", {
    fetchImpl: async () => ({
      ok: true,
      text: async () => "BEGIN:VCALENDAR\nEND:VCALENDAR",
    }),
  });

  assert.equal(result.isHoliday, true);
  assert.equal(result.name, "전국동시지방선거일");
  assert.equal(result.source, "static_supplement");
});
