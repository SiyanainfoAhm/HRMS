import Link from "next/link";
import { APP_NAME } from "@/lib/appBranding";

/** Public self-signup is disabled — CIRT accounts are provisioned by administrators. */
export default function SignupPage() {
  return (
    <div className="flex min-h-screen min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md space-y-4 text-center shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-blue">{APP_NAME}</p>
        <h1 className="page-title">Signup unavailable</h1>
        <p className="text-sm text-slate-600">
          Signup is disabled. Please contact administrator.
        </p>
        <Link href="/auth/login" className="btn btn-primary inline-flex w-full justify-center">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
