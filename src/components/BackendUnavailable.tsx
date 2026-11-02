/** Shown instead of a redirect when the API cannot be reached: the session may be fine, so nothing is cleared. */
export function BackendUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Server not reachable</h1>
      <p className="text-sm text-slate-600">
        We could not reach the payroll server, so we cannot confirm your session. You have not been signed out.
        Please try again in a moment.
      </p>
      {/* A plain link (full reload) re-runs the server check. */}
      <a href="" className="btn btn-primary">
        Try again
      </a>
    </main>
  );
}
