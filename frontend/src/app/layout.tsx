import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "DiagnoseRL",
  description:
    "Adaptive, cost-aware fault diagnosis with Bayesian beliefs and reinforcement learning.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:ml-56 md:max-w-none md:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
