#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_KOREA_HOLIDAY_CALENDAR_URL,
  isLegalKoreanPublicHolidayName,
  parseIcsHolidays,
} from "../lib/korean-holidays.mjs";
import {
  staticKoreanHoliday,
  staticKoreanHolidayDates,
} from "../lib/korean-holiday-fallbacks.mjs";

const DEFAULT_TIMEOUT_MS = 10000;

function sortByDate(left, right) {
  return left.date.localeCompare(right.date);
}

function toKoreaCurrentYear(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  });
  return Number(formatter.format(now));
}

function parseAuditYear(value, now = new Date()) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return toKoreaCurrentYear(now);

  const year = Number(rawValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`HOLIDAY_AUDIT_YEAR must be a four-digit year, got "${rawValue}"`);
  }
  return year;
}

function staticEntriesForYear(year) {
  const prefix = `${year}-`;
  return staticKoreanHolidayDates()
    .filter((date) => date.startsWith(prefix))
    .map((date) => ({ date, ...staticKoreanHoliday(date) }))
    .sort(sortByDate);
}

export function calendarEntriesForYear(ics, year) {
  const prefix = `${year}-`;
  return [...parseIcsHolidays(ics).entries()]
    .filter(([date]) => date.startsWith(prefix))
    .map(([date, name]) => ({ date, name }))
    .filter(({ name }) => isLegalKoreanPublicHolidayName(name))
    .sort(sortByDate);
}

export function auditKoreanHolidayFallbacks({ year, calendarEntries, staticEntries }) {
  const calendarDates = new Set(calendarEntries.map(({ date }) => date));
  const staticDates = new Set(staticEntries.map(({ date }) => date));

  const missingFromStatic = calendarEntries
    .filter(({ date }) => !staticDates.has(date))
    .sort(sortByDate);
  const extraStatic = staticEntries
    .filter(({ date }) => !calendarDates.has(date))
    .sort(sortByDate);
  const provisionalStatic = staticEntries
    .filter(({ source }) => String(source || "").includes("provisional"))
    .sort(sortByDate);

  const errors = [];
  if (!calendarEntries.length) errors.push(`No legal Korean public holidays were found in the calendar for ${year}.`);
  if (!staticEntries.length) errors.push(`No static fallback holidays are configured for ${year}.`);
  if (missingFromStatic.length) errors.push(`${missingFromStatic.length} calendar holidays are missing from the static fallback.`);
  if (extraStatic.length) errors.push(`${extraStatic.length} static fallback holidays are missing from the calendar.`);
  if (provisionalStatic.length) errors.push(`${provisionalStatic.length} fallback holidays are still marked provisional.`);

  return {
    ok: errors.length === 0,
    year,
    errors,
    calendarCount: calendarEntries.length,
    staticCount: staticEntries.length,
    missingFromStatic,
    extraStatic,
    provisionalStatic,
  };
}

function formatEntry(entry) {
  const source = entry.source ? ` (${entry.source})` : "";
  return `- ${entry.date} ${entry.name}${source}`;
}

function formatSection(title, entries) {
  if (!entries.length) return `### ${title}\n\nNone`;
  return `### ${title}\n\n${entries.map(formatEntry).join("\n")}`;
}

export function formatAuditReport(result) {
  const status = result.ok ? "PASS" : "FAIL";
  return [
    `## Korean Holiday Fallback Audit: ${status}`,
    "",
    `Year: ${result.year}`,
    `Calendar legal holidays: ${result.calendarCount}`,
    `Static fallback holidays: ${result.staticCount}`,
    "",
    result.errors.length ? `Errors:\n${result.errors.map((error) => `- ${error}`).join("\n")}` : "Errors: None",
    "",
    formatSection("Calendar holidays missing from static fallback", result.missingFromStatic),
    "",
    formatSection("Static fallback holidays missing from calendar", result.extraStatic),
    "",
    formatSection("Provisional fallback entries", result.provisionalStatic),
  ].join("\n");
}

async function fetchTextWithTimeout(url, timeoutMs, fetchImpl = fetch) {
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

export async function runHolidayAudit({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const year = parseAuditYear(env.HOLIDAY_AUDIT_YEAR, now);
  const calendarUrl = env.HOLIDAY_AUDIT_CALENDAR_URL || DEFAULT_KOREA_HOLIDAY_CALENDAR_URL;
  const timeoutMs = Number(env.HOLIDAY_AUDIT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const ics = await fetchTextWithTimeout(calendarUrl, timeoutMs, fetchImpl);
  const result = auditKoreanHolidayFallbacks({
    year,
    calendarEntries: calendarEntriesForYear(ics, year),
    staticEntries: staticEntriesForYear(year),
  });
  return result;
}

export async function main() {
  try {
    const result = await runHolidayAudit({
      env: {
        ...process.env,
        HOLIDAY_AUDIT_YEAR: process.env.HOLIDAY_AUDIT_YEAR || process.argv[2] || "",
      },
    });
    const report = formatAuditReport(result);
    console.log(report);

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    }

    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Korean holiday fallback audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
