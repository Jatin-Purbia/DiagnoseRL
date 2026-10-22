"use client";

import { Boxes, ChevronRight, KeyRound, Menu, Moon, Settings, Sun, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/ui/tooltip";
import { getAdminKey } from "@/lib/api/client";
import { shortId } from "@/lib/format";
import { useHealth, useOverview } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Brand, NavList } from "./AppSidebar";
import { titleFor } from "./nav";

export function ConnectionStatus() {
  const health = useHealth();
  const state = health.isPending
    ? { label: "Checking…", dot: "bg-muted", tip: "Checking the backend connection." }
    : health.isError
      ? { label: "Offline", dot: "bg-critical", tip: "The backend is unreachable." }
      : health.data?.status === "ready"
        ? { label: "Connected", dot: "bg-success", tip: "The API, database and artifact store are healthy." }
        : {
            label: "Degraded",
            dot: "bg-warning",
            tip: `Some checks failed: ${Object.entries(health.data?.checks ?? {})
              .filter(([, v]) => v !== "ok")
              .map(([k]) => k)
              .join(", ")}`,
          };
  return (
    <Tip content={state.tip}>
      <span
        role="status"
        aria-label={`Backend ${state.label}`}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs text-muted"
      >
        <span className={cn("size-2 rounded-full", state.dot, health.isFetching && "motion-safe:animate-pulse")} />
        <span className="hidden sm:inline">{state.label}</span>
      </span>
    </Tip>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted ? resolvedTheme === "dark" : true;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

function ActiveModelChip() {
  const overview = useOverview();
  const model = overview.data?.active_models[0];
  return (
    <Tip
      content={
        model
          ? `Active RL policy for ${model.scenario}. Used when an investigation selects the "ppo" policy.`
          : "No trained policy is active. Register and activate one in the Model Registry."
      }
    >
      <Link
        href="/models"
        className="hidden items-center gap-1.5 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink md:inline-flex"
      >
        <Boxes className="size-3.5" aria-hidden />
        <span className="max-w-40 truncate">{model ? model.name : "No active model"}</span>
      </Link>
    </Tip>
  );
}

function UserMenu() {
  const [keySet, setKeySet] = useState(false);
  useEffect(() => {
    const sync = () => setKeySet(Boolean(getAdminKey()));
    sync();
    window.addEventListener("diagnoserl:admin-key", sync);
    return () => window.removeEventListener("diagnoserl:admin-key", sync);
  }, []);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Access menu">
          <User />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Access</DropdownMenuLabel>
        <div className="px-2.5 pb-2 text-xs text-muted">
          There are no user accounts. Admin actions (training, model activation) use an API key.
        </div>
        <div className="mx-1 mb-1 flex items-center justify-between rounded-lg bg-elevated px-2.5 py-2 text-xs">
          <span className="flex items-center gap-2">
            <KeyRound className="size-3.5 text-muted" aria-hidden /> Admin key
          </span>
          <Badge tone={keySet ? "success" : "neutral"}>{keySet ? "set for this tab" : "not set"}</Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Breadcrumbs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const title = titleFor(pathname);
  const session = pathname.startsWith("/playground") ? params.get("session") : null;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link href="/" className="hidden text-muted transition-colors hover:text-ink sm:inline">
        DiagnoseRL
      </Link>
      <ChevronRight className="hidden size-3.5 text-muted/60 sm:block" aria-hidden />
      {session ? (
        <>
          <Link href="/investigations" className="hidden text-muted hover:text-ink sm:inline">
            Investigations
          </Link>
          <ChevronRight className="hidden size-3.5 text-muted/60 sm:block" aria-hidden />
          <span className="truncate font-medium" aria-current="page">
            {shortId(session)}
          </span>
        </>
      ) : (
        <span className="truncate font-medium" aria-current="page">
          {title}
        </span>
      )}
    </nav>
  );
}

export function TopNavbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu />
          </Button>
        </DialogTrigger>
        <DialogContent title="Navigation" side="left">
          <div className="p-4">
            <div className="mb-4">
              <Brand />
            </div>
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <Suspense fallback={<span className="text-sm font-medium">{titleFor(pathname)}</span>}>
        <Breadcrumbs />
      </Suspense>

      <div className="ml-auto flex items-center gap-2">
        <Tip content="All investigations run against the simulator. Advisor mode (real, human-approved diagnostics) is not exposed through the API yet.">
          <Badge tone="secondary" className="hidden sm:inline-flex">
            Simulation
          </Badge>
        </Tip>
        <ActiveModelChip />
        <ConnectionStatus />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
