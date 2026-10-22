import type { Metadata } from "next";
import { Comparison } from "@/features/comparison/Comparison";

export const metadata: Metadata = { title: "Algorithm Comparison" };

export default function ComparisonPage() {
  return <Comparison />;
}
