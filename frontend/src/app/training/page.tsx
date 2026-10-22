import type { Metadata } from "next";
import { Suspense } from "react";
import { Training } from "@/features/training/Training";

export const metadata: Metadata = { title: "RL Training" };

export default function TrainingPage() {
  return (
    <Suspense fallback={null}>
      <Training />
    </Suspense>
  );
}
