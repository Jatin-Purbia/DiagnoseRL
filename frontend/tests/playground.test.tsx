import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Playground } from "@/components/Playground";
import type { Recommendation, Report } from "@/lib/types";
import { FAULTS, TESTS, makeExecuted, makeSession, mockApi } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const SID = "11111111-1111-1111-1111-111111111111";

const recommendation: Recommendation = {
  policy: "cost_aware_bayes",
  action: { type: "test", id: "db_probe", name: "Database probe", estimated_cost: 1, estimated_duration: 5 },
  confidence: 0.5,
  explanation: { method: "expected_utility_lookahead_depth_2", utility_declare_now: -0.5, value_of_testing: 1.2 },
};

const baseRoutes = {
  "GET /scenarios": () => ({
    json: [{ name: "small", description: "", n_faults: 3, n_tests: 2, max_steps: 6 }],
  }),
  "GET /policies": () => ({
    json: { policies: ["cost_aware_bayes", "ppo"], ppo_available_for_scenarios: [] },
  }),
};

describe("Playground", () => {
  it("shows an empty state and disables RL policy without an active model", async () => {
    mockApi(baseRoutes);
    render(<Playground />);
    expect(screen.getByText("No investigation running")).toBeInTheDocument();
    const policy = await screen.findByLabelText(/diagnostic policy/i);
    await waitFor(() => expect(within(policy).getByRole("option", { name: /ppo/i })).toBeDisabled());
    expect(within(policy).getByRole("option", { name: /ppo.*no active model/i })).toBeInTheDocument();
  });

  it("runs a full investigation: start, recommendation, test, declare, report", async () => {
    const user = userEvent.setup();
    const started = makeSession();
    const afterTest = makeSession({
      steps: 1,
      cost: 1,
      elapsed: 5,
      executed: [makeExecuted()],
      available_tests: ["cpu_check"],
      posterior: [
        { id: "db_down", name: "Database unavailable", probability: 0.9 },
        { id: "cpu_high", name: "CPU saturation", probability: 0.06 },
        { id: "disk_full", name: "Disk full", probability: 0.04 },
      ],
      confidence: 0.9,
    });
    const finished = makeSession({ ...afterTest, status: "declared", available_tests: [], total_reward: 9.5 });
    const report: Report = {
      session: finished,
      initial_prior: started.posterior,
      true_fault: "db_down",
      true_fault_name: "Database unavailable",
      declared_fault: "db_down",
      correct: true,
      timeout: false,
      posterior_trace: [
        { step: 0, posterior: [0.5, 0.3, 0.2], entropy_bits: 1.49 },
        { step: 1, posterior: [0.9, 0.06, 0.04], entropy_bits: 0.55 },
      ],
    };

    let phase: "start" | "tested" | "done" = "start";
    const { calls } = mockApi({
      ...baseRoutes,
      "POST /sessions": () => ({ status: 201, json: started }),
      [`GET /sessions/${SID}/tests`]: () => ({
        json: TESTS.map((t) => ({
          ...t,
          executed: phase !== "start" && t.id === "db_probe",
          available: phase === "start" || t.id !== "db_probe",
        })),
      }),
      [`GET /sessions/${SID}/recommendation`]: () => ({ json: recommendation }),
      [`POST /sessions/${SID}/tests`]: () => {
        phase = "tested";
        return { json: { result: afterTest.executed[0], replayed: false, session: afterTest } };
      },
      [`POST /sessions/${SID}/declare`]: () => {
        phase = "done";
        return { json: { declaration: { fault_id: "db_down", correct: true, reward: 10 }, true_fault: "db_down", session: finished } };
      },
      [`GET /sessions/${SID}/report`]: () => ({ json: report }),
    });

    render(<Playground />);
    await user.click(screen.getByRole("button", { name: /start investigation/i }));

    // posterior chart + recommendation with cost / duration / confidence
    expect(await screen.findByRole("img", { name: /posterior probability of each candidate/i })).toBeInTheDocument();
    expect(await screen.findByText("Recommended next action")).toBeInTheDocument();
    expect(screen.getByText("Est. cost")).toBeInTheDocument();
    expect(screen.getByText("Current confidence")).toBeInTheDocument();
    expect(screen.getByText(/utility declare now/i)).toBeInTheDocument();
    // the hidden fault is not shown yet
    expect(screen.queryByText(/true root cause/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /run recommended test/i }));
    expect((await screen.findAllByText("FAIL")).length).toBeGreaterThanOrEqual(2); // test table + trace
    expect(screen.getByText(/Database unavailable \+40\.0 pts/)).toBeInTheDocument();
    expect(screen.getByText("followed policy")).toBeInTheDocument();
    expect(calls.find((c) => c.key === `POST /sessions/${SID}/tests`)?.body).toEqual({
      test_id: "db_probe",
      expected_step: 0,
    });

    await user.click(screen.getByRole("button", { name: /declare root cause/i }));
    expect(await screen.findByText("Final diagnostic report")).toBeInTheDocument();
    expect(screen.getAllByText("correct").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Database unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("True root cause")).toBeInTheDocument();
    expect(screen.queryByText("Recommended next action")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /leading faults after each step/i })).toBeInTheDocument();
  });

  it("shows API errors without losing the page", async () => {
    const user = userEvent.setup();
    mockApi({
      ...baseRoutes,
      "POST /sessions": () => ({
        status: 404,
        json: { error: { code: "not_found", message: "scenario small not found" } },
      }),
    });
    render(<Playground />);
    await user.click(screen.getByRole("button", { name: /start investigation/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("scenario small not found");
    expect(screen.getByText("No investigation running")).toBeInTheDocument();
  });

  it("validates the seed before calling the API", async () => {
    const user = userEvent.setup();
    const { calls } = mockApi(baseRoutes);
    render(<Playground />);
    await user.type(screen.getByLabelText(/incident seed/i), "-3");
    await user.click(screen.getByRole("button", { name: /start investigation/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/non-negative integer/i);
    expect(calls.some((c) => c.key === "POST /sessions")).toBe(false);
  });

  it("refreshes state when a step conflicts (stale session)", async () => {
    const user = userEvent.setup();
    const started = makeSession();
    const advanced = makeSession({ steps: 1, executed: [makeExecuted()], available_tests: ["cpu_check"] });
    mockApi({
      ...baseRoutes,
      "POST /sessions": () => ({ status: 201, json: started }),
      [`GET /sessions/${SID}/tests`]: () => ({ json: TESTS }),
      [`GET /sessions/${SID}/recommendation`]: () => ({ json: recommendation }),
      [`POST /sessions/${SID}/tests`]: () => ({
        status: 409,
        json: { error: { code: "stale_step", message: "session has advanced past expected_step" } },
      }),
      [`GET /sessions/${SID}`]: () => ({ json: advanced }),
    });
    render(<Playground />);
    await user.click(screen.getByRole("button", { name: /start investigation/i }));
    await user.click(await screen.findByRole("button", { name: /run database probe/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/refreshed/i);
    expect(await screen.findByText(/Step 1 of 6/)).toBeInTheDocument();
  });

  it("explains PPO output honestly (no calibrated-probability claim)", async () => {
    const user = userEvent.setup();
    mockApi({
      ...baseRoutes,
      "GET /policies": () => ({
        json: { policies: ["cost_aware_bayes", "ppo"], ppo_available_for_scenarios: ["small"] },
      }),
      "POST /sessions": () => ({ status: 201, json: makeSession({ policy: "ppo" }) }),
      [`GET /sessions/${SID}/tests`]: () => ({ json: TESTS }),
      [`GET /sessions/${SID}/recommendation`]: () => ({
        json: {
          ...recommendation,
          policy: "ppo",
          explanation: {
            method: "policy_network_action_distribution",
            top_actions: [{ action: "db_probe", probability: 0.62 }],
            note: "Action preferences of the policy network at this state. They are not calibrated probabilities that the corresponding diagnosis is correct, and they are not a causal explanation of the choice.",
          },
        },
      }),
    });
    render(<Playground />);
    const policy = await screen.findByLabelText(/diagnostic policy/i);
    await waitFor(() => expect(within(policy).getByRole("option", { name: /ppo/i })).toBeEnabled());
    await user.selectOptions(policy, "ppo");
    await user.click(screen.getByRole("button", { name: /start investigation/i }));
    expect(await screen.findByText(/not calibrated probabilities/i)).toBeInTheDocument();
    expect(screen.getByText("62.0%")).toBeInTheDocument();
  });
});

describe("faults fixture sanity", () => {
  it("has three faults", () => expect(FAULTS).toHaveLength(3));
});
