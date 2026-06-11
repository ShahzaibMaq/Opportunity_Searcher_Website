"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { LayoutDashboard, LogOut, Search, UserCircle } from "lucide-react";
import { BrandLogo } from "./BrandLogo";

export function Navigation() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

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
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error(error.message);
      }
    }
  };

  const navLinkClass = (path: string) => {
    const isActive = pathname === path;
    return `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
      isActive
        ? "bg-zinc-900 text-white"
        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
    }`;
  };

  return (
    <nav className="border-b border-zinc-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo />
          </Link>
          <div className="mx-2 h-6 w-px bg-zinc-200" aria-hidden="true" />
          <div className="flex gap-2">
            <Link href="/" className={navLinkClass("/")}>
              <Search size={18} />
              Browse
            </Link>
            {user && (
              <>
                <Link href="/planner" className={navLinkClass("/planner")}>
                  <LayoutDashboard size={18} />
                  My Planner
                </Link>
                <Link href="/account" className={navLinkClass("/account")}>
                  <UserCircle size={18} />
                  Account
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-4">
              <span className="hidden text-sm text-zinc-500 sm:inline">
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-teal-800 px-4 py-2 text-sm font-medium text-white"
            >
              Log In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
