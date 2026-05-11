const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_TEMPERATURE_CHECK_HEADING = "온도 체크";
export const DEFAULT_CHECK_IN_SECTION_KEY = "checkin";

export function dateInTimeZone(daysAhead = 0, {
  now = new Date(),
  timeZone = "Asia/Seoul",
} = {}) {
  const shifted = new Date(now.getTime() + daysAhead * DAY_MS);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

export function buildMeetingTarget({ targetDate, titleSuffix }) {
  if (!targetDate) throw new Error("targetDate is required.");
  if (!titleSuffix) throw new Error("titleSuffix is required.");
  return {
    targetDate,
    targetTitle: `${targetDate} ${titleSuffix}`,
  };
}

export function formatMeetingShortDate(targetDate) {
  const match = String(targetDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("targetDate must be YYYY-MM-DD.");
  return `${match[1].slice(2)}-${match[2]}-${match[3]}`;
}

export function buildMeetingSlackMessage({
  mention = "",
  url,
  targetDate,
} = {}) {
  if (!url) throw new Error("url is required.");
  const normalizedUrl = String(url).trim();
  const linkedUrl = normalizedUrl.startsWith("<") && normalizedUrl.endsWith(">")
    ? normalizedUrl
    : `<${normalizedUrl}>`;
  return [
    String(mention || "").trim(),
    linkedUrl,
    `${formatMeetingShortDate(targetDate)} 주간 회의 회의록입니다. 갱신 부탁드립니다.`,
  ].filter(Boolean).join(" ");
}

export function replaceMeetingText(content = "", {
  sourceTitle = null,
  sourceDate = null,
  targetTitle = "",
  targetDate = "",
} = {}) {
  let replaced = String(content);
  if (sourceTitle) replaced = replaced.split(sourceTitle).join(targetTitle);
  if (sourceDate) replaced = replaced.split(sourceDate).join(targetDate);
  return replaced;
}

export function shouldSkipMeetingForHoliday({ skipKoreanHolidays = true, holiday = null } = {}) {
  return Boolean(skipKoreanHolidays && holiday?.isHoliday);
}

export function csvList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function richTextPlain(richText = []) {
  return richText.map((item) => item.plain_text || item.text?.content || "").join("");
}

export function blockPlainText(block) {
  const value = block?.[block.type];
  if (!value || !Array.isArray(value.rich_text)) return "";
  return richTextPlain(value.rich_text).trim();
}

export function sectionKey(text = "") {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function childDatabaseCopyMode({
  title = "",
  copyMode = "copy_non_done",
  schemaOnlyTitles = [],
  skipTitles = [],
} = {}) {
  const normalizedMode = String(copyMode || "copy_non_done").trim().toLowerCase();
  if (!["copy_non_done", "schema_only", "skip"].includes(normalizedMode)) {
    throw new Error(`Unsupported child database copy mode: ${copyMode}`);
  }

  const normalizedTitle = sectionKey(title);
  const skipTitleSet = new Set(skipTitles.map(sectionKey).filter(Boolean));
  if (skipTitleSet.has(normalizedTitle)) return "skip";

  const schemaOnlyTitleSet = new Set(schemaOnlyTitles.map(sectionKey).filter(Boolean));
  if (schemaOnlyTitleSet.has(normalizedTitle)) return "schema_only";

  return normalizedMode;
}

export function shouldCopyChildDatabaseRows(options = {}) {
  return childDatabaseCopyMode(options) === "copy_non_done";
}

export function tableViewWrapConfiguration({ wrapCells = true } = {}) {
  return {
    type: "table",
    wrap_cells: Boolean(wrapCells),
  };
}

export function parseChildDatabaseReferences(value = "") {
  if (!String(value || "").trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MEETING_CHILD_DATABASE_REFERENCE_JSON must be a JSON object.");
  }

  const references = {};
  for (const [title, reference] of Object.entries(parsed)) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) continue;
    const key = sectionKey(title);
    if (!key || !reference.url) continue;
    references[key] = {
      url: String(reference.url),
      text: reference.text ? String(reference.text) : String(title),
    };
  }
  return references;
}

export function childDatabaseReference({
  title = "",
  references = {},
  fallbackUrl = "",
  fallbackText = "",
} = {}) {
  const specific = references[sectionKey(title)];
  if (specific?.url) return specific;
  if (!fallbackUrl) return null;
  return {
    url: fallbackUrl,
    text: fallbackText || title || "중앙 DB",
  };
}

export function notionIdFromUrl(value = "") {
  const match = String(value).match(/[0-9a-fA-F]{32}/g)?.at(-1);
  if (!match) return null;
  return [
    match.slice(0, 8),
    match.slice(8, 12),
    match.slice(12, 16),
    match.slice(16, 20),
    match.slice(20),
  ].join("-");
}

export function isPlaceholderChildDatabaseTitle(title = "") {
  return !String(title || "").trim() || sectionKey(title) === "untitled";
}

export function childDatabaseDisplayTitle(title = "", sectionTitle = "") {
  return isPlaceholderChildDatabaseTitle(title) && sectionTitle ? sectionTitle : title;
}

export function isHeading(block) {
  return ["heading_1", "heading_2", "heading_3"].includes(block?.type);
}

export function isTemperatureCheckHeading(block, heading = DEFAULT_TEMPERATURE_CHECK_HEADING) {
  return isHeading(block) && blockPlainText(block) === heading;
}

export function isCheckInHeading(block, section = DEFAULT_CHECK_IN_SECTION_KEY) {
  return isHeading(block) && sectionKey(blockPlainText(block)) === section;
}

export function isMentionOnlyParagraph(block) {
  if (block?.type !== "paragraph") return false;
  const richText = block.paragraph?.rich_text || [];
  const hasUserMention = richText.some((item) => item.type === "mention" && item.mention?.type === "user");
  if (!hasUserMention) return false;
  return richText.every((item) => {
    if (item.type === "mention" && item.mention?.type === "user") return true;
    return (item.plain_text || item.text?.content || "").trim() === "";
  });
}

export function blankParagraphBlock() {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [], color: "default" },
    has_children: false,
  };
}

