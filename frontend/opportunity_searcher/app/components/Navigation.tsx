"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LogOut, LayoutDashboard, Search } from "lucide-react";

export function Navigation() {
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  const navLinkClass = (path: string) => {
    const isActive = pathname === path;
    return `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
      isActive
        ? "bg-slate-950 text-white"
        : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
    }`;
  };

  return (
    <nav className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-white font-bold text-lg">
              O
            </div>
            <span className="hidden sm:inline font-semibold text-slate-900">
              Opportunity Searcher
            </span>
          </Link>
          <div className="h-6 w-px bg-slate-200 mx-2" aria-hidden="true" />
          <div className="flex gap-2">
            <Link href="/" className={navLinkClass("/")}>
              <Search size={18} />
              Browse
            </Link>
            {user && (
              <Link href="/planner" className={navLinkClass("/planner")}>
                <LayoutDashboard size={18} />
                My Planner
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500 hidden sm:inline">
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Log In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
