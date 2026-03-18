import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="font-semibold tracking-tight text-slate-900">HRMS</span>
        </div>
      </header>
      <section className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to HRMS</h1>
      <p className="muted">
        This is the central access point for Super Admin, Admin/HR, Managers and Employees to
        manage attendance, leaves, holidays and payroll.
      </p>

      <div className="card">
        <h2 className="text-lg font-semibold mb-2">Get started</h2>
        <p className="muted mb-4">
          Sign up or log in with email and password. Users are stored with hashed passwords; roles
          are set per user (employee, manager, hr, admin, super_admin).
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/auth/login" className="btn btn-primary">
            Login
          </Link>
          <Link href="/auth/signup" className="btn btn-outline">
            Create account
          </Link>
        </div>
      </div>
      </section>
    </div>
  );
}

