import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HBars, Lines, Tradeoff } from "@/components/charts";
import { Nav } from "@/components/Nav";
import ComparisonPage from "@/app/comparison/page";
import ExperimentsPage from "@/app/experiments/page";
import FaultExplorerPage from "@/app/faults/page";
import OverviewPage from "@/app/page";
import TrainingPage from "@/app/training/page";
import type { Overview } from "@/lib/types";
import { mockApi } from "./helpers";

vi.mock("next/navigation", () => ({ usePathname: () => "/playground" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

const emptyOverview: Overview = {
  total_sessions: 0, finished_sessions: 0, declared_sessions: 0, success_rate: null,
  avg_tests: null, avg_duration: null, avg_cost: null, active_models: [], recent_sessions: [],
  by_policy: [], strategy_comparison: [], latest_evaluation_id: null,
};

describe("Overview", () => {
  it("shows loading, then empty states", async () => {
    mockApi({ "GET /overview": () => ({ json: emptyOverview }) });
    render(<OverviewPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("No active model")).toBeInTheDocument();
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
    expect(screen.getByText("No evaluation yet")).toBeInTheDocument();
  });

  it("renders live statistics and the strategy chart", async () => {
    mockApi({
      "GET /overview": () => ({
        json: {
          ...emptyOverview,
          total_sessions: 12, finished_sessions: 10, declared_sessions: 9, success_rate: 0.7778,
          avg_tests: 4.5, avg_duration: 22, avg_cost: 6.1,
          active_models: [{ id: "m1", name: "full_seed0:best", scenario: "standard" }],
          recent_sessions: [{ id: "s1", scenario: "standard", policy: "info_gain", status: "declared", steps: 4, created_at: "2026-10-22T00:00:00Z" }],
          strategy_comparison: [
            { policy: "cost_aware_bayes", mean_reward: 3.8 },
            { policy: "ppo", mean_reward: 2.2 },
          ],
        },
      }),
    });
    render(<OverviewPage />);
    expect(await screen.findByText("77.8%")).toBeInTheDocument();
    expect(screen.getByText("full_seed0:best")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /mean reward by strategy/i })).toBeInTheDocument();
  });

  it("surfaces errors and retries", async () => {
    const user = userEvent.setup();
    let fail = true;
    mockApi({
      "GET /overview": () =>
        fail
          ? { status: 500, json: { error: { code: "internal_error", message: "internal server error" } } }
          : { json: emptyOverview },
    });
    render(<OverviewPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("internal server error");
    fail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("No sessions yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Training and experiments", () => {
  it("shows empty states when nothing has been trained", async () => {
    mockApi({
      "GET /experiments": () => ({ json: { items: [], total: 0, limit: 50, offset: 0 } }),
      "GET /models": () => ({ json: [] }),
      "GET /scenarios": () => ({ json: [] }),
    });
    render(<TrainingPage />);
    expect(await screen.findByText("No training experiments")).toBeInTheDocument();
    expect(screen.getByText(/select an experiment/i)).toBeInTheDocument();
  });

  it("explains a missing admin key when starting training", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /experiments": () => ({ json: { items: [], total: 0, limit: 50, offset: 0 } }),
      "GET /models": () => ({ json: [] }),
      "GET /scenarios": () => ({ json: [{ name: "small", description: "", n_faults: 4, n_tests: 5, max_steps: 6 }] }),
      "POST /experiments/training": () => ({
        status: 401, json: { error: { code: "unauthorized", message: "missing or invalid API key" } },
      }),
    });
    render(<TrainingPage />);
    await user.click(await screen.findByRole("button", { name: /queue training/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/admin api key/i);
  });

  it("lists experiments with progress and validation curve", async () => {
    mockApi({
      "GET /experiments": () => ({
        json: {
          items: [{
            id: "e1", name: "x", status: "succeeded", run_name: "full_seed0", seed: 0,
            total_timesteps: 1000, progress_timesteps: 1000, error: null,
            created_at: "2026-10-22T00:00:00Z", started_at: null, finished_at: null, config: {},
          }],
          total: 1, limit: 50, offset: 0,
        },
      }),
      "GET /models": () => ({ json: [] }),
      "GET /scenarios": () => ({ json: [] }),
      "GET /experiments/e1": () => ({
        json: {
          id: "e1", name: "x", status: "succeeded", run_name: "full_seed0", seed: 0,
          total_timesteps: 1000, progress_timesteps: 1000, error: null,
          created_at: "2026-10-22T00:00:00Z", started_at: null, finished_at: null, config: {},
          validation_curve: [
            { timesteps: 0, mean_reward: -8, accuracy: 0.1, mean_tests: 2, mean_cost: 2 },
            { timesteps: 500, mean_reward: 1.5, accuracy: 0.6, mean_tests: 5, mean_cost: 6 },
          ],
          artifacts: ["config.json", "summary.json"],
        },
      }),
    });
    render(<TrainingPage />);
    expect(await screen.findByRole("img", { name: /validation mean reward/i })).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "config.json" })).toBeInTheDocument();
  });

  it("experiments page: registry actions report admin errors", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /experiments": () => ({ json: { items: [], total: 0, limit: 50, offset: 0 } }),
      "GET /evaluations": () => ({ json: { items: [], total: 0, limit: 50, offset: 0 } }),
      "GET /models": () => ({
        json: [{
          id: "m1", name: "full_seed0:best", scenario: "standard", experiment_id: null, sha256: "a".repeat(64),
          include_posterior: true, seed: 0, metrics: { validation: { mean_reward: 2.1, accuracy: 0.6 } },
          is_active: false, created_at: "2026-10-22T00:00:00Z",
        }],
      }),
      "POST /models/m1/activate": () => ({
        status: 401, json: { error: { code: "unauthorized", message: "missing or invalid API key" } },
      }),
    });
    render(<ExperimentsPage />);
    await user.click(await screen.findByRole("button", { name: /activate/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/admin api key/i);
  });
});

describe("Comparison", () => {
  it("shows an empty state with instructions when no evaluation exists", async () => {
    mockApi({ "GET /evaluations": () => ({ json: { items: [], total: 0, limit: 50, offset: 0 } }) });
    render(<ComparisonPage />);
    expect(await screen.findByText("No completed evaluations yet")).toBeInTheDocument();
  });

  it("renders results with the statistical comparison and honest verdicts", async () => {
    const summary = (acc: number, reward: number) => ({
      accuracy: acc, mean_tests: 5, mean_cost: 6, mean_duration: 20, no_diagnosis_rate: 0, mean_reward: reward,
      per_fault: { db_down: { precision: 0.9, recall: 0.8 } }, confusion_matrix: [[1, 0]],
    });
    mockApi({
      "GET /evaluations": () => ({
        json: {
          items: [{ id: "ev1", status: "succeeded", params: { run_names: ["full_seed0"] }, error: null,
            created_at: "2026-10-22T00:00:00Z", started_at: null, finished_at: "2026-10-22T01:00:00Z" }],
          total: 1, limit: 50, offset: 0,
        },
      }),
      "GET /evaluations/ev1/results": () => ({
        json: {
          n_test_episodes: 2000, n_val_episodes: 1000, tuned_on_validation: {},
          baselines: {
            fixed_order: { summary: summary(0.58, -0.2), reward_ci: [-0.5, 0.1] },
            random: { summary: summary(0.35, -4.0), reward_ci: [-4.4, -3.6] },
            info_gain: { summary: summary(0.73, 3.2), reward_ci: [2.9, 3.5] },
            cost_aware_bayes: { summary: summary(0.75, 3.8), reward_ci: [3.5, 4.1] },
          },
          rl: {
            per_seed: { full_seed0: { accuracy: 0.66, mean_cost: 7, mean_reward: 2.2 } },
            per_seed_full: { full_seed0: summary(0.66, 2.2) },
            aggregate: {
              accuracy: { mean: 0.66, std: 0.01 }, mean_tests: { mean: 6, std: 0.2 }, mean_cost: { mean: 7, std: 0.2 },
              mean_duration: { mean: 25, std: 1 }, no_diagnosis_rate: { mean: 0, std: 0 }, mean_reward: { mean: 2.2, std: 0.1 },
            },
            seed_averaged_reward_ci: [2.0, 2.4],
          },
          paired_rl_minus_baseline: {
            cost_aware_bayes: { mean_diff: -1.6, ci_low: -1.9, ci_high: -1.3, significant: true },
            info_gain: { mean_diff: -1.0, ci_low: -1.3, ci_high: -0.7, significant: true },
            fixed_order: { mean_diff: 2.4, ci_low: 2.0, ci_high: 2.8, significant: true },
            random: { mean_diff: 6.2, ci_low: 5.8, ci_high: 6.6, significant: true },
          },
          sweeps: [
            { family: "fixed_order", param: 2, accuracy: 0.27, mean_cost: 3, mean_tests: 2, mean_duration: 15, mean_reward: -5 },
            { family: "fixed_order", param: 4, accuracy: 0.4, mean_cost: 5, mean_tests: 4, mean_duration: 21, mean_reward: -3 },
          ],
        },
      }),
    });
    render(<ComparisonPage />);
    expect(await screen.findByText("Performance")).toBeInTheDocument();
    // PPO worse than the Bayesian baselines is reported as such, not hidden
    expect(await screen.findAllByText("PPO worse")).toHaveLength(2);
    expect(screen.getAllByText("PPO better")).toHaveLength(2);
    expect(screen.getByRole("img", { name: /accuracy versus mean testing cost/i })).toBeInTheDocument();
    expect(screen.getByText(/mean ± std over 1 seeds/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText("confusion ppo")).toBeInTheDocument());
  });
});

describe("Fault explorer", () => {
  it("renders priors, the test catalogue and the outcome matrix", async () => {
    mockApi({
      "GET /scenarios": () => ({ json: [{ name: "standard", description: "", n_faults: 2, n_tests: 1, max_steps: 5 }] }),
      "GET /scenarios/standard": () => ({
        json: {
          name: "standard", description: "", n_faults: 2, n_tests: 1, max_steps: 5,
          outcomes: ["PASS", "FAIL"],
          faults: [{ id: "a", name: "Fault A", prior: 0.6 }, { id: "b", name: "Fault B", prior: 0.4 }],
          tests: [{ id: "t", name: "Probe", description: "", category: "network", cost: 2, duration: 4, outcomes: ["PASS", "FAIL"], requires: [], likelihood: [[0.9, 0.1], [0.2, 0.8]] }],
        },
      }),
    });
    render(<FaultExplorerPage />);
    expect(await screen.findByText("How the environment works")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /prior probability of each fault/i })).toBeInTheDocument();
    expect(await screen.findByText("Outcome model: Probe")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
});

describe("charts and layout", () => {
  it("renders SVG charts with accessible labels", () => {
    const { container } = render(
      <>
        <HBars ariaLabel="bars" data={[{ name: "a", value: 0.4 }, { name: "b", value: 0.6, highlight: true }]} />
        <Lines ariaLabel="lines" xKey="x" lines={[{ key: "y", label: "y" }]} data={[{ x: 1, y: 1 }, { x: 2, y: 3 }]} />
        <Tradeoff ariaLabel="trade" xLabel="cost" yLabel="acc" series={[{ name: "s", color: "#fff", points: [{ x: 1, y: 0.5 }] }]} />
      </>,
    );
    expect(screen.getByRole("img", { name: "bars" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "lines" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "trade" })).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-wrapper > svg.recharts-surface").length).toBe(3);
  });

  it("navigation is accessible and scrolls horizontally on small screens", () => {
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.className).toMatch(/overflow-x-auto/); // mobile: horizontal scroll
    expect(nav.className).toMatch(/md:flex-col/); // desktop: vertical sidebar
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(6);
    expect(screen.getByRole("link", { name: "Playground" })).toHaveAttribute("aria-current", "page");
  });
});
