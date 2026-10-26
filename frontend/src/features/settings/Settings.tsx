"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, MonitorCog, Palette, Server, XCircle } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ApiError, API_BASE, api, getAdminKey, setAdminKey } from "@/lib/api";
import { useHealth } from "@/lib/queries";

type KeyState = "unknown" | "valid" | "invalid" | "disabled";

export function Settings() {
  const health = useHealth();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [keyState, setKeyState] = useState<KeyState>("unknown");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setMounted(true);
    const k = getAdminKey();
    setKey(k);
    setSaved(Boolean(k));
  }, []);

  const version = useQuery({
    queryKey: ["openapi-version"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/openapi.json`);
      if (!res.ok) throw new Error("unavailable");
      const j = (await res.json()) as { info?: { title?: string; version?: string } };
      return `${j.info?.title ?? "API"} ${j.info?.version ?? ""}`.trim();
    },
    retry: false,
    staleTime: 60_000,
  });

  const save = () => {
    setAdminKey(key.trim());
    setSaved(Boolean(key.trim()));
    setKeyState("unknown");
    toast.success(key.trim() ? "Admin key saved for this tab" : "Admin key cleared");
  };

  /** Probe an admin endpoint with a name that cannot exist: 404 means the key was accepted. */
  const verify = async () => {
    setVerifying(true);
    try {
      setAdminKey(key.trim());
      await api.registerModel("__verify_key__");
      setKeyState("valid");
    } catch (e) {
      if (e instanceof ApiError) {
        setKeyState(e.status === 404 ? "valid" : e.status === 401 ? "invalid" : e.status === 503 ? "disabled" : "unknown");
        if (e.code === "network_error") toast.error(e.friendly);
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Connection, admin access and appearance for this browser." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Backend connection" icon={<Server />} description="Checked every 15 seconds." />
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-muted">API URL</dt>
              <dd className="break-all text-right font-mono">{API_BASE}</dd>
              <dt className="text-muted">Server</dt>
              <dd className="text-right">{version.data ?? (version.isPending ? "…" : "unavailable")}</dd>
              <dt className="text-muted">Status</dt>
              <dd className="text-right">
                {health.isPending ? (
                  <Badge>Checking…</Badge>
                ) : health.isError ? (
                  <Badge tone="critical">Offline</Badge>
                ) : health.data?.status === "ready" ? (
                  <Badge tone="success">Ready</Badge>
                ) : (
                  <Badge tone="warning">Degraded</Badge>
                )}
              </dd>
            </dl>
            {health.data?.checks && (
              <ul aria-label="Readiness checks" className="space-y-1.5 rounded-lg border border-border bg-elevated/50 p-3 text-xs">
                {Object.entries(health.data.checks).map(([name, state]) => (
                  <li key={name} className="flex items-center justify-between">
                    <span className="capitalize">{name}</span>
                    <span className="inline-flex items-center gap-1.5">
                      {state === "ok" ? <CheckCircle2 className="size-3.5 text-success" aria-hidden /> : <XCircle className="size-3.5 text-critical" aria-hidden />}
                      {state}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {health.isError && (
              <p role="alert" className="text-xs text-critical">
                The API is not reachable at {API_BASE}. Start it, or set NEXT_PUBLIC_API_URL and rebuild the frontend.
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => health.refetch()} loading={health.isFetching && !health.isPending}>
              Check now
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Admin access"
            icon={<KeyRound />}
            description="Starting training or evaluation and activating models require the server's admin API key. It is kept in this tab's session storage only and sent as the X-API-Key header."
          />
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <Field label="Admin API key">
                <Input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="paste the key"
                  aria-label="Admin API key"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={verify} loading={verifying} disabled={!key.trim()}>
                  Verify key
                </Button>
                {saved && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setKey("");
                      setAdminKey("");
                      setSaved(false);
                      setKeyState("unknown");
                      toast.success("Admin key cleared");
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <p role="status" className="text-xs">
                {keyState === "valid" && <span className="text-success">The server accepted this key.</span>}
                {keyState === "invalid" && <span className="text-critical">The server rejected this key.</span>}
                {keyState === "disabled" && <span className="text-warning">Admin actions are disabled on the server (no key configured).</span>}
                {keyState === "unknown" && <span className="text-muted">{saved ? "Saved for this tab. Not verified yet." : "No key set."}</span>}
              </p>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Appearance" icon={<Palette />} />
          <CardContent className="space-y-3">
            <Segmented
              label="Theme"
              value={(mounted ? theme : "dark") ?? "dark"}
              onChange={setTheme}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "System" },
              ]}
            />
            <p className="text-xs text-muted">
              Animations follow your operating system&apos;s reduced-motion setting automatically.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Environment" icon={<MonitorCog />} />
          <CardContent className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span>Simulation</span>
              <Badge tone="success">in use</Badge>
            </div>
            <p className="text-muted">
              Every investigation runs against the simulator. Hidden root causes and test outcomes are generated by
              the backend; nothing touches a real system.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
