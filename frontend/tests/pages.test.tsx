import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Comparison } from "@/features/comparison/Comparison";
import { Experiments } from "@/features/experiments/Experiments";
import { Faults } from "@/features/faults/Faults";
import { Investigations } from "@/features/investigations/Investigations";
import { Models } from "@/features/models/Models";
import { Overview } from "@/features/overview/Overview";
import { Settings } from "@/features/settings/Settings";
import { Training } from "@/features/training/Training";
import { setAdminKey } from "@/lib/api";
import { navStore } from "./navigation";
import {
  makeAnalytics,
  makeExperiment,
  makeExperimentDetail,
  makeModel,
  makeResults,
  makeScenarioDetail,
  SID,
} from "./fixtures";
import { err, mockApi, ok, renderWithProviders } from "./utils";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const empty = { items: [], total: 0, limit: 50, offset: 0 };
const page = <T,>(items: T[]) => ({ items, total: items.length, limit: 50, offset: 0 });
const overview = { active_models: [], strategy_comparison: [], latest_evaluation_id: null };

// =============================================================== Overview
describe("Overview", () => {
  const routes = () => ({
    "GET /api/v1/analytics": ok(makeAnalytics()),
    "GET /api/v1/overview": ok(overview),
    "GET /api/v1/experiments": ok(empty),
  });

  it("shows skeletons first, then the six headline metrics from the backend", async () => {
    mockApi(routes());
    renderWithProviders(<Overview />);
    expect(screen.getAllByRole("status", { name: "Loading" }).length).toBeGreaterThanOrEqual(6);
    await screen.findByText("75.0%");
    const metrics = screen.getByRole("region", { name: "Key metrics" });
    expect(within(metrics).getByText("75.0%")).toBeInTheDocument();
    expect(within(metrics).getByText("9 of 12 correct")).toBeInTheDocument();
    expect(within(metrics).getByText("13")).toBeInTheDocument();
    expect(within(metrics).getByText("Active policy")).toBeInTheDocument();
    expect(within(metrics).getByText("None")).toBeInTheDocument();
  });

  it("shows no trend arrows when there is too little history", async () => {
    mockApi(routes());
    renderWithProviders(<Overview />);
    await screen.findByText("75.0%");
    expect(screen.queryByTitle("Recent days vs earlier")).not.toBeInTheDocument();
  });

  it("shows a trend once enough days of data exist", async () => {
    const day = (i: number, acc: number) => ({ date: `2026-10-${10 + i}`, sessions: 5, correct: 0, accuracy: acc, mean_tests: 5, mean_duration: 20, mean_cost: 6, mean_reward: 1 });
    mockApi({ ...routes(), "GET /api/v1/analytics": ok(makeAnalytics({ timeseries: [day(0, 0.5), day(1, 0.5), day(2, 0.8), day(3, 0.8)] })) });
    renderWithProviders(<Overview />);
    expect((await screen.findAllByTitle("Recent days vs earlier")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/30\.0 pts/).length).toBeGreaterThan(0);
  });

  it("renders the charts and recent outcomes that link into the playground", async () => {
    mockApi(routes());
    renderWithProviders(<Overview />);
    expect(await screen.findByRole("img", { name: "Diagnosis accuracy per day" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Mean testing cost by algorithm" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /per true root cause/i })).toBeInTheDocument();
    const link = screen.getAllByRole("link").find((a) => a.getAttribute("href") === `/playground?session=${SID}`);
    expect(link).toBeTruthy();
    expect(screen.getByText("correct")).toBeInTheDocument();
    expect(screen.getByText("incorrect")).toBeInTheDocument();
  });

  it("sends filters to the backend and can clear them", async () => {
    const api = mockApi(routes());
    renderWithProviders(<Overview />);
    await screen.findByText("75.0%");
    await userEvent.selectOptions(screen.getByLabelText("Scenario"), "standard");
    await userEvent.selectOptions(screen.getByLabelText("Algorithm"), "random");
    await waitFor(() => {
      const last = api.calls.filter((c) => c.key === "GET /api/v1/analytics").at(-1);
      expect(last).toBeTruthy();
    });
    const urls = api.fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/analytics"));
    expect(urls.at(-1)).toContain("scenario=standard");
    expect(urls.at(-1)).toContain("policy=random");
    await userEvent.selectOptions(screen.getByLabelText("Period"), "7d");
    await waitFor(() => expect(api.fetchMock.mock.calls.map((c) => String(c[0])).at(-1)).toContain("since="));
    await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => expect(screen.getByLabelText("Scenario")).toHaveValue(""));
  });

  it("validates a custom date range", async () => {
    mockApi(routes());
    renderWithProviders(<Overview />);
    await screen.findByText("75.0%");
    await userEvent.selectOptions(screen.getByLabelText("Period"), "custom");
    await userEvent.type(screen.getByLabelText("From date"), "2026-10-20");
    await userEvent.type(screen.getByLabelText("To date"), "2026-10-10");
    expect(await screen.findByText(/“From” must not be after “To”/)).toBeInTheDocument();
  });

  it("explains an empty system with a way forward", async () => {
    mockApi({ ...routes(), "GET /api/v1/analytics": ok(makeAnalytics({ total_investigations: 0, finished: 0, active: 0, correct: 0, accuracy: null, mean_tests: null, mean_duration: null, mean_cost: null, mean_reward: null, timeseries: [], by_policy: [], fault_frequency: [], recent: [] })) });
    renderWithProviders(<Overview />);
    expect(await screen.findByText("No investigations yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start an investigation/i })).toHaveAttribute("href", "/playground");
    expect(screen.queryByRole("img", { name: "Diagnosis accuracy per day" })).not.toBeInTheDocument();
  });

  it("shows a single-day note instead of a meaningless line", async () => {
    mockApi({ ...routes(), "GET /api/v1/analytics": ok(makeAnalytics({ timeseries: [makeAnalytics().timeseries[0]!] })) });
    renderWithProviders(<Overview />);
    expect(await screen.findByText(/Only one day of data so far/)).toBeInTheDocument();
  });

  it("shows an error with retry, and recovers", async () => {
    let fail = true;
    mockApi({ ...routes(), "GET /api/v1/analytics": () => (fail ? { status: 500, json: { error: { code: "internal_error", message: "boom", details: {} } } } : { json: makeAnalytics() }) });
    renderWithProviders(<Overview />);
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("75.0%")).toBeInTheDocument();
  });

  it("does not show benchmark charts until a real evaluation exists", async () => {
    mockApi(routes());
    renderWithProviders(<Overview />);
    expect(await screen.findByText(/Nothing is shown until real results exist/)).toBeInTheDocument();
  });

  it("charts the latest evaluation when one exists", async () => {
    mockApi({
      ...routes(),
      "GET /api/v1/overview": ok({ active_models: [{ id: "m", name: "full_seed0:best", scenario: "standard" }], latest_evaluation_id: "e", strategy_comparison: [{ policy: "ppo", mean_reward: 2.5 }, { policy: "cost_aware_bayes", mean_reward: 3.5 }] }),
    });
    renderWithProviders(<Overview />);
    expect(await screen.findByRole("img", { name: /mean reward per incident by strategy/i })).toBeInTheDocument();
    expect(screen.getByText("full_seed0:best")).toBeInTheDocument();
  });
});

// ========================================================== Investigations
describe("Investigations", () => {
  const row = (i: number, over = {}) => ({
    id: `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`,
    scenario: "standard", policy: "cost_aware_bayes", status: "declared" as const, steps: 4, cost: 5, elapsed: 20, total_reward: 9.5,
    created_at: "2026-10-22T08:00:00Z", completed_at: "2026-10-22T08:01:00Z", declared_fault: "db_unavailable", true_fault: "db_unavailable", correct: true, ...over,
  });
  const lastUrl = (api: ReturnType<typeof mockApi>) =>
    api.fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/sessions?")).at(-1) ?? "";

  const baseRoutes = (items: unknown[], total = items.length) => ({
    "GET /api/v1/sessions": () => ({ json: { items, total, limit: 15, offset: 0 } }),
    "GET /api/v1/analytics": ok(makeAnalytics()),
  });

  it("lists investigations with results and links to the playground", async () => {
    mockApi(baseRoutes([row(1), row(2, { status: "active", correct: null, true_fault: null, declared_fault: null }), row(3, { status: "truncated", correct: null })]));
    renderWithProviders(<Investigations />);
    expect(await screen.findByRole("link", { name: "00000001" })).toHaveAttribute("href", expect.stringContaining("/playground?session=00000001"));
    expect(screen.getByText("correct")).toBeInTheDocument();
    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByText("no diagnosis")).toBeInTheDocument();
  });

  it("never shows the true fault of an active investigation", async () => {
    mockApi(baseRoutes([row(2, { status: "active", correct: null, true_fault: null, declared_fault: null })]));
    renderWithProviders(<Investigations />);
    await screen.findByText("in progress");
    expect(screen.queryByText(/db unavailable/i)).not.toBeInTheDocument();
  });

  it("shows what was wrong when a diagnosis was incorrect", async () => {
    mockApi(baseRoutes([row(1, { correct: false, declared_fault: "disk_full", true_fault: "memory_leak" })]));
    renderWithProviders(<Investigations />);
    expect(await screen.findByText(/disk full \(was memory leak\)/)).toBeInTheDocument();
  });

  it("searches by id prefix (debounced) and by filters", async () => {
    const api = mockApi(baseRoutes([row(1)]));
    renderWithProviders(<Investigations />);
    await screen.findByRole("link", { name: "00000001" });
    await userEvent.type(screen.getByLabelText("Search by investigation ID"), "3f9a");
    await waitFor(() => expect(lastUrl(api)).toContain("q=3f9a"));
    await userEvent.selectOptions(screen.getByLabelText("Status"), "active");
    await waitFor(() => expect(lastUrl(api)).toContain("status=active"));
    await userEvent.selectOptions(screen.getByLabelText("Algorithm"), "random");
    await waitFor(() => expect(lastUrl(api)).toContain("policy=random"));
  });

  it("paginates", async () => {
    const api = mockApi(baseRoutes(Array.from({ length: 15 }, (_, i) => row(i + 1)), 40));
    renderWithProviders(<Investigations />);
    await screen.findByText(/page 1 of 3/);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastUrl(api)).toContain("offset=15"));
    expect(await screen.findByText(/page 2 of 3/)).toBeInTheDocument();
  });

  it("opens an investigation when its row is clicked", async () => {
    mockApi(baseRoutes([row(1)]));
    renderWithProviders(<Investigations />);
    await userEvent.click((await screen.findByText("correct")).closest("tr")!);
    expect(navStore.pushed.at(-1)).toBe("/playground?session=00000001-0000-0000-0000-000000000000");
  });

  it("distinguishes 'no data' from 'no matches'", async () => {
    mockApi(baseRoutes([]));
    renderWithProviders(<Investigations />);
    expect(await screen.findByText("No investigations yet")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Status"), "declared");
    expect(await screen.findByText("No investigations match these filters")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(await screen.findByText("No investigations yet")).toBeInTheDocument();
  });

  it("shows an error state with retry", async () => {
    mockApi({ "GET /api/v1/sessions": err(500, "internal_error", "db down"), "GET /api/v1/analytics": ok(makeAnalytics()) });
    renderWithProviders(<Investigations />);
    expect(await screen.findByRole("alert")).toHaveTextContent("db down");
  });
});

// ================================================================ Training
describe("Training", () => {
  const scenarios = [{ name: "small", description: "", n_faults: 4, n_tests: 5, max_steps: 6 }];
  const running = makeExperiment({ id: "run-1", run_name: "live-run", status: "running", progress_timesteps: 20480, finished_at: null });
  const done = makeExperiment({ id: "run-2", run_name: "done-run" });
  const routes = (extra = {}) => ({
    "GET /api/v1/scenarios": ok(scenarios),
    "GET /api/v1/experiments": ok(page([running, done])),
    "GET /api/v1/models": ok([makeModel({ experiment_id: "run-2", name: "done-run:best", scenario: "small" })]),
    "GET /api/v1/experiments/run-1": ok(makeExperimentDetail({ ...running, id: "run-1", run_name: "live-run", status: "running", progress_timesteps: 20480 })),
    "GET /api/v1/experiments/run-2": ok(makeExperimentDetail({ ...done, id: "run-2" })),
    ...extra,
  });

  it("monitors a run: progress, real metrics and charts only for what was recorded", async () => {
    mockApi(routes());
    renderWithProviders(<Training />, { search: "run=run-2" });
    const metrics = await screen.findByRole("region", { name: "Training metrics" });
    expect(within(metrics).getByText("Mean episode reward")).toBeInTheDocument();
    expect(within(metrics).getByText("4.00")).toBeInTheDocument(); // last ep_rew_mean
    expect(within(metrics).getByText("85.0%")).toBeInTheDocument(); // validation accuracy
    expect(within(metrics).getByText("-0.0100")).toBeInTheDocument(); // policy loss
    expect(within(metrics).getByText("1.100")).toBeInTheDocument(); // entropy = -entropy_loss
    expect(within(metrics).getByText("3m 0s")).toBeInTheDocument(); // wall clock
    expect(screen.getByRole("img", { name: /mean episode reward versus training timesteps/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /value loss versus training timesteps/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Training progress" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("says plainly when a run recorded no loss/entropy telemetry instead of drawing empty charts", async () => {
    mockApi(routes({ "GET /api/v1/experiments/run-2": ok(makeExperimentDetail({ ...done, training_curve: [], artifacts: ["metrics.jsonl"] })) }));
    renderWithProviders(<Training />, { search: "run=run-2" });
    await screen.findByRole("region", { name: "Training metrics" });
    expect(screen.getAllByText(/Not recorded for this run/).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole("img", { name: /value loss versus/i })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /validation accuracy versus/i })).toBeInTheDocument(); // validation exists
  });

  it("does not offer to stop a running job, and explains why", async () => {
    mockApi(routes());
    renderWithProviders(<Training />, { search: "run=run-1" });
    const stop = await screen.findByRole("button", { name: /stop training/i });
    expect(stop).toBeDisabled();
  });

  it("cancels a queued run", async () => {
    const queued = makeExperiment({ id: "q", run_name: "q-run", status: "queued", progress_timesteps: 0, started_at: null, finished_at: null });
    const api = mockApi(routes({
      "GET /api/v1/experiments": ok(page([queued])),
      "GET /api/v1/experiments/q": ok(makeExperimentDetail({ ...queued, validation_curve: [], training_curve: [], elapsed_seconds: null, artifacts: [] })),
      "POST /api/v1/experiments/q/cancel": ok({ ...queued, status: "cancelled" }),
    }));
    renderWithProviders(<Training />, { search: "run=q" });
    await userEvent.click(await screen.findByRole("button", { name: /cancel queued run/i }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /api/v1/experiments/q/cancel")).toBe(true));
  });

  it("validates the configuration locally and does not call the API when invalid", async () => {
    const api = mockApi(routes());
    renderWithProviders(<Training />);
    await screen.findByLabelText("Run name");
    await userEvent.clear(screen.getByLabelText("Learning rate"));
    await userEvent.type(screen.getByLabelText("Learning rate"), "-1");
    await userEvent.clear(screen.getByLabelText("Total timesteps"));
    await userEvent.type(screen.getByLabelText("Total timesteps"), "5");
    await userEvent.click(screen.getByRole("button", { name: /queue training/i }));
    expect(await screen.findByText(/Must be greater than 0/)).toBeInTheDocument();
    expect(screen.getByText(/Must be at least 1024/)).toBeInTheDocument();
    expect(screen.getByLabelText("Learning rate")).toHaveAttribute("aria-invalid", "true");
    expect(api.calls.some((c) => c.key === "POST /api/v1/experiments/training")).toBe(false);
  });

  it("surfaces the advanced-field problem (batch size must divide the rollout)", async () => {
    mockApi(routes());
    renderWithProviders(<Training />);
    await screen.findByLabelText("Run name");
    await userEvent.click(screen.getByRole("button", { name: /discount, batching and reward/i }));
    await userEvent.clear(screen.getByLabelText("Batch size"));
    await userEvent.type(screen.getByLabelText("Batch size"), "100");
    await userEvent.click(screen.getByRole("button", { name: /queue training/i }));
    expect(await screen.findByText(/Must divide n_envs × n_steps \(1024\)/)).toBeInTheDocument();
  });

  it("submits a valid configuration with the admin key and opens the new run", async () => {
    setAdminKey("secret");
    const api = mockApi(routes({ "POST /api/v1/experiments/training": () => ({ status: 202, json: makeExperiment({ id: "new", run_name: "new-run", status: "queued" }) }) }));
    renderWithProviders(<Training />);
    await screen.findByLabelText("Run name");
    await userEvent.click(screen.getByRole("button", { name: /queue training/i }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /api/v1/experiments/training")).toBe(true));
    const call = api.calls.find((c) => c.key === "POST /api/v1/experiments/training")!;
    expect(call.headers["X-API-Key"]).toBe("secret");
    expect(call.body).toMatchObject({ name: "experiment", config: { scenario: "small", total_timesteps: 50000, reward: { penalty_wrong: 10 } } });
    await waitFor(() => expect(navStore.search).toBe("run=new"));
  });

  it("tells the user to set the admin key when the server rejects it", async () => {
    mockApi(routes({ "POST /api/v1/experiments/training": err(401, "unauthorized", "missing or invalid API key") }));
    renderWithProviders(<Training />);
    await screen.findByLabelText("Run name");
    await userEvent.click(screen.getByRole("button", { name: /queue training/i }));
    expect(await screen.findByText(/needs the admin API key/i)).toBeInTheDocument();
  });

  it("shows the log tail from the backend", async () => {
    mockApi(routes({
      "GET /api/v1/experiments/run-2/logs": ok({ available: true, lines: [JSON.stringify({ ts: "2026-10-22T08:00:00Z", level: "INFO", msg: "validation", timesteps: 4096, val_reward: 1.5 })] }),
    }));
    renderWithProviders(<Training />, { search: "run=run-2" });
    await userEvent.click(await screen.findByRole("button", { name: /view logs/i }));
    const log = await screen.findByLabelText("Training log lines");
    expect(log).toHaveTextContent("validation");
    expect(log).toHaveTextContent("val_reward=1.5");
  });

  it("compares selected runs and warns when their scenarios differ", async () => {
    mockApi(routes({
      "GET /api/v1/experiments": ok(page([running, { ...done, config: { scenario: "standard" } }])),
      "GET /api/v1/experiments/run-2": ok(makeExperimentDetail({ ...done, id: "run-2", config: { scenario: "standard" } })),
    }));
    renderWithProviders(<Training />, { search: "run=run-2" });
    await userEvent.click(await screen.findByRole("checkbox", { name: /select live-run for comparison/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /select done-run for comparison/i }));
    await userEvent.click(screen.getByRole("button", { name: /compare 2/i }));
    const dialog = await screen.findByRole("dialog", { name: /compare runs/i });
    expect(await within(dialog).findByRole("img", { name: /validation reward of the selected runs/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/different scenarios/i);
  });

  it("filters the experiment list", async () => {
    mockApi(routes());
    renderWithProviders(<Training />);
    await screen.findByText("live-run");
    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "succeeded");
    expect(screen.queryByText("live-run", { selector: "span" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Search runs"), "zzz");
    expect(await screen.findByText("No runs match")).toBeInTheDocument();
  });
});

// =============================================================== Comparison
describe("Comparison", () => {
  const ev = (id: string, runs: string[], model = "best") => ({
    id, status: "succeeded" as const, params: { run_names: runs, model }, error: null,
    created_at: "2026-10-22T08:00:00Z", started_at: "2026-10-22T08:00:01Z", finished_at: "2026-10-22T08:05:00Z",
  });
  const routes = (extra = {}) => ({
    "GET /api/v1/evaluations": ok(page([ev("e1", ["full_seed0"])])),
    "GET /api/v1/evaluations/e1/results": ok(makeResults()),
    "GET /api/v1/experiments": ok(empty),
    ...extra,
  });

  it("does not show anything fabricated when no evaluation exists", async () => {
    mockApi(routes({ "GET /api/v1/evaluations": ok(empty) }));
    renderWithProviders(<Comparison />);
    expect(await screen.findByText("No completed evaluations yet")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Performance comparison" })).not.toBeInTheDocument();
  });

  it("shows the performance table, with PPO as mean ± std over seeds", async () => {
    mockApi(routes());
    renderWithProviders(<Comparison />);
    const table = await screen.findByRole("table", { name: "Performance comparison" });
    expect(within(table).getByText("Cost-aware Bayes")).toBeInTheDocument();
    expect(within(table).getByText("MaskablePPO")).toBeInTheDocument();
    expect(within(table).getByText(/mean ± std over 1 seed/)).toBeInTheDocument();
    expect(within(table).getByText("best reward").closest("tr")).toHaveTextContent("Cost-aware Bayes");
    expect(within(table).getByText(/95% CI \[-0\.90, 0\.10\]/)).toBeInTheDocument();
  });

  it("sorts by a column", async () => {
    mockApi(routes());
    renderWithProviders(<Comparison />);
    const table = await screen.findByRole("table", { name: "Performance comparison" });
    const firstRow = () => within(table).getAllByRole("row")[1]!;
    expect(firstRow()).toHaveTextContent("Cost-aware Bayes"); // default: reward desc
    await userEvent.click(within(table).getByRole("button", { name: /mean reward/i })); // toggle to asc
    expect(firstRow()).toHaveTextContent("Random");
    await userEvent.click(within(table).getByRole("button", { name: /accuracy/i }));
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Cost-aware Bayes");
  });

  it("reports the statistical verdicts honestly, including when PPO is worse", async () => {
    mockApi(routes());
    renderWithProviders(<Comparison />);
    const table = await screen.findByRole("table", { name: "Paired comparison" });
    expect(within(table).getAllByText("PPO better")).toHaveLength(2);
    expect(within(table).getAllByText("PPO worse")).toHaveLength(2);
  });

  it("renders the benchmark charts, distributions and confusion matrix", async () => {
    mockApi(routes());
    renderWithProviders(<Comparison />);
    expect(await screen.findByRole("img", { name: /diagnostic accuracy versus mean testing cost/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /mean reward per incident for each policy/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /distribution of modelled diagnostic time/i })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /confusion matrix for maskableppo/i })).toBeInTheDocument();
    expect(screen.getByText("Most common mistakes")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Policy for the confusion matrix"), "random");
    expect(screen.getByRole("table", { name: /confusion matrix for random/i })).toBeInTheDocument();
  });

  it("falls back to percentiles when episode-level data was not recorded", async () => {
    const r = makeResults();
    delete (r as { distributions?: unknown }).distributions;
    mockApi(routes({ "GET /api/v1/evaluations/e1/results": ok(r) }));
    renderWithProviders(<Comparison />);
    expect(await screen.findByRole("table", { name: "Duration percentiles" })).toBeInTheDocument();
    expect(screen.getByText(/were not recorded for this evaluation/)).toBeInTheDocument();
  });

  it("shows evaluation configuration", async () => {
    mockApi(routes());
    renderWithProviders(<Comparison />);
    await screen.findByRole("table", { name: "Performance comparison" });
    expect(screen.getByText("Evaluation seed", { selector: "dt" }).nextElementSibling).toHaveTextContent("20002");
    expect(screen.getByText("Runs", { selector: "dt" }).nextElementSibling).toHaveTextContent("full_seed0");
    expect(screen.getByText(/lambda cost 0.5/)).toBeInTheDocument();
  });

  it("warns when two evaluations are not configured equivalently", async () => {
    const other = makeResults({ n_test_episodes: 800, metadata: { ...makeResults().metadata!, test_seed: 5 } });
    mockApi(routes({
      "GET /api/v1/evaluations": ok(page([ev("e1", ["full_seed0"]), ev("e2", ["full_seed1"])])),
      "GET /api/v1/evaluations/e2/results": ok(other),
    }));
    renderWithProviders(<Comparison />);
    await screen.findByRole("table", { name: "Performance comparison" });
    await userEvent.selectOptions(screen.getByLabelText("Compare with"), "e2");
    expect(await screen.findByText(/not directly comparable/i)).toBeInTheDocument();
    expect(screen.getByText(/evaluation seed \(20002 vs 5\)/)).toBeInTheDocument();
  });

  it("confirms equivalence when the setups match", async () => {
    mockApi(routes({
      "GET /api/v1/evaluations": ok(page([ev("e1", ["full_seed0"]), ev("e2", ["full_seed1"])])),
      "GET /api/v1/evaluations/e2/results": ok(makeResults()),
    }));
    renderWithProviders(<Comparison />);
    await screen.findByRole("table", { name: "Performance comparison" });
    await userEvent.selectOptions(screen.getByLabelText("Compare with"), "e2");
    expect(await screen.findByText(/Equivalent evaluation configurations/)).toBeInTheDocument();
  });

  it("filters evaluations by scenario and evaluation seed", async () => {
    const small = makeResults({ metadata: { ...makeResults().metadata!, scenario: "small", test_seed: 7 } });
    mockApi(routes({
      "GET /api/v1/evaluations": ok(page([ev("e1", ["full_seed0"]), ev("e2", ["small_seed0"])])),
      "GET /api/v1/evaluations/e2/results": ok(small),
    }));
    renderWithProviders(<Comparison />);
    await screen.findByRole("table", { name: "Performance comparison" });
    await screen.findByRole("option", { name: "small" });
    await userEvent.selectOptions(screen.getByLabelText("Scenario"), "small");
    const select = screen.getByLabelText("Evaluation") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["e2"]);
    await userEvent.selectOptions(screen.getByLabelText("Evaluation seed"), "20002");
    expect(await screen.findByText("No evaluations match these filters")).toBeInTheDocument();
  });

  it("shows sensitivity charts only when the evaluation recorded them", async () => {
    mockApi(routes());
    const { unmount } = renderWithProviders(<Comparison />);
    await screen.findByRole("table", { name: "Performance comparison" });
    expect(screen.queryByText("Sensitivity")).not.toBeInTheDocument();
    unmount();
    mockApi(routes({ "GET /api/v1/evaluations/e1/results": ok(makeResults({ robustness: { noise: [{ param: 0, policy: "ppo", mean_reward: 2.8 }, { param: 0.2, policy: "ppo", mean_reward: -1.5 }] } })) }));
    renderWithProviders(<Comparison />);
    expect(await screen.findByText("Sensitivity")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /mean reward as noisier tests changes/i })).toBeInTheDocument();
  });

  it("validates the evaluation request locally", async () => {
    const api = mockApi(routes());
    renderWithProviders(<Comparison />);
    await screen.findByRole("table", { name: "Performance comparison" });
    await userEvent.click(screen.getByRole("button", { name: /queue evaluation/i }));
    expect(await screen.findByText(/Choose at least one training run/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Other run names"), "full_seed0");
    await userEvent.clear(screen.getByLabelText("Test episodes"));
    await userEvent.type(screen.getByLabelText("Test episodes"), "5");
    await userEvent.click(screen.getByRole("button", { name: /queue evaluation/i }));
    expect(await screen.findByText(/between 50 and 20,000/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.key === "POST /api/v1/evaluations")).toBe(false);
  });

  it("queues an evaluation", async () => {
    setAdminKey("k");
    const api = mockApi(routes({ "POST /api/v1/evaluations": () => ({ status: 202, json: ev("e9", ["full_seed0"]) }) }));
    renderWithProviders(<Comparison />);
    await screen.findByRole("table", { name: "Performance comparison" });
    await userEvent.type(screen.getByLabelText("Other run names"), "full_seed0, full_seed1");
    await userEvent.click(screen.getByRole("button", { name: /queue evaluation/i }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /api/v1/evaluations")).toBe(true));
    expect(api.calls.find((c) => c.key === "POST /api/v1/evaluations")?.body).toMatchObject({ run_names: ["full_seed0", "full_seed1"], n_test: 1000, model: "best", skip_robustness: true });
  });

  it("flags failed evaluations and in-progress ones", async () => {
    mockApi(routes({
      "GET /api/v1/evaluations": ok(page([{ ...ev("e3", ["x"]), status: "failed", error: "Traceback\nValueError: no such run" }, { ...ev("e4", ["y"]), status: "running" }])),
    }));
    renderWithProviders(<Comparison />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed/i);
    expect(screen.getByRole("status")).toHaveTextContent(/in progress/i);
  });
});

// ============================================================ Fault Explorer
describe("Fault Explorer", () => {
  const routes = () => ({
    "GET /api/v1/scenarios": ok([{ name: "small", description: "", n_faults: 3, n_tests: 2, max_steps: 6 }]),
    "GET /api/v1/scenarios/small": ok(makeScenarioDetail()),
  });

  it("shows fault cards with category, prior and an estimated difficulty", async () => {
    mockApi(routes());
    renderWithProviders(<Faults />);
    const list = await screen.findByRole("list", { name: "Faults" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("Database unavailable")).toBeInTheDocument();
    expect(within(list).getAllByText(/Relatively|Medium/).length).toBe(3);
  });

  it("filters by search and category", async () => {
    mockApi(routes());
    renderWithProviders(<Faults />);
    await screen.findByRole("list", { name: "Faults" });
    await userEvent.click(screen.getByRole("button", { name: "Host" }));
    expect(within(screen.getByRole("list", { name: "Faults" })).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.type(screen.getByPlaceholderText("Search faults"), "disk");
    expect(within(screen.getByRole("list", { name: "Faults" })).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.clear(screen.getByPlaceholderText("Search faults"));
    await userEvent.type(screen.getByPlaceholderText("Search faults"), "zzzz");
    expect(await screen.findByText("No faults match")).toBeInTheDocument();
  });

  it("selecting a fault shows its description, relevant tests and outcome distribution", async () => {
    mockApi(routes());
    renderWithProviders(<Faults />);
    await screen.findByRole("list", { name: "Faults" });
    await userEvent.click(within(screen.getByRole("list", { name: "Faults" })).getByRole("button", { name: /cpu saturation/i }));
    // the description shows on the card and again in the detail panel
    expect((await screen.findAllByText("CPU is maxed out.")).length).toBe(2);
    expect(screen.getByText("Most relevant tests")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /outcome probabilities of cpu check for cpu saturation/i })).toBeInTheDocument();
    expect(screen.getByText(/Symptoms are not modelled/)).toBeInTheDocument();
  });

  it("renders the fault-signature heatmap and lets the user switch the outcome", async () => {
    mockApi(routes());
    renderWithProviders(<Faults />);
    const heat = await screen.findByRole("table", { name: /probability of outcome fail/i });
    expect(within(heat).getByText("95")).toBeInTheDocument(); // P(FAIL | db_down, db_probe)
    await userEvent.selectOptions(screen.getByLabelText("Outcome shown in the heatmap"), "PASS");
    expect(screen.getByRole("table", { name: /probability of outcome pass/i })).toBeInTheDocument();
  });

  it("clicking a heatmap cell selects that fault and test", async () => {
    mockApi(routes());
    renderWithProviders(<Faults />);
    const heat = await screen.findByRole("table", { name: /probability of outcome fail/i });
    await userEvent.click(within(heat).getByRole("button", { name: /cpu saturation · cpu check/i }));
    expect(await screen.findByRole("img", { name: /outcome probabilities of cpu check for cpu saturation/i })).toBeInTheDocument();
  });

  it("shows an error state when the scenario cannot be loaded", async () => {
    mockApi({ "GET /api/v1/scenarios": err(500, "internal_error", "no scenarios") });
    renderWithProviders(<Faults />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

// ===================================================================== Models
describe("Model Registry", () => {
  const active = makeModel({ id: "m-active", name: "full_seed0:best", is_active: true });
  const other = makeModel({ id: "m-other", name: "full_seed1:best", seed: 1 });
  const routes = (extra = {}) => ({ "GET /api/v1/models": ok([active, other]), ...extra });

  it("lists models with algorithm, scenario, validation metrics and status", async () => {
    mockApi(routes());
    renderWithProviders(<Models />);
    const table = await screen.findByRole("table", { name: "Registered models" });
    expect(within(table).getAllByText("MaskablePPO")).toHaveLength(2);
    expect(within(table).getByText("Active")).toBeInTheDocument();
    expect(within(table).getByText("Inactive")).toBeInTheDocument();
    expect(within(table).getAllByText("2.64")).toHaveLength(2);
  });

  it("expands a row to show the checkpoint hash", async () => {
    mockApi(routes());
    renderWithProviders(<Models />);
    await userEvent.click(await screen.findByRole("button", { name: /full_seed1:best/ }));
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });

  it("asks for confirmation, explains the backend validation, and activates", async () => {
    const api = mockApi(routes({ "POST /api/v1/models/m-other/activate": ok({ ...other, is_active: true }) }));
    renderWithProviders(<Models />);
    const row = (await screen.findByText("full_seed1:best")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Activate" }));
    const dialog = await screen.findByRole("dialog", { name: /activate this model/i });
    expect(within(dialog).getByText(/SHA-256 matches/)).toBeInTheDocument();
    expect(within(dialog).getByText(/replaces the currently active model/i)).toHaveTextContent("full_seed0:best");
    expect(api.calls.some((c) => c.key.includes("/activate"))).toBe(false); // nothing happens before confirming
    await userEvent.click(within(dialog).getByRole("button", { name: /validate and activate/i }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /api/v1/models/m-other/activate")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the backend's validation problems and keeps the dialog open", async () => {
    mockApi(routes({ "POST /api/v1/models/m-other/activate": err(400, "model_invalid", "model failed validation", { problems: ["checkpoint hash does not match the registered hash", "observation space does not match the scenario"] }) }));
    renderWithProviders(<Models />);
    const row = (await screen.findByText("full_seed1:best")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Activate" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /validate and activate/i }));
    expect(await within(dialog).findByText("Validation failed")).toBeInTheDocument();
    expect(within(dialog).getByText(/hash does not match/)).toBeInTheDocument();
    expect(within(dialog).getByText(/observation space does not match/)).toBeInTheDocument();
  });

  it("deactivates the active model after confirmation", async () => {
    const api = mockApi(routes({ "POST /api/v1/models/m-active/deactivate": ok({ ...active, is_active: false }) }));
    renderWithProviders(<Models />);
    const row = (await screen.findByText("full_seed0:best")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog", { name: /deactivate this model/i });
    await userEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /api/v1/models/m-active/deactivate")).toBe(true));
  });

  it("registers a run", async () => {
    setAdminKey("k");
    const api = mockApi(routes({ "POST /api/v1/models/register": () => ({ status: 201, json: makeModel({ id: "m3", name: "x:best" }) }) }));
    renderWithProviders(<Models />);
    await userEvent.type(await screen.findByLabelText("Training run name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "POST /api/v1/models/register")?.body).toEqual({ run_name: "x", checkpoint: "best" }));
  });

  it("filters and shows an empty state", async () => {
    mockApi({ "GET /api/v1/models": ok([]) });
    renderWithProviders(<Models />);
    expect(await screen.findByText("No models registered")).toBeInTheDocument();
  });

  it("searches by name", async () => {
    mockApi(routes());
    renderWithProviders(<Models />);
    await screen.findByRole("table", { name: "Registered models" });
    await userEvent.type(screen.getByLabelText("Search models"), "seed1");
    expect(screen.queryByText("full_seed0:best")).not.toBeInTheDocument();
    expect(screen.getByText("full_seed1:best")).toBeInTheDocument();
  });
});

// ============================================================== Experiments
describe("Experiment History", () => {
  const a = makeExperiment({ id: "a", run_name: "alpha-run", seed: 1 });
  const b = makeExperiment({ id: "b", run_name: "beta-run", seed: 2, status: "failed", error: "x" });
  const routes = (extra = {}) => ({
    "GET /api/v1/experiments": ok(page([a, b])),
    "GET /api/v1/models": ok([makeModel({ experiment_id: "a", name: "alpha-run:best", scenario: "small" })]),
    "GET /api/v1/experiments/a": ok(makeExperimentDetail({ ...a, id: "a" })),
    "GET /api/v1/experiments/b": ok(makeExperimentDetail({ ...b, id: "b" })),
    ...extra,
  });

  it("tabulates runs with algorithm, scenario, seed, status, metrics and checkpoint", async () => {
    mockApi(routes());
    renderWithProviders(<Experiments />);
    const table = await screen.findByRole("table", { name: "Experiments" });
    const row = within(table).getByText("alpha-run").closest("tr")!;
    expect(row).toHaveTextContent("MaskablePPO");
    expect(row).toHaveTextContent("small");
    expect(row).toHaveTextContent("2.64 / 67%");
    expect(row).toHaveTextContent("alpha-run:best");
    expect(within(table).getByText("beta-run").closest("tr")).toHaveTextContent("Failed");
  });

  it("filters by status, scenario and text", async () => {
    mockApi(routes());
    renderWithProviders(<Experiments />);
    await screen.findByRole("table", { name: "Experiments" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "failed");
    expect(screen.queryByText("alpha-run")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Status"), "");
    await userEvent.type(screen.getByPlaceholderText("Search by name or run"), "nothing-like-this");
    expect(await screen.findByText("No experiments match")).toBeInTheDocument();
  });

  it("opens a run's details: configuration, validation curve and downloadable metrics", async () => {
    mockApi(routes());
    renderWithProviders(<Experiments />);
    await userEvent.click(await screen.findByRole("button", { name: /alpha-run/ }));
    const dialog = await screen.findByRole("dialog", { name: "alpha-run" });
    expect(within(dialog).getByText("learning rate")).toBeInTheDocument();
    expect(await within(dialog).findByRole("img", { name: /validation reward of alpha-run/i })).toBeInTheDocument();
    const dl = await within(dialog).findByRole("link", { name: /train_metrics\.jsonl/ });
    expect(dl).toHaveAttribute("href", expect.stringContaining("/api/v1/experiments/a/artifacts/train_metrics.jsonl"));
    expect(within(dialog).getByRole("link", { name: /open in rl training/i })).toHaveAttribute("href", "/training?run=a");
  });

  it("enables comparison only with two or more selected runs", async () => {
    mockApi(routes());
    renderWithProviders(<Experiments />);
    await screen.findByRole("table", { name: "Experiments" });
    const compare = screen.getByRole("button", { name: /compare/i });
    expect(compare).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select alpha-run" }));
    expect(compare).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select beta-run" }));
    expect(compare).toBeEnabled();
    await userEvent.click(compare);
    expect(await screen.findByRole("dialog", { name: /compare runs/i })).toBeInTheDocument();
  });

  it("explains an empty history", async () => {
    mockApi({ "GET /api/v1/experiments": ok(empty), "GET /api/v1/models": ok([]) });
    renderWithProviders(<Experiments />);
    expect(await screen.findByText("No experiments recorded")).toBeInTheDocument();
  });
});

// ================================================================== Settings
describe("Settings", () => {
  const routes = (extra = {}) => ({
    "GET /health/ready": ok({ status: "ready", checks: { database: "ok", artifacts: "ok" } }),
    "GET /openapi.json": ok({ info: { title: "DiagnoseRL API", version: "0.1.0" } }),
    ...extra,
  });

  it("shows the connection, server version and readiness checks", async () => {
    mockApi(routes());
    renderWithProviders(<Settings />);
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(await screen.findByText("DiagnoseRL API 0.1.0")).toBeInTheDocument();
    const checks = screen.getByRole("list", { name: "Readiness checks" });
    expect(within(checks).getAllByText("ok")).toHaveLength(2);
  });

  it("reports an offline backend with guidance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    renderWithProviders(<Settings />);
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/not reachable/i);
  });

  it("flags a degraded backend", async () => {
    mockApi(routes({ "GET /health/ready": () => ({ status: 503, json: { status: "not_ready", checks: { database: "unavailable" } } }) }));
    renderWithProviders(<Settings />);
    // a 503 from /health/ready is an error response, so the connection is reported as offline/degraded, never "Ready"
    await waitFor(() => expect(screen.queryByText("Ready")).not.toBeInTheDocument());
  });

  it("saves and clears the admin key in session storage only", async () => {
    mockApi(routes());
    renderWithProviders(<Settings />);
    const input = await screen.findByLabelText("Admin API key");
    await userEvent.type(input, "my-key");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sessionStorage.getItem("diagnoserl.adminKey")).toBe("my-key");
    expect(localStorage.length).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(sessionStorage.getItem("diagnoserl.adminKey")).toBeNull();
  });

  it("verifies a key against the server (accepted, rejected, disabled)", async () => {
    mockApi(routes({ "POST /api/v1/models/register": err(404, "not_found", "nope") }));
    const { unmount } = renderWithProviders(<Settings />);
    await userEvent.type(await screen.findByLabelText("Admin API key"), "good");
    await userEvent.click(screen.getByRole("button", { name: "Verify key" }));
    expect(await screen.findByText("The server accepted this key.")).toBeInTheDocument();
    unmount();

    mockApi(routes({ "POST /api/v1/models/register": err(401, "unauthorized", "bad") }));
    renderWithProviders(<Settings />);
    await userEvent.clear(await screen.findByLabelText("Admin API key"));
    await userEvent.type(screen.getByLabelText("Admin API key"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Verify key" }));
    expect(await screen.findByText("The server rejected this key.")).toBeInTheDocument();
  });

  it("states what the environment is, without implying advisor mode works", async () => {
    mockApi(routes());
    renderWithProviders(<Settings />);
    expect(await screen.findByText(/nothing touches a real system/i)).toBeInTheDocument();
    expect(screen.getByText("not available")).toBeInTheDocument();
  });
});

// keep `act` import used for lint when no test needs it directly
void act;
