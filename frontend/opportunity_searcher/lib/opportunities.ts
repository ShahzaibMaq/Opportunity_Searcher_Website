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

const deadlineDatePattern =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i;

export function inferredDeadlineText(opportunity: DeadlineFields) {
  const existing = opportunity.deadline?.trim();
  if (existing) return existing;

  const description = opportunity.description ?? "";
  const labeled = description.match(/\b(?:application\s+)?deadline(?:\s+is)?\s*:\s*([^.;|\n]+)/i);
  if (labeled?.[1]) return labeled[1].trim();

  const phrase = description.match(
    /\b(?:applications?\s+(?:are\s+)?(?:due|close)|apply\s+by|submit(?:ted)?\s+by)\s+([^.;|\n]+)/i,
  );
  if (phrase?.[1]) return phrase[1].trim();

  const special = description.match(/\b(rolling|various|tba|tbd|to be announced|contact for deadline|not yet announced)\b/i);
  if (special?.[1]) return titleCase(special[1]);

  return description.match(deadlineDatePattern)?.[0] ?? "";
}

export function parseDeadline(opportunity: DeadlineFields) {
  if (opportunity.deadline_date) {
    const parsedIso = new Date(`${opportunity.deadline_date}T00:00:00`);
    return Number.isNaN(parsedIso.getTime()) ? null : parsedIso;
  }

  const deadline = inferredDeadlineText(opportunity);
  if (!deadline || /not listed|rolling|various|tba|tbd|none|contact for deadline|to be announced/i.test(deadline)) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();

  let value = deadline;
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
  if (!/\d{4}/.test(deadline) && parsed < today) {
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
  const deadline = inferredDeadlineText(opportunity);
  if (!deadline) {
    return "Deadline not listed";
  }

  const parsed = parseDeadline(opportunity);
  return parsed ? dateFormatter.format(parsed) : deadline;
}

export function countdownLabel(opportunity: Opportunity) {
  const days = daysUntil(opportunity);
  if (days === null) return inferredDeadlineText(opportunity) || "Deadline not listed";
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

  return gradeNumbersFromText(gradeLevel).includes(grade);
}

function gradeNumbersFromText(value: string | null | undefined) {
  const normalized = normalizeSearchText(value);
  const grades = new Set<number>();
  const wordGrades: Array<[number, RegExp]> = [
    [9, /\b(freshman|freshmen|9th|grade 9|rising 9)\b/],
    [10, /\b(sophomore|sophomores|10th|grade 10|rising 10)\b/],
    [11, /\b(junior|juniors|11th|grade 11|rising 11)\b/],
    [12, /\b(senior|seniors|12th|grade 12|rising 12|graduating senior)\b/],
  ];

  for (const [grade, pattern] of wordGrades) {
    if (pattern.test(normalized)) grades.add(grade);
  }

  for (const match of normalized.matchAll(/\bgrades?\s*(\d{1,2})\s*(?:-|to|through)\s*(\d{1,2})\b/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    for (let grade = Math.max(1, start); grade <= Math.min(12, end); grade += 1) {
      grades.add(grade);
    }
  }

  for (const match of normalized.matchAll(/\bgrades?\s*((?:\d{1,2}\s*,?\s*(?:and\s*)?)+)\b/g)) {
    for (const number of match[1].matchAll(/\d{1,2}/g)) {
      const grade = Number(number[0]);
      if (grade >= 1 && grade <= 12) grades.add(grade);
    }
  }

  if (/^\s*\d{1,2}(?:\s*,\s*\d{1,2})*\s*$/.test(value ?? "")) {
    for (const number of (value ?? "").matchAll(/\d{1,2}/g)) {
      const grade = Number(number[0]);
      if (grade >= 1 && grade <= 12) grades.add(grade);
    }
  }

  return Array.from(grades).filter((grade) => grade >= 9 && grade <= 12).sort((first, second) => first - second);
}

export function gradeLevelLabel(value: string | null | undefined) {
  const grades = gradeNumbersFromText(value);
  if (grades.length > 0) {
    return `Grades: ${grades.join(", ")}`;
  }
  return `Grades: ${(value ?? "").trim() || "High School"}`;
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
