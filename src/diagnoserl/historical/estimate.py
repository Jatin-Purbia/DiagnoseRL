"""Estimate a fault/test model from historical incidents.

Estimates
---------
* fault prior: smoothed relative frequency of confirmed root causes.
* ``P(outcome | fault, test)``: counts over **observed** results, smoothed towards the pooled
  distribution of that test (empirical-Bayes shrinkage with strength ``smoothing``). Cells with
  few observations therefore fall back to the pooled behaviour of the test and are reported.
  Smoothing also guarantees no probability is exactly zero.
* duration / cost: mean of recorded values; defaults (flagged) where none were recorded.

Caveats (see ``docs/historical-data.md``)
-----------------------------------------
Historical tests were chosen by engineers, usually because they suspected a particular
fault. The estimates are therefore ``P(outcome | fault, test chosen)``, not the quantity a
policy needs when *it* chooses the test, and "missing" tests are not missing at random.
``selection_bias`` in the report quantifies how unevenly each test was run across faults.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field

from diagnoserl.config.schema import FaultSpec, LikelihoodSpec, ScenarioConfig, TestSpec
from diagnoserl.historical.schema import HistoricalIncident


class InsufficientDataError(ValueError):
    """Not enough incidents / faults / tests to estimate a usable model."""


@dataclass(frozen=True)
class EstimationConfig:
    smoothing: float = 3.0  # pseudo-count mass pulling each cell towards the pooled distribution
    prior_alpha: float = 1.0  # Laplace smoothing of the fault prior
    min_total_incidents: int = 20
    min_incidents_per_fault: int = 5
    min_observations_per_cell: int = 5
    default_cost: float = 1.0
    default_duration: float = 10.0
    max_steps: int = 8
    selection_bias_ratio: float = 3.0  # flag a test if its run-rate differs this much across faults


@dataclass
class EstimationReport:
    n_incidents: int
    fault_counts: dict[str, int]
    test_observation_counts: dict[str, int]
    missing_counts: dict[str, int]
    sparse_faults: list[str] = field(default_factory=list)
    sparse_cells: list[tuple[str, str, int]] = field(default_factory=list)  # (test, fault, n)
    dropped_tests: list[str] = field(default_factory=list)
    defaulted_costs: list[str] = field(default_factory=list)
    defaulted_durations: list[str] = field(default_factory=list)
    selection_bias: dict[str, dict[str, float]] = field(default_factory=dict)
    biased_tests: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _selection_bias(
    incidents: Sequence[HistoricalIncident], faults: Sequence[str], cfg: EstimationConfig
) -> tuple[dict[str, dict[str, float]], list[str]]:
    by_fault: dict[str, list[HistoricalIncident]] = defaultdict(list)
    for inc in incidents:
        by_fault[inc.confirmed_root_cause].append(inc)
    test_ids = sorted({t.test_id for inc in incidents for t in inc.tests})
    rates: dict[str, dict[str, float]] = {}
    biased: list[str] = []
    for tid in test_ids:
        per_fault = {
            f: sum(1 for i in by_fault[f] if tid in i.executed_ids()) / len(by_fault[f])
            for f in faults
            if len(by_fault[f]) >= cfg.min_incidents_per_fault
        }
        if len(per_fault) < 2:
            continue
        rates[tid] = per_fault
        lo, hi = min(per_fault.values()), max(per_fault.values())
        if hi > 0 and (lo == 0 or hi / lo >= cfg.selection_bias_ratio):
            biased.append(tid)
    return rates, biased


def estimate_scenario(
    incidents: Sequence[HistoricalIncident],
    cfg: EstimationConfig | None = None,
    name: str = "estimated",
) -> tuple[ScenarioConfig, EstimationReport]:
    """Fit a scenario from incidents; returns the model and a diagnostic report."""
    cfg = cfg or EstimationConfig()
    n = len(incidents)
    if n < cfg.min_total_incidents:
        raise InsufficientDataError(
            f"{n} incidents is below the minimum of {cfg.min_total_incidents}"
        )
    fault_counts = Counter(i.confirmed_root_cause for i in incidents)
    if len(fault_counts) < 2:
        raise InsufficientDataError("at least two distinct root causes are required")

    observed: dict[str, dict[str, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    durations: dict[str, list[float]] = defaultdict(list)
    costs: dict[str, list[float]] = defaultdict(list)
    missing: Counter[str] = Counter()
    obs_counts: Counter[str] = Counter()
    for inc in incidents:
        for t in inc.tests:
            if t.status == "missing":
                missing[t.test_id] += 1
                continue
            assert t.outcome is not None
            observed[t.test_id][inc.confirmed_root_cause][t.outcome] += 1
            obs_counts[t.test_id] += 1
            if t.duration_seconds is not None:
                durations[t.test_id].append(t.duration_seconds)
            if t.cost is not None:
                costs[t.test_id].append(t.cost)

    report = EstimationReport(
        n_incidents=n,
        fault_counts=dict(fault_counts),
        test_observation_counts=dict(obs_counts),
        missing_counts=dict(missing),
    )
    faults = sorted(fault_counts)
    report.sparse_faults = [f for f in faults if fault_counts[f] < cfg.min_incidents_per_fault]
    if report.sparse_faults:
        report.warnings.append(
            f"faults with fewer than {cfg.min_incidents_per_fault} incidents: "
            f"{report.sparse_faults}; their estimates rely mostly on smoothing"
        )

    # fault prior (Laplace smoothed)
    total = n + cfg.prior_alpha * len(faults)
    priors = {f: (fault_counts[f] + cfg.prior_alpha) / total for f in faults}

    tests: list[TestSpec] = []
    for tid in sorted(observed):
        outcomes = sorted({o for f in observed[tid] for o in observed[tid][f]})
        if len(outcomes) < 2:
            report.dropped_tests.append(tid)
            report.warnings.append(f"test {tid!r} dropped: only one outcome was ever observed")
            continue
        pooled = Counter[str]()
        for f in faults:
            pooled.update(observed[tid].get(f, Counter()))
        pooled_total = sum(pooled.values())
        pooled_dist = {o: pooled[o] / pooled_total for o in outcomes}

        def cell(
            fault: str,
            tid: str = tid,
            outs: list[str] = outcomes,
            pd: dict[str, float] = pooled_dist,
        ) -> dict[str, float]:
            counts = observed[tid].get(fault, Counter())
            n_cell = sum(counts.values())
            if n_cell < cfg.min_observations_per_cell:
                report.sparse_cells.append((tid, fault, n_cell))
            return {o: (counts[o] + cfg.smoothing * pd[o]) / (n_cell + cfg.smoothing) for o in outs}

        overrides = {f: cell(f) for f in faults}
        # `default` is only used for faults without an override; every fault has one here.
        tests.append(
            TestSpec(
                id=tid,
                name=tid.replace("_", " "),
                cost=(sum(costs[tid]) / len(costs[tid])) if costs[tid] else cfg.default_cost,
                duration=(sum(durations[tid]) / len(durations[tid]))
                if durations[tid]
                else cfg.default_duration,
                outcomes=outcomes,
                likelihood=LikelihoodSpec(default=pooled_dist, overrides=overrides),
            )
        )
        if not costs[tid]:
            report.defaulted_costs.append(tid)
        if not durations[tid]:
            report.defaulted_durations.append(tid)

    if not tests:
        raise InsufficientDataError("no test has more than one observed outcome")
    if report.sparse_cells:
        report.warnings.append(
            f"{len(report.sparse_cells)} (test, fault) cells have fewer than "
            f"{cfg.min_observations_per_cell} observations and were shrunk to the pooled "
            "distribution"
        )
    if report.defaulted_costs:
        report.warnings.append(f"no recorded cost for {report.defaulted_costs}; default used")

    rates, biased = _selection_bias(incidents, faults, cfg)
    report.selection_bias, report.biased_tests = rates, biased
    if biased:
        report.warnings.append(
            f"tests {biased} were run at very different rates across faults: engineers chose them "
            "based on suspicion, so P(outcome | fault) estimated from these records is biased "
            "for a policy that would choose tests differently"
        )

    scenario = ScenarioConfig(
        name=name,
        description=f"Estimated from {n} historical incidents.",
        faults=[FaultSpec(id=f, name=f.replace("_", " "), prior=priors[f]) for f in faults],
        tests=tests,
        max_steps=min(cfg.max_steps, len(tests) + 1),
    )
    return scenario, report
