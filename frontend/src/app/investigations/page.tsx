import type { Metadata } from "next";
import { Investigations } from "@/features/investigations/Investigations";

export const metadata: Metadata = { title: "Live Investigations" };

export default function InvestigationsPage() {
  return <Investigations />;
}
