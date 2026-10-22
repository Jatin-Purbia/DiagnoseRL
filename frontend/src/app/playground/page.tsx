import type { Metadata } from "next";
import { Suspense } from "react";
import { Playground } from "@/features/playground/Playground";

export const metadata: Metadata = { title: "Diagnostic Playground" };

export default function PlaygroundPage() {
  // useSearchParams (the session id lives in the URL) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Playground />
    </Suspense>
  );
}
