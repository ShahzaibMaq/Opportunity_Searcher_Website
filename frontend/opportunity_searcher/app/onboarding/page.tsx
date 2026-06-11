"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { profileIsComplete, UserProfile } from "@/lib/opportunities";

const INTEREST_OPTIONS = ["STEM", "Computer Science", "Medicine", "Engineering", "Business", "Law", "Humanities"];
const GOAL_OPTIONS = ["Internship", "Research", "Summer Program", "Scholarship", "Competition", "Volunteering"];

type OnboardingForm = {
  grade: string;
  interests: string[];
  location: string;
  goals: string;
};

const emptyForm: OnboardingForm = {
  grade: "",
  interests: [],
  location: "",
  goals: "",
};

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState<OnboardingForm>(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      if (!supabase) {
        setMessage("Supabase is not configured.");
        setIsLoading(false);
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        setMessage(sessionError.message);
        setIsLoading(false);
        return;
      }

      const session = sessionData.session;
      if (!session) {
        router.push("/login");
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("grade, interests, location, goals")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!isMounted) return;
      if (error) setMessage(error.message);

      const mergedProfile: UserProfile = {
        ...((session.user.user_metadata ?? {}) as UserProfile),
        ...(profile ?? {}),
      };

      if (profileIsComplete(mergedProfile)) {
        router.push("/");
        return;
      }

      setUser(session.user);
      setForm({
        grade: mergedProfile.grade ? String(mergedProfile.grade) : "",
        interests: mergedProfile.interests ?? [],
        location: mergedProfile.location ?? "",
        goals: mergedProfile.goals ?? "",
      });
      setIsLoading(false);
    }

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const canSave = useMemo(
    () => Boolean(form.grade && form.interests.length && form.location.trim() && form.goals),
    [form],
  );

  function toggleInterest(interest: string) {
    setForm((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest],
    }));
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !user || !canSave) return;

    setIsSaving(true);
    setMessage("");

    const profile = {
      id: user.id,
      email: user.email ?? "",
      grade: Number(form.grade),
      interests: form.interests,
      location: form.location.trim(),
      goals: form.goals,
    };

    const [{ error: profileError }, { error: authError }] = await Promise.all([
      supabase.from("profiles").upsert(profile),
      supabase.auth.updateUser({ data: profile }),
    ]);

    setIsSaving(false);
    if (profileError || authError) {
      setMessage(profileError?.message ?? authError?.message ?? "Could not save onboarding.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (isLoading) {
    return (
      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-stone-50">
        <p className="text-sm text-zinc-600">Loading profile...</p>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-64px)] bg-stone-50 px-4 py-6 text-zinc-950 sm:px-6 lg:px-8">
      <form onSubmit={saveProfile} className="mx-auto grid max-w-2xl gap-6 rounded-md border border-zinc-200 bg-white p-6">
        <header>
          <h1 className="text-2xl font-semibold">Set up recommendations</h1>
          <p className="mt-1 text-sm text-zinc-600">Answer four questions so the browse page can sort by fit.</p>
        </header>

        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          Grade level
          <select
            value={form.grade}
            onChange={(event) => setForm((current) => ({ ...current, grade: event.target.value }))}
            className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
            required
          >
            <option value="">Select grade</option>
            {[9, 10, 11, 12].map((grade) => (
              <option key={grade} value={grade}>
                Grade {grade}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2">
          <p className="text-sm font-medium text-zinc-700">Subjects and interests</p>
          <div className="flex flex-wrap gap-2">
            {INTEREST_OPTIONS.map((interest) => (
              <button
                key={interest}
                type="button"
                onClick={() => toggleInterest(interest)}
                className={`rounded-md border px-3 py-2 text-sm ${
                  form.interests.includes(interest)
                    ? "border-teal-800 bg-teal-50 text-teal-900"
                    : "border-zinc-200 text-zinc-700"
                }`}
              >
                {interest}
              </button>
            ))}
          </div>
        </div>

        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          State or region
          <input
            value={form.location}
            onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
            placeholder="New Jersey"
            className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
            required
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          Opportunity type
          <select
            value={form.goals}
            onChange={(event) => setForm((current) => ({ ...current, goals: event.target.value }))}
            className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
            required
          >
            <option value="">Select type</option>
            {GOAL_OPTIONS.map((goal) => (
              <option key={goal}>{goal}</option>
            ))}
          </select>
        </label>

        {message ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div> : null}

        <button
          type="submit"
          disabled={!canSave || isSaving}
          className="h-10 rounded-md bg-teal-800 px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save profile"}
        </button>
      </form>
    </main>
  );
}