export function scrubTemperatureCheckComments(blocks, {
  heading = DEFAULT_TEMPERATURE_CHECK_HEADING,
} = {}) {
  const scrubbed = [];
  const stats = {
    temperatureMentionCount: 0,
    temperatureRemovedBlockCount: 0,
    temperatureBlankBlockCount: 0,
    checkInTodoResetCount: 0,
  };

  let inTemperatureCheck = false;
  for (const block of blocks) {
    if (isTemperatureCheckHeading(block, heading)) {
      inTemperatureCheck = true;
      scrubbed.push(block);
      continue;
    }

    if (inTemperatureCheck && isHeading(block)) {
      inTemperatureCheck = false;
      scrubbed.push(block);
      continue;
    }

    if (!inTemperatureCheck) {
      scrubbed.push(block);
      continue;
    }

    if (isMentionOnlyParagraph(block)) {
      scrubbed.push(block);
      scrubbed.push(blankParagraphBlock());
      stats.temperatureMentionCount += 1;
      stats.temperatureBlankBlockCount += 1;
    } else {
      stats.temperatureRemovedBlockCount += 1;
    }
  }

  return { blocks: scrubbed, stats };
}

export function checkInCopyEntries(blocks, {
  section = DEFAULT_CHECK_IN_SECTION_KEY,
} = {}) {
  const entries = [];
  let inCheckIn = false;

  for (const block of blocks) {
    if (isHeading(block)) {
      inCheckIn = isCheckInHeading(block, section);
    }

    entries.push({ block, resetToDoChecked: inCheckIn });
  }

  return entries;
}

export function isDoneChecked(row) {
  for (const [name, prop] of Object.entries(row?.properties || {})) {
    if (prop.type !== "checkbox" || !prop.checkbox) continue;
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName || normalizedName === "done") return true;
  }
  return false;
}
