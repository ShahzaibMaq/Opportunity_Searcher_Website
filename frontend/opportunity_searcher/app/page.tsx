"use client";

import Link from "next/link";
import {
  ArrowUpDown,
  BookmarkCheck,
  BookmarkPlus,
  CalendarDays,
  Clock3,
  ExternalLink,
  MapPin,
  Search,
} from "lucide-react";
import Fuse from "fuse.js";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  ALL_FILTER,
  BEST_FOR_ME_SORT,
  Opportunity,
  UserProfile,
  compareByDeadline,
  countdownLabel,
  deadlineLabel,
  isClosingSoon,
  isListingActive,
  matchSummary,
  personalizationScore,
  profileIsComplete,
  splitValues,
  uniqueSorted,
} from "@/lib/opportunities";

const SORT_OPTIONS = [BEST_FOR_ME_SORT, "Soonest", "Latest", "Title"];
const RIGOR_OPTIONS = [ALL_FILTER, "Accessible", "Moderate", "Competitive", "Highly selective", "Unknown"];

function isMissingTableError(message: string) {
  return /could not find the table|relation .* does not exist|schema cache/i.test(message);
}

type RigorProfile = {
  label: "Accessible" | "Moderate" | "Competitive" | "Highly selective" | "Unknown";
  reason: string;
};

function opportunityLink(opportunity: Opportunity) {
  return opportunity.link || "";
}

// Estimate rigor from public listing text when the source does not provide it.
function rigorProfile(opportunity: Opportunity): RigorProfile {
  const context = [
    opportunity.title,
    opportunity.organization,
    opportunity.category,
    opportunity.description,
    opportunity.grade_level,
    opportunity.timeline,
    opportunity.subject_area,
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;

  if (/\b(research|laboratory|mentor|faculty|independent project)\b/.test(context)) score += 2;
  if (/\b(competitive|selective|advanced|intensive|prestigious)\b/.test(context)) score += 2;
  if (/\b(application|essay|recommendation|transcript|interview|gpa|portfolio)\b/.test(context)) score += 2;
  if (/\b(national|international|nih|nasa|rutgers|princeton|mit|stanford)\b/.test(context)) score += 2;
  if (/\b(open to all|beginner|introductory|volunteer|self-paced)\b/.test(context)) score -= 2;

  if (context.length < 160) return { label: "Unknown", reason: "Limited listing detail" };
  if (score >= 7) return { label: "Highly selective", reason: "Selective requirements and broad applicant pool" };
  if (score >= 4) return { label: "Competitive", reason: "Application requirements or strong outcomes" };
  if (score >= 1) return { label: "Moderate", reason: "Some application expectations" };
  return { label: "Accessible", reason: "Open or introductory listing language" };
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-zinc-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-teal-700"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600">
      {children}
    </span>
  );
}

