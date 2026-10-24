"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader
          icon={<AlertTriangle className="text-critical" aria-hidden />}
          title="Something went wrong"
          description="This page hit an unexpected error. The rest of the dashboard is unaffected."
        />
        <CardContent>
          {error.message && (
            <p className="mb-4 truncate rounded-lg bg-elevated px-3 py-2 font-mono text-xs text-muted">
              {error.message}
            </p>
          )}
          <Button onClick={reset} variant="secondary" size="sm">
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
