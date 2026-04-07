"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PasswordField } from "@/components/PasswordField";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign up failed");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Sign up failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="page-title">HRMS</h1>
          <p className="mt-1 text-sm text-slate-500">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <PasswordField
            label="Password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          <PasswordField
            label="Confirm password"
            required
            minLength={6}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? "Creating account..." : "Sign up"}
          </button>

          <GoogleAuthButton
            mode="signup"
            onSuccessRedirect="/dashboard"
            onPrefill={({ email, name }) => {
              if (email) setEmail(email);
              if (name) setName(name);
            }}
          />

          <p className="text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/auth/login" className="font-medium text-emerald-700 hover:underline">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
