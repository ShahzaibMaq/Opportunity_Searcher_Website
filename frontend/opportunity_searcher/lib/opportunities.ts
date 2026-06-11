export type Opportunity = {
  title: string;
  organization: string;
  category: string;
  location: string;
  subject_area?: string | null;
  deadline?: string | null;
  deadline_date?: string | null;
  is_active?: boolean | null;
  timeline?: string | null;
  grade_level: string;
  description: string;
  link: string;
};

export type UserProfile = {
  username?: string;
  age?: string;
  gender?: string;
  grade?: number | string | null;
  interests?: string[] | null;
  location?: string;
  goals?: string;
};

export type MatchDetail = {
  label: string;
  score: number;
};

export const CLOSING_SOON_DAYS = 14;
export const ALL_FILTER = "All";
export const BEST_FOR_ME_SORT = "Best for me";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const stateAliases: Record<string, string[]> = {
  "new jersey": ["new jersey", "nj"],
  "new york": ["new york", "ny"],
  pennsylvania: ["pennsylvania", "pa"],
  connecticut: ["connecticut", "ct"],
  delaware: ["delaware", "de"],
  massachusetts: ["massachusetts", "ma"],
  "united states": ["united states", "usa", "us", "national"],
};

const neighboringStates: Record<string, string[]> = {
  "new jersey": ["new york", "pennsylvania", "delaware", "connecticut"],
  "new york": ["new jersey", "connecticut", "pennsylvania"],
  pennsylvania: ["new jersey", "new york", "delaware"],
  connecticut: ["new york", "new jersey", "massachusetts"],
  delaware: ["new jersey", "pennsylvania"],
  massachusetts: ["connecticut", "new york"],
};

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((first, second) =>
    first.localeCompare(second),
  );
}

