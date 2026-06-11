"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Clock3, ExternalLink, CalendarDays, KanbanSquare, ListTodo, Trash2, MapPin } from "lucide-react";
import { PushNotificationManager } from "../components/PushNotificationManager";
import type { User } from "@supabase/supabase-js";
import type { Opportunity } from "@/lib/opportunities";
import { countdownLabel, deadlineLabel, inferredDeadlineText, parseDeadline } from "@/lib/opportunities";

type SavedOpportunity = {
  id: string;
  opportunity_link: string;
  opportunity_data: Opportunity;
  status: string;
  custom_deadline_date?: string | null;
  created_at: string;
};

const STATUSES = ["Interested", "Applying", "Submitted", "Interviewing", "Accepted", "Rejected"];

export default function PlannerPage() {
  const [user, setUser] = useState<User | null>(null);
  const [savedItems, setSavedItems] = useState<SavedOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const [todayTime] = useState(() => Date.now());
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    async function loadPlanner() {
      await Promise.resolve();
      if (!supabase) {
        if (isMounted) {
          setErrorMessage("Supabase is not configured.");
          setIsLoading(false);
        }
        return;
      }

      const { data: { session }, error } = await supabase.auth.getSession();

      if (!isMounted) return;
      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }
      if (!session) {
        router.push("/login");
      } else {
        if (isMounted) setUser(session.user);
        const { data, error: savedError } = await supabase
          .from("saved_opportunities")
          .select("*")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false });

        if (!isMounted) return;
        if (savedError) {
          setErrorMessage(savedError.message);
        } else if (data) {
          setSavedItems(data);
          setErrorMessage("");
        }
        setIsLoading(false);
      }
    }

    loadPlanner();

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function updateStatus(id: string, newStatus: string) {
    if (!supabase) return;
    const original = [...savedItems];
    setSavedItems(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));
    
    const { error } = await supabase
      .from("saved_opportunities")
      .update({ status: newStatus })
      .eq("id", id);
      
    if (error) {
      setSavedItems(original);
      setErrorMessage(error.message);
    } else {
      setErrorMessage("");
    }
  }

  async function updateCustomDeadline(id: string, customDeadlineDate: string) {
    if (!supabase) return;
    const original = [...savedItems];
    const nextDate = customDeadlineDate || null;
    setSavedItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, custom_deadline_date: nextDate } : item)),
    );

    const { error } = await supabase
      .from("saved_opportunities")
      .update({ custom_deadline_date: nextDate })
      .eq("id", id);

    if (error) {
      setSavedItems(original);
      setErrorMessage(error.message);
    } else {
      setErrorMessage("");
    }
  }

  async function deleteItem(id: string) {
    if (!supabase) return;
    if (!confirm("Remove this opportunity from your planner?")) return;
    
    const original = [...savedItems];
    setSavedItems(prev => prev.filter(item => item.id !== id));
    const { error } = await supabase.from("saved_opportunities").delete().eq("id", id);
    if (error) {
      setSavedItems(original);
      setErrorMessage(error.message);
    } else {
      setErrorMessage("");
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-stone-50">
        <p className="text-sm text-zinc-600">Loading your planner...</p>
      </div>
    );
  }

  if (!user) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Interested": return "bg-zinc-50 text-zinc-700 border-zinc-200";
      case "Applying": return "bg-zinc-50 text-zinc-700 border-zinc-200";
      case "Submitted": return "bg-zinc-50 text-zinc-700 border-zinc-200";
      case "Interviewing": return "bg-zinc-50 text-zinc-700 border-zinc-200";
      case "Accepted": return "bg-teal-50 text-teal-800 border-teal-200";
      case "Rejected": return "bg-red-50 text-red-700 border-red-200";
      default: return "bg-zinc-50 text-zinc-700 border-zinc-200";
    }
  };

  const getItemsByStatus = (status: string) => savedItems.filter(item => item.status === status);

  const opportunityForDeadline = (item: SavedOpportunity): Opportunity => ({
    ...item.opportunity_data,
    deadline_date: item.custom_deadline_date || item.opportunity_data.deadline_date,
  });

  const upcomingDeadlines = [...savedItems]
    .filter((item) => parseDeadline(opportunityForDeadline(item)))
    .sort((a, b) => {
      const dateA = parseDeadline(opportunityForDeadline(a))?.getTime() ?? 0;
      const dateB = parseDeadline(opportunityForDeadline(b))?.getTime() ?? 0;
      return dateA - dateB;
    })
    .filter((item) => {
      const deadline = parseDeadline(opportunityForDeadline(item));
      return deadline && deadline.getTime() > todayTime - 86400000;
    });

  return (
    <main className="min-h-[calc(100vh-64px)] bg-stone-50 p-4 text-zinc-950 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl flex flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950">My Planner</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Track your applications and stay on top of deadlines.
            </p>
          </div>
          <div className="flex gap-2 rounded-md border border-zinc-200 bg-white p-1">
            <button
              onClick={() => setView("board")}
              className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition ${view === "board" ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
            >
              <KanbanSquare size={16} /> Board
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition ${view === "list" ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
            >
              <ListTodo size={16} /> Deadlines
            </button>
          </div>
        </header>

        <PushNotificationManager user={user} />
        {errorMessage ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
        ) : null}

        {view === "board" ? (
          <div className="flex gap-6 overflow-x-auto pb-4 snap-x">
            {STATUSES.map(status => (
              <div key={status} className="flex min-w-[320px] flex-col gap-3 snap-start">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-700">{status}</h2>
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-200 px-1.5 text-xs font-medium text-slate-600">
                    {getItemsByStatus(status).length}
                  </span>
                </div>
                <div className="flex flex-col gap-3 min-h-[200px] rounded-xl bg-slate-100/50 p-2 border border-slate-200 border-dashed">
                  {getItemsByStatus(status).map(item => {
                    const deadlineOpportunity = opportunityForDeadline(item);

                    return (
                    <div key={item.id} className="group relative flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
                      <div>
                        <h3 className="font-semibold text-slate-900 line-clamp-2" title={item.opportunity_data.title}>
                          {item.opportunity_data.title}
                        </h3>
                        <p className="text-xs font-medium text-slate-500 mt-0.5 line-clamp-1">
                          {item.opportunity_data.organization || "Organization not listed"}
                        </p>
                        {item.opportunity_data.location && (
                          <div className="flex items-center gap-1 text-xs font-medium text-slate-500 mt-0.5">
                            <MapPin size={12} />
                            <span className="line-clamp-1">{item.opportunity_data.location}</span>
                          </div>
                        )}
                      </div>
                      
                      {inferredDeadlineText(deadlineOpportunity) && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Clock3 size={14} />
                          <span>{deadlineLabel(deadlineOpportunity)}</span>
                        </div>
                      )}

                      <label className="grid gap-1 text-xs font-medium text-slate-500">
                        Planner deadline
                        <input
                          type="date"
                          value={item.custom_deadline_date ?? ""}
                          onChange={(event) => updateCustomDeadline(item.id, event.target.value)}
                          className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none focus:border-teal-700"
                        />
                      </label>

                      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-3">
                        <select
                          value={item.status}
                          onChange={(e) => updateStatus(item.id, e.target.value)}
                          className={`rounded border text-xs font-medium px-2 py-1 outline-none ${getStatusColor(item.status)}`}
                        >
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <div className="flex items-center gap-1">
                          <button onClick={() => deleteItem(item.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition" title="Delete">
                            <Trash2 size={16} />
                          </button>
                          <a
                            href={item.opportunity_link}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded transition"
                            title="Open Link"
                          >
                            <ExternalLink size={16} />
                          </a>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                  {getItemsByStatus(status).length === 0 && (
                    <div className="flex h-full items-center justify-center p-4">
                      <p className="text-xs text-slate-400">No items</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcomingDeadlines.length === 0 ? (
              <div className="col-span-full rounded-xl border border-slate-200 bg-white p-8 text-center">
                <CalendarDays size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="font-semibold text-slate-900">No upcoming deadlines.</p>
                <p className="mt-1 text-sm text-slate-500">Saved opportunities with future deadlines will appear here.</p>
              </div>
            ) : (
              upcomingDeadlines.map(item => {
                const deadlineOpportunity = opportunityForDeadline(item);

                return (
                <div key={item.id} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <CalendarDays size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate" title={item.opportunity_data.title}>
                      {item.opportunity_data.title}
                    </h3>
                    <p className="text-sm text-slate-500 truncate">{item.opportunity_data.organization}</p>
                    {item.opportunity_data.location && (
                      <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                        <MapPin size={12} />
                        <span className="truncate">{item.opportunity_data.location}</span>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${getStatusColor(item.status)}`}>
                        {item.status}
                      </span>
                      <span className="text-sm font-semibold text-slate-700">
                        {deadlineLabel(deadlineOpportunity)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{countdownLabel(deadlineOpportunity)}</p>
                    <label className="mt-3 grid gap-1 text-xs font-medium text-slate-500">
                      Planner deadline
                      <input
                        type="date"
                        value={item.custom_deadline_date ?? ""}
                        onChange={(event) => updateCustomDeadline(item.id, event.target.value)}
                        className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none focus:border-teal-700"
                      />
                    </label>
                  </div>
                </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </main>
  );
}
