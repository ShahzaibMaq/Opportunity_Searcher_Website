"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { Save } from "lucide-react";
import { supabase } from "@/lib/supabase";

const INTEREST_OPTIONS = ["STEM", "Computer Science", "Medicine", "Engineering", "Business", "Law", "Humanities"];
const GOAL_OPTIONS = ["Internship", "Research", "Summer Program", "Scholarship", "Competition", "Volunteering"];

type ProfileForm = {
  username: string;
  age: string;
  gender: string;
  grade: string;
  interests: string[];
  location: string;
  goals: string;
};

const emptyProfile: ProfileForm = {
  username: "",
  age: "",
  gender: "",
  grade: "",
  interests: [],
  location: "",
  goals: "",
};

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    let isMounted = true;

    async function loadAccount() {
      if (!supabase) {
        setMessage({ text: "Supabase is not configured.", type: "error" });
        setIsLoading(false);
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        setMessage({ text: sessionError.message, type: "error" });
        setIsLoading(false);
        return;
      }

      const session = sessionData.session;
      if (!session) {
        await Promise.resolve();
        if (!isMounted) return;
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("username, age, gender, grade, interests, location, goals")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!isMounted) return;
      if (error) setMessage({ text: error.message, type: "error" });

      const metadata = session.user.user_metadata ?? {};
      setUser(session.user);
      setForm({
        username: data?.username ?? metadata.username ?? "",
        age: data?.age ? String(data.age) : metadata.age ?? "",
        gender: data?.gender ?? metadata.gender ?? "",
        grade: data?.grade ? String(data.grade) : metadata.grade ? String(metadata.grade) : "",
        interests: data?.interests ?? metadata.interests ?? [],
        location: data?.location ?? metadata.location ?? "",
        goals: data?.goals ?? metadata.goals ?? "",
      });
      setIsLoading(false);
    }

    loadAccount();
    return () => {
      isMounted = false;
    };
  }, [router]);

  function updateField(field: keyof ProfileForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

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
    if (!supabase || !user) return;

    setIsSaving(true);
    setMessage({ text: "", type: "" });

    const profile = {
      id: user.id,
      email: user.email ?? "",
      username: form.username.trim(),
      age: form.age ? Number(form.age) : null,
      gender: form.gender,
      grade: form.grade ? Number(form.grade) : null,
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
      setMessage({ text: profileError?.message ?? authError?.message ?? "Could not save account.", type: "error" });
      return;
    }

    setMessage({ text: "Account updated.", type: "success" });
  }

  if (isLoading) {
    return (
      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-stone-50">
        <p className="text-sm text-zinc-600">Loading account...</p>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-64px)] bg-stone-50 px-4 py-6 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-3xl gap-5">
        <header className="border-b border-zinc-200 pb-4">
          <h1 className="text-2xl font-semibold">Account</h1>
          <p className="mt-1 text-sm text-zinc-600">{user?.email}</p>
        </header>

        <form onSubmit={saveProfile} className="grid gap-5 rounded-md border border-zinc-200 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Username
              <input
                value={form.username}
                onChange={(event) => updateField("username", event.target.value)}
                className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Grade
              <select
                value={form.grade}
                onChange={(event) => updateField("grade", event.target.value)}
                className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
              >
                <option value="">Select grade</option>
                {[9, 10, 11, 12].map((grade) => (
                  <option key={grade} value={grade}>
                    Grade {grade}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Age
              <input
                type="number"
                min="10"
                max="25"
                value={form.age}
                onChange={(event) => updateField("age", event.target.value)}
                className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Gender
              <select
                value={form.gender}
                onChange={(event) => updateField("gender", event.target.value)}
                className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
              >
                <option value="">Select</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Nonbinary">Nonbinary</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Location
            <input
              value={form.location}
              onChange={(event) => updateField("location", event.target.value)}
              placeholder="City, state"
              className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
            />
          </label>

          <div className="grid gap-2">
            <p className="text-sm font-medium text-zinc-700">Interests</p>
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
            Opportunity goal
            <select
              value={form.goals}
              onChange={(event) => updateField("goals", event.target.value)}
              className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
            >
              <option value="">Select type</option>
              {GOAL_OPTIONS.map((goal) => (
                <option key={goal}>{goal}</option>
              ))}
            </select>
          </label>

          {message.text ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                message.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-teal-200 bg-teal-50 text-teal-800"
              }`}
            >
              {message.text}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSaving}
            className="flex h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            <Save size={16} />
            {isSaving ? "Saving..." : "Save account"}
          </button>
        </form>
      </div>
    </main>
  );
}
