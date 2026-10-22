"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminKey } from "./AdminKey";

export const NAV = [
  { href: "/", label: "Overview" },
  { href: "/playground", label: "Playground" },
  { href: "/training", label: "Training" },
  { href: "/comparison", label: "Comparison" },
  { href: "/faults", label: "Fault explorer" },
  { href: "/experiments", label: "Experiments" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <aside className="border-b border-line bg-panel md:fixed md:inset-y-0 md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-3 md:block">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Diagnose<span className="text-accent">RL</span>
        </Link>
        <p className="hidden text-[11px] text-muted md:mt-0.5 md:block">Adaptive fault diagnosis</p>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
        {NAV.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel-2 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden px-4 py-4 md:absolute md:bottom-0 md:block md:w-full">
        <AdminKey />
      </div>
    </aside>
  );
}
