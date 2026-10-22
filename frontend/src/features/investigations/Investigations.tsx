"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { policyLabel } from "@/components/charts/theme";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { dateTime, label, modelledSeconds, num, relativeTime, shortId } from "@/lib/format";
import { useAnalytics, useSessions } from "@/lib/queries";

const PAGE_SIZE = 15;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Investigations() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [scenario, setScenario] = useState("");
  const [policy, setPolicy] = useState("");
  const [page, setPage] = useState(0);
  const q = useDebounced(search.trim());

  useEffect(() => setPage(0), [q, status, scenario, policy]);

  const options = useAnalytics({}).data?.options;
  const sessions = useSessions({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(scenario ? { scenario } : {}),
    ...(policy ? { policy } : {}),
    ...(q ? { q } : {}),
  });
  const data = sessions.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered = Boolean(q || status || scenario || policy);

  return (
    <>
      <PageHeader
        title="Live Investigations"
        description="Every investigation stored by the backend. Open one to continue it (if active) or replay its trace."
        actions={
          <Button asChild>
            <Link href="/playground">New investigation</Link>
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-xs font-medium text-muted">
            Search by investigation ID
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. 3f9a2c"
                className="pl-9"
                aria-label="Search by investigation ID"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Status
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="w-36">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="declared">Declared</option>
              <option value="truncated">Step limit</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Scenario
            <Select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario" className="w-36">
              <option value="">All</option>
              {options?.scenarios.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Algorithm
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)} aria-label="Algorithm" className="w-44">
              <option value="">All</option>
              {options?.policies.map((p) => (
                <option key={p} value={p}>
                  {policyLabel(p)}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      {sessions.isError && !data ? (
        <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
      ) : sessions.isPending ? (
        <SkeletonRows rows={6} />
      ) : data && data.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No investigations match these filters" : "No investigations yet"}
          action={
            !filtered ? (
              <Button asChild>
                <Link href="/playground">Start one</Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setStatus("");
                  setScenario("");
                  setPolicy("");
                }}
              >
                Clear filters
              </Button>
            )
          }
        >
          {filtered ? "Try a shorter ID prefix or remove a filter." : "Run an investigation in the Diagnostic Playground."}
        </EmptyState>
      ) : (
        data && (
          <Card>
            <Table aria-label="Investigations" className="min-w-[56rem]">
              <thead>
                <tr>
                  <Th>Investigation</Th>
                  <Th>Started</Th>
                  <Th>Scenario</Th>
                  <Th>Algorithm</Th>
                  <Th>Status</Th>
                  <Th>Steps</Th>
                  <Th>Cost</Th>
                  <Th>Time</Th>
                  <Th>Reward</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <Tr
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/playground?session=${s.id}`)}
                  >
                    <Td>
                      <Link
                        href={`/playground?session=${s.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {shortId(s.id)}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted" title={dateTime(s.created_at)}>
                      {relativeTime(s.created_at)}
                    </Td>
                    <Td>{s.scenario}</Td>
                    <Td>{policyLabel(s.policy)}</Td>
                    <Td>
                      <StatusBadge status={s.status} />
                    </Td>
                    <Td>{s.steps}</Td>
                    <Td>{num(s.cost, 1)}</Td>
                    <Td>{modelledSeconds(s.elapsed)}</Td>
                    <Td>{s.status === "active" ? "—" : num(s.total_reward, 1)}</Td>
                    <Td className="text-xs">
                      {s.status === "active" ? (
                        <span className="text-muted">in progress</span>
                      ) : s.status === "truncated" ? (
                        <Badge tone="critical">no diagnosis</Badge>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <Badge tone={s.correct ? "success" : "critical"}>{s.correct ? "correct" : "incorrect"}</Badge>
                          <span className="text-muted">
                            {label(s.declared_fault ?? "")}
                            {!s.correct && s.true_fault ? ` (was ${label(s.true_fault)})` : ""}
                          </span>
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted">
              <span>
                {data.total.toLocaleString()} investigation{data.total === 1 ? "" : "s"}
                {filtered ? " match" : ""} · page {page + 1} of {pages}
              </span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </span>
            </div>
          </Card>
        )
      )}
    </>
  );
}
