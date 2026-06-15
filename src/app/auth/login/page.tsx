"use client";

import { FormEvent, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Building2, Shield } from "lucide-react";
import { PasswordField } from "@/components/PasswordField";
import { setToken } from "@/lib/api";
import { APP_NAME } from "@/lib/appBranding";
import { validateLoginEmail, validateLoginPassword } from "@/lib/loginValidators";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/motion";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showEmailValidation = emailTouched || email.length > 0;
  const showPasswordValidation = passwordTouched || password.length > 0;

  const emailError = useMemo(
    () => (showEmailValidation ? validateLoginEmail(email) : null),
    [email, showEmailValidation],
  );
  const passwordError = useMemo(
    () => (showPasswordValidation ? validateLoginPassword(password) : null),
    [password, showPasswordValidation],
  );

  const canSubmit = !emailError && !passwordError && email.trim() !== "" && password !== "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEmailTouched(true);
    setPasswordTouched(true);
    const eErr = validateLoginEmail(email);
    const pErr = validateLoginPassword(password);
    if (eErr || pErr) {
      setError(eErr || pErr);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid email or password. Please try again.");
        setLoading(false);
        return;
      }
      if (data.token) setToken(data.token);

      const role = data.user?.role;
      if (role === "super_admin" || role === "admin") {
        const companyRes = await fetch("/api/company/me");
        const companyData = await companyRes.json().catch(() => ({}));
        if (!companyData?.company) {
          router.push("/setup/company");
          router.refresh();
          return;
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to sign in. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh]">
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35 }}
        className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-navy via-brand-blue to-brand-teal p-10 text-white lg:flex xl:max-w-2xl"
      >
        <div className="relative z-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Building2 className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-blue-100/90">
            Payroll management for Central Institute of Road Transport. Run payroll, manage employee
            master data, and access salary slips securely.
          </p>
        </div>
        <ul className="relative z-10 space-y-4 text-sm text-blue-50/90">
          <li className="flex gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            Role-based access for employees and administrators
          </li>
          <li className="flex gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            Payroll master, monthly payroll runs, and salary slips
          </li>
        </ul>
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
      </motion.aside>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="w-full max-w-md space-y-8"
        >
          <motion.div variants={staggerItem} className="text-center lg:text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-blue lg:hidden">{APP_NAME}</p>
            <h2 className="page-title mt-1">Welcome back</h2>
            <p className="muted mt-2">Sign in with your CIRT institutional account</p>
          </motion.div>

          <motion.form variants={staggerItem} onSubmit={handleSubmit} className="card space-y-5 shadow-card" noValidate>
            <div>
              <label htmlFor="email" className="label-field">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "email-error" : undefined}
                className={`input-field ${emailError ? "!border-red-400 focus:!border-red-500 focus:!ring-red-500/30" : ""}`}
                placeholder="you@cirtpune.org"
              />
              {emailError && (
                <p id="email-error" className="mt-1 text-xs text-red-600" role="alert">
                  {emailError}
                </p>
              )}
            </div>
            <PasswordField
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              onBlur={() => setPasswordTouched(true)}
              error={passwordError}
            />

            {error && (
              <p className="rounded-xl border border-red-200 bg-danger-soft px-3 py-2 text-sm text-red-800" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary w-full !py-3" disabled={loading || !canSubmit}>
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <p className="text-center text-xs text-brand-muted">
              Access is provisioned by CIRT administration. Contact your administrator if you need an account.
            </p>
          </motion.form>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-brand-bg">
          <div className="h-10 w-10 animate-pulse rounded-full bg-brand-blue/20" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
