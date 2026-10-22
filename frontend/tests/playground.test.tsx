import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Report, Session } from "@/lib/api";
import { Playground } from "@/features/playground/Playground";
import { BASE_STEP_DELAY_MS } from "@/features/playground/useInvestigation";
import { navStore } from "./navigation";
import {
  afterOneTest,
  makeSession,
  REC_DECLARE,
  REC_PPO,
  REC_TEST,
  SID,
  TESTS,
} from "./fixtures";
import { err, mockApi, ok, renderWithProviders, type MockApi } from "./utils";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const scenarios = [{ name: "small", description: "Three faults", n_faults: 3, n_tests: 2, max_steps: 6 }];
const basePolicies = { policies: ["cost_aware_bayes", "info_gain", "ppo"], ppo_available_for_scenarios: [] as string[] };

/** A small stateful backend: running db_probe moves the belief and unlocks a declaration. */
function backend(over: { policies?: typeof basePolicies; rec?: typeof REC_TEST } = {}): MockApi & { state: { session: Session } } {
  const state = { session: makeSession(), declared: "db_down" };
  const finished = (declared: string): Report => ({
    session: state.session,
    initial_prior: makeSession().posterior,
    true_fault: "db_down",
    true_fault_name: "Database unavailable",
    declared_fault: declared,
    correct: declared === "db_down",
    timeout: false,
    posterior_trace: [],
  });
  const api = mockApi({
    "GET /api/v1/scenarios": ok(scenarios),
    "GET /api/v1/policies": ok(over.policies ?? basePolicies),
    "POST /api/v1/sessions": (body) => {
      state.session = makeSession(body && (body as { policy?: string }).policy ? { policy: (body as { policy: string }).policy } : {});
      return { status: 201, json: state.session };
    },
    [`GET /api/v1/sessions/${SID}`]: () => ({ json: state.session }),
    [`GET /api/v1/sessions/${SID}/tests`]: () => ({
      json: TESTS.map((t) => ({
        ...t,
        executed: state.session.executed.some((e) => e.test_id === t.id),
        available: state.session.status === "active" && !state.session.executed.some((e) => e.test_id === t.id),
      })),
    }),
    [`GET /api/v1/sessions/${SID}/recommendation`]: () =>
      state.session.steps === 0 ? { json: over.rec ?? REC_TEST } : { json: REC_DECLARE },
    [`POST /api/v1/sessions/${SID}/tests`]: (body) => {
      const { test_id } = body as { test_id: string };
      state.session = afterOneTest({
        policy: state.session.policy,
        executed: [{ ...afterOneTest().executed[0]!, test_id, test_name: TESTS.find((t) => t.id === test_id)!.name }],
      });
      return { json: { result: state.session.executed[0], replayed: false, session: state.session } };
    },
    [`POST /api/v1/sessions/${SID}/declare`]: (body) => {
      const { fault_id } = body as { fault_id: string };
      state.declared = fault_id;
      state.session = afterOneTest({ status: "declared", steps: 2, available_tests: [], total_reward: fault_id === "db_down" ? 9.6 : -10.4, completed_at: "2026-10-22T08:01:00Z" });
      return {
        json: {
          declaration: { fault_id, correct: fault_id === "db_down", reward: fault_id === "db_down" ? 10 : -10 },
          true_fault: "db_down",
          session: state.session,
        },
      };
    },
    [`GET /api/v1/sessions/${SID}/report`]: () => ({ json: finished(state.declared) }),
  });
  return Object.assign(api, { state });
}

/** Wait for the first executed test to appear in the timeline (the test list shows the same badge). */
async function timelineResult() {
  const timeline = await screen.findByRole("list", { name: "Diagnostic timeline" });
  await within(timeline).findByText("FAIL");
  return timeline;
}

async function startManual(user = userEvent.setup()) {
  await screen.findByRole("option", { name: /cost-aware bayes/i });
  await user.click(screen.getByRole("button", { name: /start investigation/i }));
  await screen.findByText("Recommended next action");
  return user;
}

