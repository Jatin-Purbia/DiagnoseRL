"""Validated scenario configuration.

A scenario defines the faults (hidden root causes), the diagnostic tests and the
conditional outcome distributions ``P(result | fault, test)``. It is loaded from
YAML/JSON and compiled into a dense :class:`DiagnosticModel` used by the
simulator, the Bayesian engine and all policies.
"""

from __future__ import annotations

import dataclasses
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

PROB_TOL = 1e-6

# Outcome distribution: outcome label -> probability.
OutcomeDist = dict[str, float]


class FaultSpec(BaseModel):
    """A candidate root cause."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    category: str = "general"
    prior: float = Field(ge=0.0, le=1.0)
    enabled: bool = True


class LikelihoodSpec(BaseModel):
    """``P(result | fault)`` for one test.

    ``default`` applies to every fault without an entry in ``overrides``
    (typically the "test is unaffected by this fault" behaviour, including
    background noise).
    """

    model_config = ConfigDict(extra="forbid")

    default: OutcomeDist
    overrides: dict[str, OutcomeDist] = Field(default_factory=dict)


class TestSpec(BaseModel):
    """A diagnostic test (simulated in this release)."""

    # Not a pytest test class despite the name.
    __test__ = False
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    category: str = "general"
    cost: float = Field(ge=0.0)
    duration: float = Field(ge=0.0)
    outcomes: list[str] = Field(min_length=2)
    likelihood: LikelihoodSpec
    # Eligibility: this test may only run after all listed tests were executed.
    requires: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_outcomes(self) -> TestSpec:
        if len(set(self.outcomes)) != len(self.outcomes):
            raise ValueError(f"test {self.id!r}: duplicate outcome labels")
        if self.id in self.requires:
            raise ValueError(f"test {self.id!r} cannot require itself")
        return self


def _check_dist(dist: OutcomeDist, outcomes: list[str], where: str) -> None:
    unknown = set(dist) - set(outcomes)
    if unknown:
        raise ValueError(f"{where}: unknown outcomes {sorted(unknown)}")
    for label, p in dist.items():
        if not math.isfinite(p) or p < 0.0:
            raise ValueError(f"{where}: probability for {label!r} must be finite and >= 0, got {p}")
    total = sum(dist.values())
    if abs(total - 1.0) > PROB_TOL:
        raise ValueError(f"{where}: probabilities sum to {total:.8f}, expected 1")


class ScenarioConfig(BaseModel):
    """A complete, internally consistent diagnostic scenario."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: str = ""
    faults: list[FaultSpec] = Field(min_length=2)
    tests: list[TestSpec] = Field(min_length=1)
    # Investigation step cap (tests + the final declaration count as steps).
    max_steps: int = Field(ge=1)

    @model_validator(mode="after")
    def _validate(self) -> ScenarioConfig:
        fault_ids = [f.id for f in self.faults]
        test_ids = [t.id for t in self.tests]
        if len(set(fault_ids)) != len(fault_ids):
            raise ValueError("duplicate fault ids")
        if len(set(test_ids)) != len(test_ids):
            raise ValueError("duplicate test ids")

        enabled = [f for f in self.faults if f.enabled]
        if len(enabled) < 2:
            raise ValueError("at least two faults must be enabled")
        for f in enabled:
            if f.prior <= 0.0:
                raise ValueError(f"enabled fault {f.id!r} must have a nonzero prior")
        total = sum(f.prior for f in enabled)
        if abs(total - 1.0) > PROB_TOL:
            raise ValueError(f"priors of enabled faults sum to {total:.8f}, expected 1")

        known_faults = set(fault_ids)
        known_tests = set(test_ids)
        for t in self.tests:
            _check_dist(t.likelihood.default, t.outcomes, f"test {t.id!r} default")
            for fid, dist in t.likelihood.overrides.items():
                if fid not in known_faults:
                    raise ValueError(f"test {t.id!r}: override for unknown fault {fid!r}")
                _check_dist(dist, t.outcomes, f"test {t.id!r} override for {fid!r}")
            missing = set(t.requires) - known_tests
            if missing:
                raise ValueError(f"test {t.id!r} requires unknown tests {sorted(missing)}")

        self._check_acyclic()
        return self

    def _check_acyclic(self) -> None:
        requires = {t.id: list(t.requires) for t in self.tests}
        state: dict[str, int] = {}  # 1 = visiting, 2 = done

        def visit(node: str) -> None:
            if state.get(node) == 2:
                return
            if state.get(node) == 1:
                raise ValueError(f"cyclic test prerequisites involving {node!r}")
            state[node] = 1
            for dep in requires[node]:
                visit(dep)
            state[node] = 2

        for tid in requires:
            visit(tid)

    def compile(self) -> DiagnosticModel:
        """Build the dense numerical model (disabled faults are dropped)."""
        faults = [f for f in self.faults if f.enabled]
        fault_ids = [f.id for f in faults]

        outcome_labels: list[str] = []
        for t in self.tests:
            for o in t.outcomes:
                if o not in outcome_labels:
                    outcome_labels.append(o)
        o_index = {o: i for i, o in enumerate(outcome_labels)}

        n_tests, n_faults, n_out = len(self.tests), len(faults), len(outcome_labels)
        likelihood = np.zeros((n_tests, n_faults, n_out), dtype=np.float64)
        for ti, t in enumerate(self.tests):
            for fi, f in enumerate(faults):
                dist = t.likelihood.overrides.get(f.id, t.likelihood.default)
                for label, p in dist.items():
                    likelihood[ti, fi, o_index[label]] = p

        test_index = {t.id: i for i, t in enumerate(self.tests)}
        requires = np.zeros((n_tests, n_tests), dtype=bool)
        for ti, t in enumerate(self.tests):
            for dep in t.requires:
                requires[ti, test_index[dep]] = True

        prior = np.array([f.prior for f in faults], dtype=np.float64)
        return DiagnosticModel(
            name=self.name,
            fault_ids=fault_ids,
            fault_names=[f.name for f in faults],
            test_ids=[t.id for t in self.tests],
            test_names=[t.name for t in self.tests],
            outcome_labels=outcome_labels,
            prior=prior / prior.sum(),
            likelihood=likelihood,
            cost=np.array([t.cost for t in self.tests], dtype=np.float64),
            duration=np.array([t.duration for t in self.tests], dtype=np.float64),
            requires=requires,
            max_steps=self.max_steps,
        )


