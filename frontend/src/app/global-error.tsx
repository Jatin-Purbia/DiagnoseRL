"use client";

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-base text-ink">
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-card">
            <h1 className="text-sm font-semibold tracking-tight">DiagnoseRL hit an unrecoverable error</h1>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Reloading the dashboard usually resolves this. If it keeps happening, check the
              browser console for details.
            </p>
            {error.message && (
              <p className="mt-4 truncate rounded-lg bg-elevated px-3 py-2 font-mono text-xs text-muted">
                {error.message}
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-ink shadow-sm hover:brightness-110"
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
