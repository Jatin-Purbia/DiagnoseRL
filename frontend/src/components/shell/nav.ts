import {
  BrainCircuit,
  Boxes,
  Bug,
  History,
  LayoutDashboard,
  Radar,
  Scale,
  Settings,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, description: "Accuracy, cost and recent outcomes" },
  { href: "/playground", label: "Diagnostic Playground", icon: Stethoscope, description: "Run an investigation step by step" },
  { href: "/investigations", label: "Live Investigations", icon: Radar, description: "All investigations and their traces" },
  { href: "/training", label: "RL Training", icon: BrainCircuit, description: "Train and monitor policies" },
  { href: "/comparison", label: "Algorithm Comparison", icon: Scale, description: "Benchmark policies on held-out incidents" },
  { href: "/faults", label: "Fault Explorer", icon: Bug, description: "Simulated failures and their test signatures" },
  { href: "/experiments", label: "Experiment History", icon: History, description: "Past training runs" },
  { href: "/models", label: "Model Registry", icon: Boxes, description: "Registered policies and activation" },
  { href: "/settings", label: "Settings", icon: Settings, description: "Connection, theme and admin access" },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function titleFor(pathname: string): string {
  return NAV_ITEMS.find((n) => isActive(pathname, n.href))?.label ?? "DiagnoseRL";
}
