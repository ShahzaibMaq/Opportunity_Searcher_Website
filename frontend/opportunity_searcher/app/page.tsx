"use client";

import {
  ArrowUpDown,
  CalendarDays,
  Check,
  Clock3,
  Database,
  ExternalLink,
  Globe2,
  GraduationCap,
  MapPin,
  Search,
  SlidersHorizontal,
  BookmarkPlus,
  BookmarkCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Opportunity = {
  title: string;
  organization: string;
  category: string;
  location: string;
  subject_area: string;
  deadline: string;
  grade_level: string;
  description: string;
  link: string;
  source: string;
  source_url: string;
  scraped_at: string;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((first, second) =>
    first.localeCompare(second),
  );
}

function splitValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDeadline(deadline: string) {
  if (!deadline) {
    return null;
  }

  const value = /\d{4}/.test(deadline)
    ? deadline
    : `${deadline}, ${new Date().getFullYear()}`;
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysUntil(deadline: string) {
  const parsed = parseDeadline(deadline);
  if (!parsed) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);

  return Math.ceil((parsed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function deadlineLabel(deadline: string) {
  const parsed = parseDeadline(deadline);
  return parsed ? dateFormatter.format(parsed) : "Deadline not listed";
}

function countdownLabel(deadline: string) {
  const days = daysUntil(deadline);
  if (days === null) {
    return "Deadline not listed";
  }
  if (days < 0) {
    return "Deadline passed";
  }
  if (days === 0) {
    return "Due today";
  }
  return `${days} days left`;
}

function compareByDeadline(first: Opportunity, second: Opportunity, soonestFirst: boolean) {
  const firstDate = parseDeadline(first.deadline)?.getTime();
  const secondDate = parseDeadline(second.deadline)?.getTime();

  if (firstDate === undefined && secondDate === undefined) {
    return first.title.localeCompare(second.title);
  }
  if (firstDate === undefined) {
    return 1;
  }
  if (secondDate === undefined) {
    return -1;
  }

  return soonestFirst ? firstDate - secondDate : secondDate - firstDate;
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
    <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

export default function Home() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [location, setLocation] = useState("All");
  const [subject, setSubject] = useState("All");
  const [sortSoonest, setSortSoonest] = useState(true);

  const [user, setUser] = useState<any>(null);
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    fetch("/data/opportunities.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Run the scraper to create /data/opportunities.json.");
        }
        return response.json() as Promise<Opportunity[]>;
      })
      .then((records) => {
        if (!isMounted) {
          return;
        }
        setOpportunities(records);
        setDataError("");
      })
      .catch((error: Error) => {
        if (!isMounted) {
          return;
        }
        setDataError(error.message);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    let authSubscription: any = null;

    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (isMounted) setUser(session?.user ?? null);
      });
      
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (isMounted) setUser(session?.user ?? null);
      });
      authSubscription = data.subscription;
    }

    return () => {
      isMounted = false;
      if (authSubscription) authSubscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function fetchSaved() {
      if (!user || !supabase) return;
      const { data } = await supabase
        .from("saved_opportunities")
        .select("opportunity_link")
        .eq("user_id", user.id);
      
      if (data) {
        setSavedLinks(new Set(data.map(d => d.opportunity_link)));
      }
    }
    fetchSaved();
  }, [user]);

  const toggleSave = async (opp: Opportunity) => {
    if (!user || !supabase || isSaving) return;
    setIsSaving(true);
    
    const linkId = opp.link || opp.source_url;
    const isSaved = savedLinks.has(linkId);

    if (isSaved) {
      await supabase
        .from("saved_opportunities")
        .delete()
        .eq("user_id", user.id)
        .eq("opportunity_link", linkId);
      
      setSavedLinks(prev => {
        const next = new Set(prev);
        next.delete(linkId);
        return next;
      });
    } else {
      await supabase
        .from("saved_opportunities")
        .insert({
          user_id: user.id,
          opportunity_link: linkId,
          opportunity_data: opp,
          status: "Interested"
        });
        
      setSavedLinks(prev => {
        const next = new Set(prev);
        next.add(linkId);
        return next;
      });
    }
    setIsSaving(false);
  };

  const categories = useMemo(
    () => ["All", ...uniqueSorted(opportunities.map((opportunity) => opportunity.category))],
    [opportunities],
  );

  const locations = useMemo(
    () => ["All", ...uniqueSorted(opportunities.map((opportunity) => opportunity.location))],
    [opportunities],
  );

  const subjects = useMemo(
    () => [
      "All",
      ...uniqueSorted(
        opportunities.flatMap((opportunity) => splitValues(opportunity.subject_area)),
      ),
    ],
    [opportunities],
  );

  const sources = useMemo(
    () => uniqueSorted(opportunities.map((opportunity) => opportunity.source)),
    [opportunities],
  );

  const lastScraped = useMemo(() => {
    const latest = opportunities
      .map((opportunity) => new Date(opportunity.scraped_at).getTime())
      .filter((value) => !Number.isNaN(value))
      .sort((first, second) => second - first)[0];

    return latest ? dateFormatter.format(new Date(latest)) : "Not run yet";
  }, [opportunities]);

  const visibleOpportunities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return opportunities
      .filter((opportunity) => {
        const searchable = [
          opportunity.title,
          opportunity.organization,
          opportunity.description,
          opportunity.category,
          opportunity.location,
          opportunity.subject_area,
          opportunity.grade_level,
          opportunity.source,
        ]
          .join(" ")
          .toLowerCase();

        return (
          (!normalizedQuery || searchable.includes(normalizedQuery)) &&
          (category === "All" || opportunity.category === category) &&
          (location === "All" || opportunity.location === location) &&
          (subject === "All" || splitValues(opportunity.subject_area).includes(subject))
        );
      })
      .sort((first, second) => compareByDeadline(first, second, sortSoonest));
  }, [category, location, opportunities, query, sortSoonest, subject]);

  const closingSoon = opportunities.filter((opportunity) => {
    const days = daysUntil(opportunity.deadline);
    return days !== null && days >= 0 && days <= 10;
  }).length;

  return (
    <main className="min-h-screen bg-[#f6f7f3] text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white">
                <GraduationCap size={22} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase text-emerald-700">
                  Opportunity Searcher
                </p>
                <p className="text-sm text-slate-500">Built for high school students</p>
              </div>
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
              Find internships, programs, scholarships, and competitions in one place.
            </h1>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm sm:min-w-[420px]">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-2xl font-semibold">{opportunities.length}</p>
              <p className="text-slate-500">Listings</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-2xl font-semibold">{closingSoon}</p>
              <p className="text-slate-500">Closing soon</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-2xl font-semibold">{sources.length}</p>
              <p className="text-slate-500">Sources</p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={20}
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by keyword, topic, organization..."
                  className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-4 text-base outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {categories.map((item) => {
                  const selected = item === category;

                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setCategory(item)}
                      className={`flex h-10 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition ${
                        selected
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      {selected ? <Check size={16} aria-hidden="true" /> : null}
                      {item}
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <SelectFilter
                  label="Location"
                  value={location}
                  options={locations}
                  onChange={setLocation}
                />
                <SelectFilter
                  label="Subject"
                  value={subject}
                  options={subjects}
                  onChange={setSubject}
                />
                <button
                  type="button"
                  onClick={() => setSortSoonest((current) => !current)}
                  className="mt-auto flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
                  title="Toggle deadline sort"
                >
                  <ArrowUpDown size={18} aria-hidden="true" />
                  {sortSoonest ? "Soonest first" : "Latest first"}
                </button>
              </div>
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white">
            <div className="flex items-center gap-2 text-emerald-300">
              <Database size={18} aria-hidden="true" />
              <p className="text-sm font-semibold">Scraped data</p>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-300">
              <p>{sources.join(", ") || "No sources loaded yet"}</p>
              <p>Last updated: {lastScraped}</p>
              <p>CSV and JSON are generated by the Python scraper.</p>
            </div>
          </aside>
        </section>

        <section className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={19} className="text-slate-500" aria-hidden="true" />
              <h2 className="text-xl font-semibold">Browse opportunities</h2>
            </div>
            <p className="text-sm text-slate-500">
              Showing {visibleOpportunities.length} of {opportunities.length}
            </p>
          </div>

          {isLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
              <p className="font-semibold text-slate-900">Loading scraped opportunities...</p>
            </div>
          ) : null}

          {!isLoading && dataError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
              <p className="font-semibold text-amber-950">Scraped data is not ready yet.</p>
              <p className="mt-2 text-sm text-amber-800">{dataError}</p>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {visibleOpportunities.map((opportunity) => {
              const remainingDays = daysUntil(opportunity.deadline);
              const isClosingSoon =
                remainingDays !== null && remainingDays >= 0 && remainingDays <= 10;

              return (
                <article
                  key={`${opportunity.title}-${opportunity.link}`}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap gap-2">
                          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            {opportunity.category || "Opportunity"}
                          </span>
                          {isClosingSoon ? (
                            <span className="rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              Closing soon
                            </span>
                          ) : null}
                        </div>
                        <h3 className="text-xl font-semibold leading-snug text-slate-950">
                          {opportunity.title}
                        </h3>
                        <p className="mt-1 text-sm font-medium text-slate-500">
                          {opportunity.organization || opportunity.source}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {user && (
                          <button
                            onClick={() => toggleSave(opportunity)}
                            disabled={isSaving}
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition ${
                              savedLinks.has(opportunity.link || opportunity.source_url)
                                ? "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                            } disabled:opacity-50`}
                            title={savedLinks.has(opportunity.link || opportunity.source_url) ? "Saved to Planner" : "Save to Planner"}
                          >
                            {savedLinks.has(opportunity.link || opportunity.source_url) ? (
                              <BookmarkCheck size={18} aria-hidden="true" />
                            ) : (
                              <BookmarkPlus size={18} aria-hidden="true" />
                            )}
                            <span className="sr-only">Save to Planner</span>
                          </button>
                        )}
                        <a
                          href={opportunity.link || opportunity.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                          title={`Open ${opportunity.title}`}
                        >
                          <ExternalLink size={18} aria-hidden="true" />
                          <span className="sr-only">Open listing</span>
                        </a>
                      </div>
                    </div>

                    <p className="text-sm leading-6 text-slate-600">
                      {opportunity.description || "Description not available from source."}
                    </p>

                    <div className="grid gap-3 border-t border-slate-100 pt-4 text-sm text-slate-600 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <CalendarDays size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{deadlineLabel(opportunity.deadline)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock3 size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{countdownLabel(opportunity.deadline)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{opportunity.location || "Location not listed"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Globe2 size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{opportunity.subject_area || "General"}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span className="text-slate-500">
                        Grades {opportunity.grade_level || "High School"}
                      </span>
                      <span className="font-medium text-slate-700">
                        Source: {opportunity.source}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {!isLoading && !dataError && visibleOpportunities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="font-semibold text-slate-900">No matches yet.</p>
              <p className="mt-2 text-sm text-slate-500">
                Try a broader keyword, category, subject, or location.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
