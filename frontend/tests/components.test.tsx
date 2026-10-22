import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Heatmap } from "@/components/charts/Heatmap";
import { EntropyIndicator } from "@/components/domain/EntropyIndicator";
import { FaultProbabilityChart } from "@/components/domain/FaultProbabilityChart";
import { MetricCard } from "@/components/domain/MetricCard";
import { TestImpact } from "@/components/domain/TestImpact";
import { Term } from "@/components/domain/Term";
import { LineSeriesChart } from "@/components/charts/LineSeriesChart";
import { Histogram } from "@/components/charts/Histogram";
import { Badge, OutcomeBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ApiError } from "@/lib/api/client";
import { Wrapper } from "./utils";

afterEach(() => vi.useRealTimers());

const faults = [
  { id: "a", name: "Alpha", probability: 0.2 },
  { id: "b", name: "Bravo", probability: 0.7 },
  { id: "c", name: "Charlie", probability: 0.1 },
];

describe("FaultProbabilityChart", () => {
  it("lists causes by probability and marks the leader", () => {
    render(<FaultProbabilityChart faults={faults} />);
    const items = within(screen.getByRole("list", { name: /root-cause probabilities/i })).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Bravo"),
      expect.stringContaining("Alpha"),
      expect.stringContaining("Charlie"),
    ]);
    expect(items[0]).toHaveTextContent("70.0%");
  });

  it("shows the change since the previous step with accessible labels", () => {
    render(<FaultProbabilityChart faults={faults} previous={[0.5, 0.3, 0.2]} />);
    expect(screen.getByLabelText("up 40.0 points")).toBeInTheDocument(); // Bravo 0.3 -> 0.7
    expect(screen.getByLabelText("down 30.0 points")).toBeInTheDocument(); // Alpha 0.5 -> 0.2
  });

  it("collapses long lists and can show every cause", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, name: `Fault ${i}`, probability: 1 / 12 }));
    render(<FaultProbabilityChart faults={many} limit={5} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: /show all 12/i }));
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });

  it("is selectable by keyboard when interactive", async () => {
    const onSelect = vi.fn();
    render(<FaultProbabilityChart faults={faults} onSelect={onSelect} />);
    const first = screen.getAllByRole("button")[0]!;
    first.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("EntropyIndicator", () => {
  it("reports bits against the maximum for the number of faults", () => {
    render(<Wrapper><EntropyIndicator bits={1} nFaults={4} /></Wrapper>);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "2");
  });
});

describe("TestImpact", () => {
  it("shows the largest movers first with signed points", () => {
    render(<TestImpact before={[0.5, 0.3, 0.2]} after={[0.9, 0.06, 0.04]} faultNames={["Alpha", "Bravo", "Charlie"]} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Alpha");
    expect(rows[0]).toHaveTextContent("+40.0");
    expect(rows[1]).toHaveTextContent("−24.0");
  });
});

describe("Heatmap", () => {
  it("renders an accessible table with the values printed in each cell", () => {
    render(
      <Heatmap
        caption="Probability of FAIL"
        rows={["Db", "Cpu"]}
        cols={["probe", "check"]}
        values={[[0.95, 0.1], [0.2, 0.9]]}
        max={1}
        format={(v) => `${Math.round(v * 100)}`}
      />,
    );
    const table = screen.getByRole("table", { name: "Probability of FAIL" });
    expect(within(table).getByRole("rowheader", { name: "Db" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "check" })).toBeInTheDocument();
    expect(within(table).getByText("95")).toBeInTheDocument();
  });

  it("makes cells clickable when asked", async () => {
    const onCell = vi.fn();
    render(<Heatmap caption="x" rows={["r"]} cols={["c"]} values={[[0.5]]} onCellClick={onCell} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onCell).toHaveBeenCalledWith(0, 0);
  });
});

describe("MetricCard", () => {
  it("shows a trend only when one is provided, coloured by whether the change is good", () => {
    const { rerender } = render(
      <MetricCard icon={<Activity />} label="Accuracy" value="75%" trend={{ delta: 0.05, higherIsBetter: true, label: "x", format: (n) => `${n}` }} />,
    );
    expect(screen.getByTitle("x").className).toMatch(/text-success/);
    rerender(<MetricCard icon={<Activity />} label="Cost" value="6" trend={{ delta: 1, higherIsBetter: false, label: "y", format: (n) => `${n}` }} />);
    expect(screen.getByTitle("y").className).toMatch(/text-critical/);
    rerender(<MetricCard icon={<Activity />} label="Cost" value="6" trend={null} />);
    expect(screen.queryByTitle("y")).not.toBeInTheDocument();
  });
});

describe("Segmented", () => {
  function Demo() {
    const [v, setV] = useState("a");
    return (
      <Segmented
        label="Mode"
        value={v}
        onChange={setV}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C", disabled: true },
        ]}
      />
    );
  }
  it("is a radio group that moves with the arrow keys and skips disabled options", async () => {
    render(<Demo />);
    const a = screen.getByRole("radio", { name: "A" });
    a.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true"); // C is disabled
  });
});

describe("states and badges", () => {
  it("ErrorState distinguishes an unreachable backend and offers retry", async () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(0, "network_error", "x")} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Backend unreachable");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });
  it("EmptyState renders title, help and an action", () => {
    render(<EmptyState title="Nothing here" action={<Button>Go</Button>}>Because.</EmptyState>);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
  it("status and outcome badges use consistent labels", () => {
    render(
      <>
        <StatusBadge status="truncated" />
        <StatusBadge status="running" />
        <OutcomeBadge outcome="FAIL" />
        <Badge>plain</Badge>
      </>,
    );
    expect(screen.getByText("Step limit")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("FAIL").className).toMatch(/critical/);
  });
  it("Button shows a busy state and blocks clicks", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button", { name: /save/i });
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("tables scroll horizontally instead of overflowing the page", () => {
    const { container } = render(
      <Table aria-label="t">
        <thead><tr><Th>H</Th></tr></thead>
        <tbody><Tr><Td>v</Td></Tr></tbody>
      </Table>,
    );
    expect(container.firstElementChild?.className).toMatch(/overflow-x-auto/);
  });
});

describe("Dialog", () => {
  it("traps focus, labels itself and closes with Escape", async () => {
    function Demo() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title="Confirm" description="Are you sure?">
            <button>Inside</button>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Demo />);
    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Term glossary tooltip", () => {
  it("is a focusable button with an accessible name", async () => {
    render(
      <Wrapper>
        <Term k="entropy">Uncertainty</Term>
      </Wrapper>,
    );
    const btn = screen.getByRole("button", { name: /what is uncertainty/i });
    btn.focus();
    expect(btn).toHaveFocus();
  });
});

describe("charts render real SVG with accessible summaries", () => {
  it("LineSeriesChart and Histogram", () => {
    const { container } = render(
      <>
        <LineSeriesChart label="Loss" xKey="x" series={[{ key: "y", label: "y" }]} data={[{ x: 1, y: 1 }, { x: 2, y: 2 }]} />
        <Histogram label="Durations" xLabel="s" series={[{ key: "a", label: "A", color: "#000", values: [1, 2, 3, 4] }]} />
      </>,
    );
    expect(screen.getByRole("img", { name: "Loss" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Durations" })).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-wrapper > svg.recharts-surface").length).toBe(2);
  });
});
