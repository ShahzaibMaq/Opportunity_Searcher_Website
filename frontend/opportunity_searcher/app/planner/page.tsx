"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Clock3, ExternalLink, CalendarDays, KanbanSquare, ListTodo, Trash2 } from "lucide-react";
import { PushNotificationManager } from "../components/PushNotificationManager";

type SavedOpportunity = {
  id: string;
  opportunity_link: string;
  opportunity_data: any;
  status: string;
  created_at: string;
};

const STATUSES = ["Interested", "Applying", "Submitted", "Interviewing", "Accepted", "Rejected"];

export default function PlannerPage() {
  const [user, setUser] = useState<any>(null);
  const [savedItems, setSavedItems] = useState<SavedOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<"board" | "list">("board");
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    if (!supabase) {
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
      } else {
        if (isMounted) setUser(session.user);
        fetchSaved(session.user.id);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function fetchSaved(userId: string) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("saved_opportunities")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setSavedItems(data);
    }
    setIsLoading(false);
  }

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
      alert("Failed to update status");
    }
  }

  async function deleteItem(id: string) {
    if (!supabase) return;
    if (!confirm("Remove this opportunity from your planner?")) return;
    
    setSavedItems(prev => prev.filter(item => item.id !== id));
    await supabase.from("saved_opportunities").delete().eq("id", id);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-[#f6f7f3]">
        <p className="text-slate-500 font-medium">Loading your planner...</p>
      </div>
    );
  }

  if (!user) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Interested": return "bg-slate-100 text-slate-700 border-slate-200";
      case "Applying": return "bg-blue-50 text-blue-700 border-blue-200";
      case "Submitted": return "bg-purple-50 text-purple-700 border-purple-200";
      case "Interviewing": return "bg-amber-50 text-amber-700 border-amber-200";
      case "Accepted": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "Rejected": return "bg-red-50 text-red-700 border-red-200";
      default: return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const getItemsByStatus = (status: string) => savedItems.filter(item => item.status === status);

  const upcomingDeadlines = [...savedItems]
    .filter(item => item.opportunity_data.deadline)
    .sort((a, b) => {
      const dateA = new Date(a.opportunity_data.deadline).getTime();
      const dateB = new Date(b.opportunity_data.deadline).getTime();
      return dateA - dateB;
    })
    .filter(item => {
       const d = new Date(item.opportunity_data.deadline);
       return !isNaN(d.getTime()) && d.getTime() > Date.now() - 86400000;
    });

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#f6f7f3] text-slate-950 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl flex flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">My Planner</h1>
            <p className="mt-1 text-sm text-slate-500">
              Track your applications and stay on top of deadlines.
            </p>
          </div>
          <div className="flex gap-2 bg-white p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setView("board")}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition ${view === "board" ? "bg-slate-100 text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              <KanbanSquare size={16} /> Board
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition ${view === "list" ? "bg-slate-100 text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              <ListTodo size={16} /> Deadlines
            </button>
          </div>
        </header>

        <PushNotificationManager user={user} />

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
                  {getItemsByStatus(status).map(item => (
                    <div key={item.id} className="group relative flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
                      <div>
                        <h3 className="font-semibold text-slate-900 line-clamp-2" title={item.opportunity_data.title}>
                          {item.opportunity_data.title}
                        </h3>
                        <p className="text-xs font-medium text-slate-500 mt-0.5 line-clamp-1">
                          {item.opportunity_data.organization || item.opportunity_data.source}
                        </p>
                      </div>
                      
                      {item.opportunity_data.deadline && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Clock3 size={14} />
                          <span>{item.opportunity_data.deadline}</span>
                        </div>
                      )}

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
                  ))}
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
              upcomingDeadlines.map(item => (
                <div key={item.id} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <CalendarDays size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate" title={item.opportunity_data.title}>
                      {item.opportunity_data.title}
                    </h3>
                    <p className="text-sm text-slate-500 truncate">{item.opportunity_data.organization}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${getStatusColor(item.status)}`}>
                        {item.status}
                      </span>
                      <span className="text-sm font-semibold text-slate-700">
                        {item.opportunity_data.deadline}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