@dataclass(frozen=True)
class DiagnosticModel:
    """Dense numerical form of a scenario.

    Shapes: ``F`` faults, ``T`` tests, ``O`` outcomes (union over all tests).
    ``likelihood[t, f, o] = P(outcome o | test t, fault f)``; outcomes a test
    cannot produce have probability zero.

    Modelling assumption: test outcomes are conditionally independent given the
    root cause. The Bayesian update in :mod:`diagnoserl.bayes` is only valid
    under this assumption.
    """

    name: str
    fault_ids: list[str]
    fault_names: list[str]
    test_ids: list[str]
    test_names: list[str]
    outcome_labels: list[str]
    prior: np.ndarray
    likelihood: np.ndarray
    cost: np.ndarray
    duration: np.ndarray
    requires: np.ndarray
    max_steps: int
    log_likelihood: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        with np.errstate(divide="ignore"):
            object.__setattr__(self, "log_likelihood", np.log(self.likelihood))

    @property
    def n_faults(self) -> int:
        return len(self.fault_ids)

    @property
    def n_tests(self) -> int:
        return len(self.test_ids)

    @property
    def n_outcomes(self) -> int:
        return len(self.outcome_labels)

    @property
    def n_actions(self) -> int:
        """Test actions followed by fault-declaration actions."""
        return self.n_tests + self.n_faults

    def available_tests(self, executed: np.ndarray) -> np.ndarray:
        """Boolean ``(T,)`` mask of tests that may run given the executed set."""
        prerequisites_met = ~(self.requires & ~executed[None, :]).any(axis=1)
        return np.asarray(~executed & prerequisites_met)

    def replace(self, **changes: Any) -> DiagnosticModel:
        """Copy of this model with some fields replaced (derived fields are recomputed)."""
        return dataclasses.replace(self, **changes)

    def replace_likelihood(self, likelihood: np.ndarray) -> DiagnosticModel:
        """Copy of this model with a different likelihood tensor."""
        return self.replace(likelihood=likelihood)
