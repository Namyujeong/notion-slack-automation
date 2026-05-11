#!/usr/bin/env node

process.env.MEETING_TITLE_SUFFIX ||= "Weekly Meeting";
process.env.MEETING_TITLE_CONTAINS ||= "Weekly Meeting";
process.env.MEETING_TARGET_DAYS_AHEAD ||= "0";
process.env.MEETING_PEOPLE_PROPERTY ||= "Person";
process.env.MEETING_SKIP_KR_HOLIDAYS ||= "1";
process.env.MEETING_CHILD_DATABASE_SKIP_TITLES ||= "Agenda";
process.env.MEETING_CHILD_DATABASE_REFERENCE_RENDER ||= "linked_view";
process.env.MEETING_CHILD_DATABASE_REFERENCE_VIEW_TYPE ||= "table";
process.env.MEETING_CHILD_DATABASE_REFERENCE_APPEND_IF_MISSING ||= "1";
process.env.MEETING_CHILD_DATABASE_REFERENCE_MISSING_TITLE ||= "Agenda";
if (process.env.OPERATIONS_WEEKLY_AGENDA_URL) {
  process.env.MEETING_CHILD_DATABASE_REFERENCE_JSON ||= JSON.stringify({
    "Agenda": {
    url: process.env.OPERATIONS_WEEKLY_AGENDA_URL,
      text: "Manage the weekly agenda in a central database.",
    },
  });
}

await import("../../lib/meeting-copy.mjs");
