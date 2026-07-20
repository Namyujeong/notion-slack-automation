#!/usr/bin/env node

process.env.MEETING_TITLE_SUFFIX ||= "Team Weekly";
process.env.MEETING_TITLE_CONTAINS ||= "Team Weekly";
process.env.MEETING_TARGET_DAYS_AHEAD ||= "0";
process.env.MEETING_PEOPLE_PROPERTY ||= "Person";
process.env.MEETING_SKIP_KR_HOLIDAYS ||= "1";
process.env.MEETING_SLACK_NOTIFY ||= "0";
process.env.MEETING_CHILD_DATABASE_COPY_MODE ||= "skip";
process.env.MEETING_CHILD_DATABASE_REFERENCE_URL ||= process.env.TEAM_SHARED_SCHEDULE_URL || "";
process.env.MEETING_CHILD_DATABASE_REFERENCE_TEXT ||= "Manage team schedule and time off in a central database.";
process.env.MEETING_CHILD_DATABASE_REFERENCE_RENDER ||= "linked_view";
process.env.MEETING_CHILD_DATABASE_REFERENCE_VIEW_TYPE ||= "calendar";
process.env.MEETING_CHILD_DATABASE_REFERENCE_APPEND_IF_MISSING ||= "1";
process.env.MEETING_CHILD_DATABASE_REFERENCE_MISSING_TITLE ||= "Time off";

await import("../../lib/meeting-copy.mjs");
