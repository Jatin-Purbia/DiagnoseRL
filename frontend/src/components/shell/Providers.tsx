"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";

/** Retry transient failures (network / 5xx) a couple of times, never client errors. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500) return false;
    if (error.code === "invalid_response") return false;
  }
  return failureCount < 2;
}

function notifyError(error: unknown, fallback = "Request failed"): void {
  if (error instanceof DOMException && error.name === "AbortError") return;
  const message = error instanceof ApiError ? error.friendly : error instanceof Error ? error.message : fallback;
  toast.error(message, { id: message });
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Only surface background refetch failures; first-load failures render an inline ErrorState.
        if (query.state.data !== undefined) notifyError(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _v, _c, mutation) => {
        if (mutation.meta?.silent !== true) notifyError(error);
      },
    }),
    defaultOptions: {
      queries: { staleTime: 10_000, retry: shouldRetry, refetchOnWindowFocus: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </TooltipProvider>
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "!border !border-border !bg-surface !text-ink !shadow-card",
              description: "!text-muted",
            },
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