export default function Home() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_FILTER);
  const [location, setLocation] = useState(ALL_FILTER);
  const [subject, setSubject] = useState(ALL_FILTER);
  const [rigorFilter, setRigorFilter] = useState(ALL_FILTER);
  const [sortMode, setSortMode] = useState(BEST_FOR_ME_SORT);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile>({});
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
  const [savingLink, setSavingLink] = useState("");
  const [profileSetupNeeded, setProfileSetupNeeded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    fetch("/data/opportunities.json")
      .then((response) => {
        if (!response.ok) throw new Error("Run the scraper to create /data/opportunities.json.");
        return response.json() as Promise<Opportunity[]>;
      })
      .then((records) => {
        if (!isMounted) return;
        setOpportunities(records.filter(isListingActive));
        setDataError("");
      })
      .catch((error: Error) => {
        if (isMounted) setDataError(error.message);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    if (!supabase) return () => {
      isMounted = false;
    };

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!isMounted) return;
      if (error) setAccountError(error.message);
      setUser(session?.user ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) setUser(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchAccountData() {
      if (!user || !supabase) {
        setProfile({});
        setSavedLinks(new Set());
        return;
      }

      const [{ data: savedData, error: savedError }, { data: profileData, error: profileError }] =
        await Promise.all([
          supabase.from("saved_opportunities").select("opportunity_link").eq("user_id", user.id),
          supabase
            .from("profiles")
            .select("username, age, gender, grade, interests, location, goals")
            .eq("id", user.id)
            .maybeSingle(),
        ]);

      if (!isMounted) return;

      const metadataProfile = (user.user_metadata ?? {}) as UserProfile;
      const mergedProfile = {
        ...metadataProfile,
        ...(profileData ?? {}),
        age: profileData?.age ? String(profileData.age) : metadataProfile.age,
      };

      if (savedError) {
        setAccountError(savedError.message);
      } else if (profileError) {
        if (isMissingTableError(profileError.message)) {
          setProfileSetupNeeded(true);
          setAccountError("");
          setProfile({
            ...mergedProfile,
          });
        } else {
          setAccountError(profileError.message);
          setProfile(mergedProfile);
        }
      } else {
        setProfileSetupNeeded(false);
        setAccountError("");
        setProfile(mergedProfile);
      }

      setSavedLinks(new Set((savedData ?? []).map((item) => item.opportunity_link)));
    }

    fetchAccountData();
    return () => {
      isMounted = false;
    };
  }, [user]);

  async function toggleSave(opportunity: Opportunity) {
    if (!user || !supabase) {
      setAccountError("Log in to save opportunities.");
      return;
    }

    const linkId = opportunityLink(opportunity);
    if (!linkId || savingLink) return;

    setSavingLink(linkId);
    const nextSavedLinks = new Set(savedLinks);
    const isSaved = nextSavedLinks.has(linkId);

    if (isSaved) nextSavedLinks.delete(linkId);
    else nextSavedLinks.add(linkId);
    setSavedLinks(nextSavedLinks);

    const response = isSaved
      ? await supabase.from("saved_opportunities").delete().eq("user_id", user.id).eq("opportunity_link", linkId)
      : await supabase.from("saved_opportunities").insert({
          user_id: user.id,
          opportunity_link: linkId,
          opportunity_data: opportunity,
          status: "Interested",
        });

    if (response.error) {
      setAccountError(response.error.message);
      setSavedLinks(savedLinks);
    } else {
      setAccountError("");
    }
    setSavingLink("");
  }

  const categories = useMemo(
    () => [ALL_FILTER, ...uniqueSorted(opportunities.map((opportunity) => opportunity.category))],
    [opportunities],
  );
  const locations = useMemo(
    () => [ALL_FILTER, ...uniqueSorted(opportunities.map((opportunity) => opportunity.location))],
    [opportunities],
  );
  const subjects = useMemo(
    () => [
      ALL_FILTER,
      ...uniqueSorted(opportunities.flatMap((opportunity) => splitValues(opportunity.subject_area))),
    ],
    [opportunities],
  );

  const fuse = useMemo(() => {
    if (opportunities.length === 0) return null;
    return new Fuse(opportunities, {
      keys: ["title", "organization", "description", "category", "location", "subject_area", "grade_level"],
      distance: 120,
      ignoreLocation: true,
      threshold: 0.45,
      minMatchCharLength: 2,
    });
  }, [opportunities]);

  const profileComplete = profileIsComplete(profile);

  const visibleOpportunities = useMemo(() => {
    const trimmedQuery = query.trim();
    let candidates = opportunities;

    if (trimmedQuery) {
      if (!fuse) return [];
      const matchedKeys = new Set(fuse.search(trimmedQuery).map((result) => `${result.item.title}-${result.item.link}`));
      candidates = opportunities.filter((opportunity) => matchedKeys.has(`${opportunity.title}-${opportunity.link}`));
    }

    return candidates
      .filter((opportunity) => {
        const rigor = rigorProfile(opportunity).label;
        return (
          (category === ALL_FILTER || opportunity.category === category) &&
          (location === ALL_FILTER || opportunity.location === location) &&
          (subject === ALL_FILTER || splitValues(opportunity.subject_area).includes(subject)) &&
          (rigorFilter === ALL_FILTER || rigor === rigorFilter)
        );
      })
      .sort((first, second) => {
        if (sortMode === BEST_FOR_ME_SORT && profileComplete) {
          const scoreDifference = personalizationScore(second, profile) - personalizationScore(first, profile);
          if (scoreDifference !== 0) return scoreDifference;
        }
        if (sortMode === "Title") return first.title.localeCompare(second.title);
        return compareByDeadline(first, second, sortMode !== "Latest");
      });
  }, [category, fuse, location, opportunities, profile, profileComplete, query, rigorFilter, sortMode, subject]);

  const closingSoonCount = opportunities.filter(isClosingSoon).length;
  const personalizedCount = opportunities.filter((opportunity) => personalizationScore(opportunity, profile) > 0).length;
  const bestForMeActive = sortMode === BEST_FOR_ME_SORT && profileComplete;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">AlumniAspirations</p>
            <h1 className="mt-2 text-2xl font-semibold text-zinc-950 sm:text-3xl">Browse opportunities</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              Internships, summer programs, scholarships, research, and competitions matched to your aspirations.
            </p>
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-zinc-200 bg-white text-sm">
            <div className="border-r border-zinc-200 px-4 py-3">
              <p className="text-xl font-semibold">{opportunities.length}</p>
              <p className="text-xs text-zinc-500">Active</p>
            </div>
            <div className="border-r border-zinc-200 px-4 py-3">
              <p className="text-xl font-semibold">{closingSoonCount}</p>
              <p className="text-xs text-zinc-500">Closing soon</p>
            </div>
            <div className="px-4 py-3">
              {profileComplete ? (
                <p className="text-xl font-semibold">{personalizedCount}</p>
              ) : user ? (
                <Link href="/onboarding" className="text-sm font-semibold text-teal-800 hover:underline">
                  Set up
                </Link>
              ) : (
                <Link href="/login" className="text-sm font-semibold text-teal-800 hover:underline">
                  Log in
                </Link>
              )}
              <p className="text-xs text-zinc-500">Matched</p>
            </div>
          </div>
        </header>

        <section className="rounded-md border border-zinc-200 bg-white p-3">
          <div className="grid gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by keyword, topic, or organization"
                className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-teal-700"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <SelectFilter label="Category" value={category} options={categories} onChange={setCategory} />
              <SelectFilter label="Location" value={location} options={locations} onChange={setLocation} />
              <SelectFilter label="Subject" value={subject} options={subjects} onChange={setSubject} />
              <SelectFilter label="Rigor" value={rigorFilter} options={RIGOR_OPTIONS} onChange={setRigorFilter} />
              <SelectFilter label="Sort" value={sortMode} options={SORT_OPTIONS} onChange={setSortMode} />
            </div>
          </div>
        </section>

        {profileSetupNeeded ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Database setup needed: run <code className="rounded bg-amber-100 px-1">supabase/schema.sql</code> in your
            Supabase SQL editor. Profile matching will use cached data until then.
          </div>
        ) : null}

        {user && !profileComplete && !profileSetupNeeded ? (
          <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
            Complete your profile to unlock personalized matching and &ldquo;Best for me&rdquo; sorting.{" "}
            <Link href="/onboarding" className="font-medium underline">
              Finish setup
            </Link>
          </div>
        ) : null}

        {accountError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{accountError}</div>
        ) : null}

        <section className="grid gap-3">
          <div className="flex items-center justify-between text-sm text-zinc-600">
            <span>
              Showing {visibleOpportunities.length} of {opportunities.length}
            </span>
            <button
              type="button"
              onClick={() => setSortMode(sortMode === "Latest" ? "Soonest" : "Latest")}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700"
            >
              <ArrowUpDown size={15} />
              {sortMode === "Latest" ? "Latest first" : "Soonest first"}
            </button>
          </div>

          {isLoading ? (
            <div className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-600">Loading opportunities...</div>
          ) : null}

          {!isLoading && dataError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">{dataError}</div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            {visibleOpportunities.map((opportunity) => {
              const rigor = rigorProfile(opportunity);
              const isSaved = savedLinks.has(opportunityLink(opportunity));
              const summary = bestForMeActive ? matchSummary(opportunity, profile) : "";

              return (
                <article
                  key={`${opportunity.title}-${opportunity.link}`}
                  className="flex min-h-[300px] flex-col rounded-md border border-zinc-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        <Pill>{opportunity.category || "Opportunity"}</Pill>
                        <Pill>{rigor.label}</Pill>
                        <Pill>{opportunity.location || "Location not listed"}</Pill>
                        <Pill>{opportunity.subject_area || "General"}</Pill>
                        {isClosingSoon(opportunity) ? (
                          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Closing soon
                          </span>
                        ) : null}
                      </div>
                      <h2 className="text-base font-semibold leading-6 text-zinc-950">{opportunity.title}</h2>
                      <p className="mt-1 text-sm text-zinc-500">{opportunity.organization || "Organization not listed"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {user ? (
                        <button
                          type="button"
                          onClick={() => toggleSave(opportunity)}
                          disabled={savingLink === opportunityLink(opportunity)}
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 disabled:opacity-50"
                          title={isSaved ? "Saved" : "Save"}
                        >
                          {isSaved ? <BookmarkCheck size={17} /> : <BookmarkPlus size={17} />}
                        </button>
                      ) : null}
                      <a
                        href={opportunityLink(opportunity)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-600"
                        title={`Open ${opportunity.title}`}
                      >
                        <ExternalLink size={17} />
                      </a>
                    </div>
                  </div>

                  <p className="mt-4 line-clamp-4 text-sm leading-6 text-zinc-600">
                    {opportunity.description || "Description not available."}
                  </p>

                  {summary ? <p className="mt-3 text-xs text-teal-800">Matches: {summary}</p> : null}

                  <div className="mt-auto grid gap-2 border-t border-zinc-100 pt-4 text-sm text-zinc-600 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <CalendarDays size={16} className="text-zinc-400" />
                      <span>{deadlineLabel(opportunity)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock3 size={16} className="text-zinc-400" />
                      <span>{opportunity.timeline || countdownLabel(opportunity)}</span>
                    </div>
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <MapPin size={16} className="text-zinc-400" />
                      <span>Grades {opportunity.grade_level || "High School"}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {!isLoading && !dataError && visibleOpportunities.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
              No matches. Try a broader search or fewer filters.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
