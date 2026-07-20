#!/usr/bin/env node

process.env.MEETING_TITLE_SUFFIX ||= "Operations";
process.env.MEETING_TITLE_CONTAINS ||= "Operations";
process.env.MEETING_TARGET_DAYS_AHEAD ||= "1";
process.env.MEETING_PEOPLE_PROPERTY ||= "Person";
process.env.MEETING_SKIP_KR_HOLIDAYS ||= "1";

await import("../../lib/meeting-copy.mjs");