describe("Playground: start", () => {
  it("shows the start form and explains the workflow before anything runs", async () => {
    backend();
    renderWithProviders(<Playground />);
    expect(await screen.findByText("New investigation")).toBeInTheDocument();
    expect(screen.getByText("How an investigation works")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Investigation workflow" })).toBeInTheDocument();
    expect(screen.getByText(/Root-cause probabilities will appear here/)).toBeInTheDocument();
  });

  it("disables the RL policy until a model is active for the scenario", async () => {
    backend();
    renderWithProviders(<Playground />);
    const option = await screen.findByRole("option", { name: /maskableppo.*no active model/i });
    expect(option).toBeDisabled();
  });

  it("enables the RL policy once the backend reports an active model", async () => {
    backend({ policies: { ...basePolicies, ppo_available_for_scenarios: ["small"] } });
    renderWithProviders(<Playground />);
    await waitFor(() => expect(screen.getByRole("option", { name: "MaskablePPO" })).toBeEnabled());
  });

  it("rejects an invalid seed before calling the API", async () => {
    const api = backend();
    renderWithProviders(<Playground />);
    await screen.findByRole("option", { name: /cost-aware bayes/i });
    await userEvent.type(screen.getByLabelText(/incident seed/i), "-3");
    await userEvent.click(screen.getByRole("button", { name: /start investigation/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/non-negative whole number/i);
    expect(api.calls.some((c) => c.key === "POST /api/v1/sessions")).toBe(false);
  });

  it("starts an investigation and puts its id in the URL so a refresh can resume it", async () => {
    const api = backend();
    renderWithProviders(<Playground />);
    await startManual();
    const post = api.calls.find((c) => c.key === "POST /api/v1/sessions");
    expect(post?.body).toMatchObject({ scenario: "small", policy: "cost_aware_bayes" });
    expect(typeof (post?.body as { seed: number }).seed).toBe("number"); // client always sends a seed
    expect(navStore.search).toBe(`session=${SID}`);
    // hidden root cause must not appear anywhere while the investigation is active
    expect(screen.queryByText(/actual root cause/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not modelled/i)).toBeInTheDocument(); // honest about severity/symptoms
  });

  it("resumes an existing investigation from the URL", async () => {
    backend().state.session = afterOneTest();
    renderWithProviders(<Playground />, { search: `session=${SID}` });
    expect(await screen.findByText("Database probe", { selector: "span" })).toBeInTheDocument();
    expect(await screen.findByText(/Step 1 of 6|1 \/ 6/)).toBeInTheDocument();
  });

  it("explains a session that cannot be loaded", async () => {
    mockApi({
      "GET /api/v1/scenarios": ok(scenarios),
      "GET /api/v1/policies": ok(basePolicies),
      [`GET /api/v1/sessions/${SID}`]: err(404, "not_found", `session ${SID} not found`),
    });
    renderWithProviders(<Playground />, { search: `session=${SID}` });
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load this investigation/i);
  });
});

describe("Playground: manual investigation", () => {
  it("shows the recommendation with cost, duration, leading hypothesis and the policy's own metrics", async () => {
    backend();
    renderWithProviders(<Playground />);
    await startManual();
    const card = screen.getByText("Recommended next action").closest("section")!;
    expect(within(card).getByText("Database probe")).toBeInTheDocument();
    expect(within(card).getByText("Est. cost")).toBeInTheDocument();
    expect(within(card).getByText("Est. duration")).toBeInTheDocument();
    expect(within(card).getByText("Leading hypothesis")).toBeInTheDocument();
    expect(within(card).getByText("Expected utility if declared now")).toBeInTheDocument();
  });

  it("executes the recommended test with an idempotency step and updates the timeline and beliefs", async () => {
    const api = backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    await user.click(screen.getByRole("button", { name: /execute recommended test/i }));
    const timeline = await screen.findByRole("list", { name: "Diagnostic timeline" });
    expect(await within(timeline).findByText("FAIL")).toBeInTheDocument();
    const impact = within(timeline).getByText(/Impact:/).closest("p")!;
    expect(impact).toHaveTextContent("Database unavailable");
    expect(impact).toHaveTextContent("+40.0 pts");
    expect(within(timeline).getByText("followed policy")).toBeInTheDocument();
    const exec = api.calls.find((c) => c.key === `POST /api/v1/sessions/${SID}/tests`);
    expect(exec?.body).toEqual({ test_id: "db_probe", expected_step: 0 });
    const probs = screen.getByRole("list", { name: /root-cause probabilities/i });
    expect(within(probs).getAllByRole("listitem")[0]).toHaveTextContent("90.0%");
  });

  it("lets the user choose a different test", async () => {
    const api = backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    await user.click(screen.getByRole("button", { name: /choose another test/i }));
    const dialog = await screen.findByRole("dialog", { name: /choose another test/i });
    await user.click(within(dialog).getByRole("button", { name: "Run CPU check" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.key === `POST /api/v1/sessions/${SID}/tests`)?.body).toMatchObject({ test_id: "cpu_check" }),
    );
  });

  it("lets the user inspect an earlier belief and return to the latest", async () => {
    backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    await user.click(screen.getByRole("button", { name: /execute recommended test/i }));
    await timelineResult();
    await user.click(screen.getByRole("button", { name: /incident detected/i }));
    expect(await screen.findByText(/Prior · history/)).toBeInTheDocument();
    const probs = screen.getByRole("list", { name: /root-cause probabilities/i });
    expect(within(probs).getAllByRole("listitem")[0]).toHaveTextContent("50.0%");
    await user.click(screen.getByRole("button", { name: /back to latest/i }));
    expect(within(screen.getByRole("list", { name: /root-cause probabilities/i })).getAllByRole("listitem")[0]).toHaveTextContent("90.0%");
  });

  it("declares a root cause and shows the completion summary with the simulation's truth", async () => {
    const api = backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    await user.click(screen.getByRole("button", { name: /execute recommended test/i }));
    await timelineResult();
    await user.click(screen.getByRole("button", { name: /^declare root cause$/i }));
    const dialog = await screen.findByRole("dialog", { name: /declare root cause/i });
    expect(within(dialog).getByLabelText(/root cause to declare/i)).toHaveValue("db_down"); // most likely first
    await user.click(within(dialog).getByRole("button", { name: /declare database unavailable/i }));

    expect(await screen.findByText("Correct diagnosis")).toBeInTheDocument();
    expect(api.calls.find((c) => c.key === `POST /api/v1/sessions/${SID}/declare`)?.body).toEqual({ fault_id: "db_down" });
    const summary = screen.getByText("Correct diagnosis").closest("section")!;
    expect(within(summary).getByText("Predicted root cause")).toBeInTheDocument();
    expect(within(summary).getByText("Actual root cause")).toBeInTheDocument();
    expect(within(summary).getByText("simulation only")).toBeInTheDocument();
    expect(within(summary).getByText("Tests executed")).toBeInTheDocument();
    expect(within(summary).getByText("Total cost")).toBeInTheDocument();
    expect(within(summary).getByText("Episode reward")).toBeInTheDocument();
    // controls disappear; recommendation card is gone
    expect(screen.queryByText("Recommended next action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /execute recommended/i })).not.toBeInTheDocument();
  });

  it("reports an incorrect diagnosis plainly", async () => {
    backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    await user.click(screen.getByRole("button", { name: /^declare root cause$/i }));
    const dialog = await screen.findByRole("dialog", { name: /declare root cause/i });
    await user.selectOptions(within(dialog).getByLabelText(/root cause to declare/i), "disk_full");
    await user.click(within(dialog).getByRole("button", { name: /declare disk full/i }));
    expect(await screen.findByText("Incorrect diagnosis")).toBeInTheDocument();
  });

  it("replays a finished investigation step by step", async () => {
    backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    await user.click(screen.getByRole("button", { name: /execute recommended test/i }));
    await timelineResult();
    await user.click(screen.getByRole("button", { name: /^declare root cause$/i }));
    await user.click(await screen.findByRole("button", { name: /declare database unavailable/i }));
    await screen.findByText("Correct diagnosis");

    await user.click(screen.getByRole("button", { name: /replay investigation/i }));
    const controls = await screen.findByRole("group", { name: /replay controls/i });
    expect(within(controls).getByText(/Replay · step 0 of 1/)).toBeInTheDocument();
    expect(await screen.findByText(/Prior/)).toBeInTheDocument();
    await user.click(within(controls).getByRole("button", { name: /stop replay/i }));
    expect(screen.queryByRole("group", { name: /replay controls/i })).not.toBeInTheDocument();
  });

  it("shows the full trace and lets the user download it", async () => {
    backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    await user.click(screen.getByRole("button", { name: /execute recommended test/i }));
    await timelineResult();
    await user.click(screen.getByRole("button", { name: /view trace/i }));
    const dialog = await screen.findByRole("dialog", { name: /full diagnostic trace/i });
    expect(within(dialog).getByRole("row", { name: /database probe/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /download trace/i })).toBeInTheDocument();
  });

  it("resyncs when the session moved on elsewhere (409) instead of failing silently", async () => {
    const api = backend();
    api.set({
      [`POST /api/v1/sessions/${SID}/tests`]: () => {
        api.state.session = afterOneTest();
        return { status: 409, json: { error: { code: "stale_step", message: "stale", details: {} } } };
      },
    });
    renderWithProviders(<Playground />);
    const user = await startManual();
    const before = api.calls.filter((c) => c.key === `GET /api/v1/sessions/${SID}`).length;
    await user.click(screen.getByRole("button", { name: /execute recommended test/i }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.key === `GET /api/v1/sessions/${SID}`).length).toBeGreaterThan(before),
    );
    await timelineResult(); // picked up the new state
  });

  it("warns on the last allowed step", async () => {
    const api = backend();
    api.state.session = afterOneTest({ steps: 5, max_steps: 6 });
    renderWithProviders(<Playground />, { search: `session=${SID}` });
    expect(
      await screen.findByText(/Last step: another test would end the investigation without a diagnosis/),
    ).toBeInTheDocument();
  });

  it("shows 'step limit reached' for a truncated investigation", async () => {
    const api = backend();
    api.state.session = afterOneTest({ status: "truncated", steps: 6, available_tests: [], completed_at: "2026-10-22T08:05:00Z" });
    api.set({ [`GET /api/v1/sessions/${SID}/report`]: ok({ session: api.state.session, initial_prior: [], true_fault: "db_down", true_fault_name: "Database unavailable", declared_fault: null, correct: false, timeout: true, posterior_trace: [] }) });
    renderWithProviders(<Playground />, { search: `session=${SID}` });
    expect((await screen.findAllByText(/Step limit reached — no diagnosis/)).length).toBeGreaterThanOrEqual(1);
  });

  it("reset starts a fresh investigation of the same incident (same seed)", async () => {
    const api = backend();
    renderWithProviders(<Playground />);
    const user = await startManual();
    const firstSeed = (api.calls.find((c) => c.key === "POST /api/v1/sessions")?.body as { seed: number }).seed;
    await user.click(screen.getByRole("button", { name: /reset/i }));
    await waitFor(() => expect(api.calls.filter((c) => c.key === "POST /api/v1/sessions")).toHaveLength(2));
    expect((api.calls.filter((c) => c.key === "POST /api/v1/sessions")[1]?.body as { seed: number }).seed).toBe(firstSeed);
  });
});

describe("Playground: RL policy explanation", () => {
  it("keeps the network's action preferences separate from the Bayesian probabilities", async () => {
    backend({ policies: { ...basePolicies, ppo_available_for_scenarios: ["small"] }, rec: REC_PPO as typeof REC_TEST });
    renderWithProviders(<Playground />);
    const user = userEvent.setup();
    const policy = await screen.findByLabelText(/diagnostic policy/i);
    await waitFor(() => expect(within(policy).getByRole("option", { name: "MaskablePPO" })).toBeEnabled());
    await user.selectOptions(policy, "ppo");
    await user.click(screen.getByRole("button", { name: /start investigation/i }));
    const prefs = await screen.findByRole("region", { name: /policy action preferences/i });
    expect(within(prefs).getByText("not a diagnosis confidence")).toBeInTheDocument();
    expect(within(prefs).getByText("62%")).toBeInTheDocument();
    expect(within(prefs).getByText(/not calibrated probabilities/i)).toBeInTheDocument();
    // the Bayesian root-cause probabilities live in their own list, with their own numbers
    expect(screen.getByRole("list", { name: /root-cause probabilities/i })).toHaveTextContent("50.0%");
    expect(prefs).not.toContainElement(screen.getByRole("list", { name: /root-cause probabilities/i }));
  });
});

describe("Playground: agent mode", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  async function startAgent(speed?: string) {
    const api = backend();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<Playground />);
    await startManual(user);
    await user.click(screen.getByRole("radio", { name: /agent/i }));
    if (speed) await user.selectOptions(screen.getByLabelText("Visualization speed"), speed);
    return { api, user };
  }
  /** Advance fake time in small steps until the condition holds (network promises resolve in between). */
  async function advanceUntil(cond: () => boolean, stepMs = 250, maxSteps = 40) {
    for (let i = 0; i < maxSteps && !cond(); i++) {
      await act(async () => void vi.advanceTimersByTime(stepMs));
    }
    expect(cond()).toBe(true);
  }
  const execCalls = (api: MockApi) => api.calls.filter((c) => c.key === `POST /api/v1/sessions/${SID}/tests`);
  const declareCalls = (api: MockApi) => api.calls.filter((c) => c.key === `POST /api/v1/sessions/${SID}/declare`);

  it("does nothing until the user runs the agent, then follows the policy's recommendations to a diagnosis", async () => {
    const { api, user } = await startAgent();
    await act(async () => void vi.advanceTimersByTime(BASE_STEP_DELAY_MS * 3));
    expect(execCalls(api)).toHaveLength(0); // paused by default

    await user.click(screen.getByRole("button", { name: /run agent/i }));
    await advanceUntil(() => execCalls(api).length === 1);
    expect(execCalls(api)[0]?.body).toEqual({ test_id: "db_probe", expected_step: 0 });
    await advanceUntil(() => declareCalls(api).length === 1);
    expect(declareCalls(api)[0]?.body).toEqual({ fault_id: "db_down" }); // REC_DECLARE
    expect(await screen.findByText("Correct diagnosis")).toBeInTheDocument();
  });

  it("waits one full step delay at 1x, and a proportionally shorter one at higher speed", async () => {
    const slow = await startAgent();
    await slow.user.click(screen.getByRole("button", { name: /run agent/i }));
    await act(async () => void vi.advanceTimersByTime(BASE_STEP_DELAY_MS - 150));
    expect(execCalls(slow.api)).toHaveLength(0);
    await act(async () => void vi.advanceTimersByTime(300));
    await waitFor(() => expect(execCalls(slow.api)).toHaveLength(1));
  });

  it("speed only changes the on-screen pace, never the modelled cost, duration or request payload", async () => {
    const fast = await startAgent("4");
    await fast.user.click(screen.getByRole("button", { name: /run agent/i }));
    await act(async () => void vi.advanceTimersByTime(BASE_STEP_DELAY_MS / 4 + 50));
    await waitFor(() => expect(execCalls(fast.api)).toHaveLength(1)); // quicker than 1x
    expect(execCalls(fast.api)[0]?.body).toEqual({ test_id: "db_probe", expected_step: 0 });
    // the modelled values shown come from the backend and are the same as at any other speed
    const timeline = await screen.findByRole("list", { name: "Diagnostic timeline" });
    expect(within(timeline).getByText("5s")).toBeInTheDocument(); // modelled duration
    expect(screen.getAllByText("1.0").length).toBeGreaterThan(0); // modelled cost
  });

  it("pauses on request and resumes", async () => {
    const { api, user } = await startAgent("4");
    await user.click(screen.getByRole("button", { name: /run agent/i }));
    await user.click(screen.getByRole("button", { name: /^pause$/i }));
    await act(async () => void vi.advanceTimersByTime(BASE_STEP_DELAY_MS * 4));
    expect(execCalls(api)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /^run agent$|^resume$/i }));
    await act(async () => void vi.advanceTimersByTime(BASE_STEP_DELAY_MS));
    await waitFor(() => expect(execCalls(api)).toHaveLength(1));
  });

  it("steps forward one action at a time while paused", async () => {
    const { api, user } = await startAgent();
    await user.click(screen.getByRole("button", { name: /step forward/i }));
    await waitFor(() => expect(execCalls(api)).toHaveLength(1));
    await act(async () => void vi.advanceTimersByTime(BASE_STEP_DELAY_MS * 5));
    expect(execCalls(api)).toHaveLength(1); // no automatic continuation
    expect(declareCalls(api)).toHaveLength(0);
  });
});
