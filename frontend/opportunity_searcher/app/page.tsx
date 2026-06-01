"use client";

import {
  ArrowUpDown,
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  Globe2,
  GraduationCap,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

type Opportunity = {
  title: string;
  organization: string;
  category: string;
  location: string;
  subject: string;
  deadline: string;
  grades: string;
  description: string;
  source: string;
  link: string;
  featured?: boolean;
};

const opportunities: Opportunity[] = [
  {
    title: "Summer Science Research Program",
    organization: "Pathways to Science",
    category: "Research",
    location: "United States",
    subject: "STEM",
    deadline: "2026-06-15",
    grades: "10-12",
    description:
      "Lab-based summer placement for students interested in biology, engineering, and environmental science.",
    source: "Pathways to Science",
    link: "https://www.pathwaystoscience.org/",
    featured: true,
  },
  {
    title: "Youth Climate Innovation Challenge",
    organization: "Youthop",
    category: "Competition",
    location: "Global",
    subject: "Environment",
    deadline: "2026-07-01",
    grades: "9-12",
    description:
      "Student teams submit practical climate solutions and receive mentor feedback from sustainability leaders.",
    source: "Youthop",
    link: "https://www.youthop.com/",
  },
  {
    title: "Future Leaders Scholarship",
    organization: "OpportunitiesCorner",
    category: "Scholarship",
    location: "Global",
    subject: "Leadership",
    deadline: "2026-06-08",
    grades: "11-12",
    description:
      "Merit scholarship for high school students with community service, leadership work, and strong academics.",
    source: "OpportunitiesCorner",
    link: "https://opportunitiescorners.com/",
    featured: true,
  },
  {
    title: "Remote Data Journalism Internship",
    organization: "Student News Lab",
    category: "Internship",
    location: "Remote",
    subject: "Computer Science",
    deadline: "2026-06-28",
    grades: "10-12",
    description:
      "Part-time remote internship building charts, cleaning public datasets, and publishing student-friendly explainers.",
    source: "Manual review",
    link: "https://example.com/",
  },
  {
    title: "New Jersey Civic Tech Fellowship",
    organization: "Garden State STEM",
    category: "Internship",
    location: "New Jersey",
    subject: "Civic Tech",
    deadline: "2026-06-03",
    grades: "11-12",
    description:
      "Local summer fellowship where students prototype lightweight tools for schools and community nonprofits.",
    source: "Local source",
    link: "https://example.com/",
    featured: true,
  },
  {
    title: "Global Essay Prize",
    organization: "International Student Forum",
    category: "Competition",
    location: "Global",
    subject: "Humanities",
    deadline: "2026-08-10",
    grades: "9-12",
    description:
      "Essay competition for students writing about public policy, ethics, history, and global cooperation.",
    source: "Youthop",
    link: "https://example.com/",
  },
];

const categories = ["All", "Internship", "Research", "Competition", "Scholarship"];
const locations = ["All", "Global", "United States", "Remote", "New Jersey"];
const subjects = [
  "All",
  "STEM",
  "Computer Science",
  "Environment",
  "Leadership",
  "Humanities",
  "Civic Tech",
];

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const currentDate = new Date("2026-05-29T12:00:00");

function daysUntil(deadline: string) {
  const end = new Date(`${deadline}T12:00:00`);
  const difference = end.getTime() - currentDate.getTime();
  return Math.ceil(difference / (1000 * 60 * 60 * 24));
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [location, setLocation] = useState("All");
  const [subject, setSubject] = useState("All");
  const [sortSoonest, setSortSoonest] = useState(true);

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
          opportunity.subject,
        ]
          .join(" ")
          .toLowerCase();

        return (
          (!normalizedQuery || searchable.includes(normalizedQuery)) &&
          (category === "All" || opportunity.category === category) &&
          (location === "All" || opportunity.location === location) &&
          (subject === "All" || opportunity.subject === subject)
        );
      })
      .sort((first, second) => {
        const firstDate = new Date(first.deadline).getTime();
        const secondDate = new Date(second.deadline).getTime();
        return sortSoonest ? firstDate - secondDate : secondDate - firstDate;
      });
  }, [category, location, query, sortSoonest, subject]);

  const closingSoon = opportunities.filter(
    (opportunity) => daysUntil(opportunity.deadline) <= 10,
  ).length;

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
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Opportunity Searcher
                </p>
                <p className="text-sm text-slate-500">Built for high school students</p>
              </div>
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-5xl">
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
              <p className="text-2xl font-semibold">3</p>
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
                      className={`flex h-10 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition ${selected
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
              <Sparkles size={18} aria-hidden="true" />
              <p className="text-sm font-semibold">Project stack</p>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-300">
              <p>Next.js frontend with Tailwind styling.</p>
              <p>Supabase client dependency is installed for Postgres data.</p>
              <p>Python scraper and GitHub Actions folders are ready for the next milestone.</p>
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

          <div className="grid gap-4 lg:grid-cols-2">
            {visibleOpportunities.map((opportunity) => {
              const remainingDays = daysUntil(opportunity.deadline);
              const isClosingSoon = remainingDays <= 10;

              return (
                <article
                  key={`${opportunity.title}-${opportunity.deadline}`}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap gap-2">
                          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            {opportunity.category}
                          </span>
                          {opportunity.featured ? (
                            <span className="rounded-md bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                              Featured
                            </span>
                          ) : null}
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
                          {opportunity.organization}
                        </p>
                      </div>
                      <a
                        href={opportunity.link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                        title={`Open ${opportunity.title}`}
                      >
                        <ExternalLink size={18} aria-hidden="true" />
                        <span className="sr-only">Open listing</span>
                      </a>
                    </div>

                    <p className="text-sm leading-6 text-slate-600">{opportunity.description}</p>

                    <div className="grid gap-3 border-t border-slate-100 pt-4 text-sm text-slate-600 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <CalendarDays size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{dateFormatter.format(new Date(opportunity.deadline))}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock3 size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{remainingDays} days left</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{opportunity.location}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Globe2 size={17} className="text-slate-400" aria-hidden="true" />
                        <span>{opportunity.subject}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span className="text-slate-500">Grades {opportunity.grades}</span>
                      <span className="font-medium text-slate-700">Source: {opportunity.source}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {visibleOpportunities.length === 0 ? (
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
