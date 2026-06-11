"use client";

import { useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const router = useRouter();

  async function handleAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setMessage({ text: "Supabase is not configured.", type: "error" });
      return;
    }

    setIsLoading(true);
    setMessage({ text: "", type: "" });

    const response =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password, options: { data: { gender } } })
        : await supabase.auth.signInWithPassword({ email, password });

    setIsLoading(false);
    if (response.error) {
      setMessage({ text: response.error.message, type: "error" });
      return;
    }

    if (mode === "signup" && !response.data.session) {
      setMessage({ text: "Account created. Check your email to finish signing in.", type: "success" });
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-md rounded-md border border-zinc-200 bg-white p-6">
        <h1 className="text-2xl font-semibold text-zinc-950">AlumniAspirations</h1>
        <p className="mt-2 text-sm text-zinc-600">Save listings, track applications, and get personalized sorting.</p>

        <div className="mt-6 grid grid-cols-2 rounded-md border border-zinc-200 p-1">
          {[
            ["login", "Log in"],
            ["signup", "Sign up"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value as "login" | "signup");
                setMessage({ text: "", type: "" });
              }}
              className={`rounded px-3 py-2 text-sm font-medium ${
                mode === value ? "bg-zinc-900 text-white" : "text-zinc-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form className="mt-6 grid gap-4" onSubmit={handleAuth}>
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
              required
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-teal-700"
              required
            />
          </label>

          {mode === "signup" ? (
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Gender
              <select
                value={gender}
                onChange={(event) => setGender(event.target.value)}
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-teal-700"
                required
              >
                <option value="" disabled>Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Non-binary">Non-binary</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </label>
          ) : null}

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
            disabled={isLoading}
            className="h-10 rounded-md bg-teal-800 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {isLoading ? "Working..." : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>
      </div>
    </main>
  );
}
