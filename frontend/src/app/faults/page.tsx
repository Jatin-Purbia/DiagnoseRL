import type { Metadata } from "next";
import { Faults } from "@/features/faults/Faults";

export const metadata: Metadata = { title: "Fault Explorer" };

export default function FaultsPage() {
  return <Faults />;
}
