import { staticKoreanHoliday } from "./korean-holiday-fallbacks.mjs";

export const DEFAULT_KOREA_HOLIDAY_CALENDAR_URL = "https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics";

function expandCompactDate(date) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function unfoldIcsLines(content) {
  const lines = [];
  for (const rawLine of content.split(/\r?\n/)) {
    if (/^[ \t]/.test(rawLine) && lines.length) {
      lines[lines.length - 1] += rawLine.slice(1);
    } else {
      lines.push(rawLine);
    }
  }
  return lines;
}

export function parseIcsHolidays(content) {
  const holidays = new Map();
  let event = null;

  for (const line of unfoldIcsLines(content)) {
    if (line === "BEGIN:VEVENT") {
      event = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (event?.date) holidays.set(event.date, event.summary || "Korean public holiday");
      event = null;
      continue;
    }
    if (!event) continue;

    const [keyPart, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    const key = keyPart.split(";")[0];
    if (key === "DTSTART") {
      const match = value.match(/^(\d{8})/);
      if (match) event.date = expandCompactDate(match[1]);
    }
    if (key === "SUMMARY") {
      event.summary = value.replace(/\\,/g, ",");
    }
  }

  return holidays;
}

const LEGAL_KOREAN_PUBLIC_HOLIDAY_NAMES = new Set([
  "새해첫날",
  "신정",
  "설날",
  "설날 연휴",
  "삼일절",
  "3·1절",
  "3.1절",
  "어린이날",
  "부처님오신날",
  "석가탄신일",
  "현충일",
  "광복절",
  "추석",
  "추석 연휴",
  "개천절",
  "한글날",
  "기독탄신일",
  "성탄절",
  "크리스마스",
  "선거일",
  "전국동시지방선거",
  "전국동시지방선거일",
  "대통령선거",
  "대통령선거일",
]);

function normalizeHolidayName(name) {
  return name
    .replace(/\\,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLegalKoreanPublicHolidayName(name) {
  const normalized = normalizeHolidayName(name);
  if (LEGAL_KOREAN_PUBLIC_HOLIDAY_NAMES.has(normalized)) return true;
  if (normalized.endsWith("선거일")) return true;

  const substituteMatch = normalized.match(/^(?:쉬는 날|대체공휴일)\s+(.+)$/);
  if (substituteMatch) {
    return LEGAL_KOREAN_PUBLIC_HOLIDAY_NAMES.has(normalizeHolidayName(substituteMatch[1]));
  }

  const suffixMatch = normalized.match(/^(.+)\s+대체공휴일$/);
  if (suffixMatch) {
    return LEGAL_KOREAN_PUBLIC_HOLIDAY_NAMES.has(normalizeHolidayName(suffixMatch[1]));
  }

  return false;
}

async function fetchTextWithTimeout(url, timeoutMs = 5000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export function fixedKoreanHoliday(date) {
  const fixedHolidays = {
    "01-01": "신정",
    "03-01": "삼일절",
    "05-05": "어린이날",
    "06-06": "현충일",
    "08-15": "광복절",
    "10-03": "개천절",
    "10-09": "한글날",
    "12-25": "성탄절",
  };
  return fixedHolidays[date.slice(5)] || null;
}

export async function getKoreanHoliday(date, {
  calendarUrl = DEFAULT_KOREA_HOLIDAY_CALENDAR_URL,
  timeoutMs = 5000,
  fetchImpl = fetch,
} = {}) {
  const staticHoliday = staticKoreanHoliday(date);
  const fixedHoliday = fixedKoreanHoliday(date);

  try {
    const ics = await fetchTextWithTimeout(calendarUrl, timeoutMs, fetchImpl);
    const holidays = parseIcsHolidays(ics);
    const calendarHoliday = holidays.get(date);
    if (calendarHoliday && isLegalKoreanPublicHolidayName(calendarHoliday)) {
      return { isHoliday: true, name: calendarHoliday, source: "calendar" };
    }
    if (calendarHoliday) {
      return { isHoliday: false, name: null, source: "calendar", ignoredName: calendarHoliday };
    }
    if (staticHoliday) {
      return { isHoliday: true, name: staticHoliday.name, source: "static_supplement", staticSource: staticHoliday.source };
    }
    return { isHoliday: false, name: null, source: "calendar" };
  } catch (error) {
    if (staticHoliday) {
      return {
        isHoliday: true,
        name: staticHoliday.name,
        source: "static_fallback",
        staticSource: staticHoliday.source,
        warning: error.message,
      };
    }
    if (fixedHoliday) {
      return { isHoliday: true, name: fixedHoliday, source: "fixed_fallback", warning: error.message };
    }
    return { isHoliday: false, name: null, source: "fixed_fallback", warning: error.message };
  }
}
