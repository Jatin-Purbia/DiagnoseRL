import type { Metadata } from "next";
import { Experiments } from "@/features/experiments/Experiments";

export const metadata: Metadata = { title: "Experiment History" };

export default function ExperimentsPage() {
  return <Experiments />;
}