export function splitValues(value: string | null | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type DeadlineFields = Pick<Opportunity, "deadline" | "deadline_date" | "description" | "title">;

export function parseDeadline(opportunity: DeadlineFields) {
  if (opportunity.deadline_date) {
    const parsedIso = new Date(`${opportunity.deadline_date}T00:00:00`);
    return Number.isNaN(parsedIso.getTime()) ? null : parsedIso;
  }

  if (!opportunity.deadline || /not listed|rolling|tba|tbd|none/i.test(opportunity.deadline)) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();

  let value = opportunity.deadline;
  if (!/\d{4}/.test(value)) {
    const context = `${opportunity.title ?? ""} ${opportunity.description ?? ""}`;
    const needle = value.toLowerCase().split(",")[0]?.trim() ?? "";
    const index = context.toLowerCase().indexOf(needle);
    const window = index >= 0 ? context.slice(Math.max(0, index - 40), index + value.length + 40) : "";
    const contextYear = window.match(/\b(20\d{2})\b/)?.[1];
    value = contextYear ? `${value}, ${contextYear}` : `${value}, ${currentYear}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  if (!/\d{4}/.test(opportunity.deadline) && parsed < today) {
    const nextYear = new Date(parsed);
    nextYear.setFullYear(currentYear + 1);
    return nextYear;
  }

  return parsed;
}

export function listingReferencesPastProgramYear(opportunity: Pick<Opportunity, "title" | "description">) {
  const currentYear = new Date().getFullYear();
  const titleYears = [...(opportunity.title?.matchAll(/\b(20\d{2})\b/g) ?? [])].map((match) => Number(match[1]));
  if (titleYears.some((year) => year < currentYear)) {
    return true;
  }

  const haystack = `${opportunity.title ?? ""} ${opportunity.description ?? ""}`;
  const haystackLower = haystack.toLowerCase();
  const titleOffset = (opportunity.title?.length ?? 0) + 1;

  for (const match of opportunity.description?.matchAll(/\b(20\d{2})\b/g) ?? []) {
    const year = Number(match[1]);
    if (year >= currentYear) continue;
    const start = titleOffset + (match.index ?? 0);
    const snippet = haystackLower.slice(Math.max(0, start - 80), start + match[0].length + 30);
    if (/\b(summer|program|session|cohort|class of|contest|competition|academy|camp|running from|held in)\b/.test(snippet)) {
      return true;
    }
  }

  const rangeMatch = haystack.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*|\s+)(?:to|–|-)\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s*(20\d{2})\b/i,
  );
  if (rangeMatch && Number(rangeMatch[1]) < currentYear) {
    return true;
  }

  return false;
}

export function isListingActive(opportunity: Opportunity) {
  if (opportunity.is_active === false) {
    return false;
  }
  if (listingReferencesPastProgramYear(opportunity)) {
    return false;
  }
  const days = daysUntil(opportunity);
  return days === null || days >= 0;
}

export function daysUntil(opportunity: DeadlineFields) {
  const parsed = parseDeadline(opportunity);
  if (!parsed) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return Math.ceil((parsed.getTime() - today.getTime()) / 86_400_000);
}

export function isClosingSoon(opportunity: Opportunity) {
  const days = daysUntil(opportunity);
  return days !== null && days > 0 && days <= CLOSING_SOON_DAYS;
}

export function deadlineLabel(opportunity: Opportunity) {
  if (!opportunity.deadline) {
    return "Deadline not listed";
  }

  const parsed = parseDeadline(opportunity);
  return parsed ? dateFormatter.format(parsed) : opportunity.deadline;
}

export function countdownLabel(opportunity: Opportunity) {
  const days = daysUntil(opportunity);
  if (days === null) return opportunity.deadline || "Deadline not listed";
  if (days < 0) return "Deadline passed";
  if (days === 0) return "Due today";
  return `${days} days left`;
}

export function compareByDeadline(first: Opportunity, second: Opportunity, soonestFirst: boolean) {
  const firstDate = parseDeadline(first)?.getTime();
  const secondDate = parseDeadline(second)?.getTime();

  if (firstDate === undefined && secondDate === undefined) return first.title.localeCompare(second.title);
  if (firstDate === undefined) return 1;
  if (secondDate === undefined) return -1;
  return soonestFirst ? firstDate - secondDate : secondDate - firstDate;
}

export function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function stateFromText(value: string | null | undefined) {
  const normalized = normalizeSearchText(value);
  for (const [state, aliases] of Object.entries(stateAliases)) {
    if (aliases.some((alias) => new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test(normalized))) {
      return state;
    }
  }
  return "";
}

function isRemoteOrNational(location: string) {
  return /\b(remote|virtual|online|global|anywhere|united states|usa|national)\b/.test(
    normalizeSearchText(location),
  );
}

function gradeMatches(profileGrade: number | string | null | undefined, gradeLevel: string) {
  const grade = Number(profileGrade);
  if (!grade || Number.isNaN(grade)) return false;

  const normalized = normalizeSearchText(gradeLevel);
  if (normalized.includes("high school")) return grade >= 9 && grade <= 12;

  const range = normalized.match(/grade\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    return grade >= start && grade <= end;
  }

  return normalized.includes(String(grade));
}

export function profileIsComplete(profile: UserProfile) {
  return Boolean(profile.grade && profile.location && profile.goals && profile.interests?.length);
}

export function matchDetails(opportunity: Opportunity, profile: UserProfile): MatchDetail[] {
  const details: MatchDetail[] = [];
  const subjectText = normalizeSearchText(`${opportunity.subject_area ?? ""} ${opportunity.description}`);
  const profileState = stateFromText(profile.location);
  const opportunityState = stateFromText(opportunity.location);
  const isNeighbor = profileState && opportunityState && neighboringStates[profileState]?.includes(opportunityState);

  if (gradeMatches(profile.grade, opportunity.grade_level)) {
    details.push({ label: `Grade ${profile.grade}`, score: 3 });
  }

  if (
    profile.location &&
    (profileState === opportunityState ||
      normalizeSearchText(opportunity.location).includes(normalizeSearchText(profile.location)) ||
      isRemoteOrNational(opportunity.location))
  ) {
    details.push({ label: profileState ? titleCase(profileState) : profile.location, score: 2 });
  } else if (isNeighbor) {
    details.push({ label: `Nearby (${titleCase(opportunityState)})`, score: 1 });
  }

  for (const interest of profile.interests ?? []) {
    if (subjectText.includes(normalizeSearchText(interest))) {
      details.push({ label: interest, score: 2 });
    }
  }

  if (profile.goals && normalizeSearchText(opportunity.category) === normalizeSearchText(profile.goals)) {
    details.push({ label: profile.goals, score: 1 });
  }

  return details;
}

export function personalizationScore(opportunity: Opportunity, profile: UserProfile) {
  return matchDetails(opportunity, profile).reduce((total, detail) => total + detail.score, 0);
}

export function matchSummary(opportunity: Opportunity, profile: UserProfile) {
  return matchDetails(opportunity, profile)
    .map((detail) => detail.label)
    .slice(0, 3)
    .join(" · ");
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
