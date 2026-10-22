"""Schema for historical incident records.

One record describes a past incident: its confirmed root cause, the symptoms seen, and the
diagnostic tests engineers ran, with outcomes.

Three different situations must never be conflated:

* **observed**: the test was run and returned ``outcome`` (including a "negative" outcome
  such as ``PASS``; that is real evidence).
* **missing**: the test was run but its result was lost or unusable. Carries no outcome and
  is excluded from probability estimates; it is *not* treated as a negative result.
* **not run**: the test does not appear in ``tests`` at all. Engineers choose tests, so
  absence is informative about their beliefs, not about the system
  (see ``docs/historical-data.md``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TestRecord(BaseModel):
    __test__ = False  # not a pytest class
    model_config = ConfigDict(extra="forbid")

    test_id: str = Field(min_length=1)
    status: Literal["observed", "missing"]
    outcome: str | None = None
    duration_seconds: float | None = Field(default=None, ge=0.0)
    cost: float | None = Field(default=None, ge=0.0)

    @model_validator(mode="after")
    def _outcome_matches_status(self) -> TestRecord:
        if self.status == "observed" and not self.outcome:
            raise ValueError(f"test {self.test_id!r}: observed results need an outcome")
        if self.status == "missing" and self.outcome is not None:
            raise ValueError(f"test {self.test_id!r}: a missing result cannot carry an outcome")
        return self


class HistoricalIncident(BaseModel):
    model_config = ConfigDict(extra="forbid")

    incident_id: str = Field(min_length=1)
    timestamp: datetime
    confirmed_root_cause: str = Field(min_length=1)
    symptoms: list[str] = Field(default_factory=list)
    tests: list[TestRecord] = Field(default_factory=list)
    resolution: dict[str, Any] = Field(default_factory=dict)  # free-form metadata

    @model_validator(mode="after")
    def _unique_tests(self) -> HistoricalIncident:
        ids = [t.test_id for t in self.tests]
        if len(set(ids)) != len(ids):
            raise ValueError(f"incident {self.incident_id!r}: a test appears more than once")
        return self

    def observed(self) -> dict[str, TestRecord]:
        """Tests with a usable outcome."""
        return {t.test_id: t for t in self.tests if t.status == "observed"}

    def executed_ids(self) -> set[str]:
        """Tests that were run (observed or missing)."""
        return {t.test_id for t in self.tests}
