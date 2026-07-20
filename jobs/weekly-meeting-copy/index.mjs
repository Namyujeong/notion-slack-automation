#!/usr/bin/env node

process.env.MEETING_TITLE_SUFFIX ||= "운영팀 주간미팅";
process.env.MEETING_TITLE_CONTAINS ||= "운영팀 주간미팅";
process.env.MEETING_TARGET_DAYS_AHEAD ||= "0";
process.env.MEETING_PEOPLE_PROPERTY ||= "Person";
process.env.MEETING_SKIP_KR_HOLIDAYS ||= "1";
process.env.MEETING_CHILD_DATABASE_SKIP_TITLES ||= "아젠다,Agenda";
process.env.MEETING_CHILD_DATABASE_REFERENCE_RENDER ||= "linked_view";
process.env.MEETING_CHILD_DATABASE_REFERENCE_VIEW_TYPE ||= "table";
process.env.MEETING_CHILD_DATABASE_REFERENCE_APPEND_IF_MISSING ||= "1";
process.env.MEETING_CHILD_DATABASE_REFERENCE_MISSING_TITLE ||= "아젠다";
if (process.env.OPERATIONS_WEEKLY_AGENDA_URL) {
  process.env.MEETING_CHILD_DATABASE_REFERENCE_JSON ||= JSON.stringify({
    "아젠다": {
      url: process.env.OPERATIONS_WEEKLY_AGENDA_URL,
      text: "운영팀 아젠다",
    },
    "Agenda": {
      url: process.env.OPERATIONS_WEEKLY_AGENDA_URL,
      text: "운영팀 아젠다",
    },
  });
}

await import("../../lib/meeting-copy.mjs");
