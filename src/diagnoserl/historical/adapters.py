"""Read-only diagnostic adapters and the human-approval gate for advisor mode.

Design rules for connecting DiagnoseRL to real systems (none are implemented here; only the
interface and a simulated adapter exist):

* Adapters are **explicitly registered**; nothing is discovered or loaded dynamically, and
  tests are never defined as shell commands.
* An adapter must declare ``read_only = True`` and the network ``destinations`` it contacts;
  registration fails unless every destination is on the operator's allowlist.
* Every execution needs a **named human approval** (``approved_by``), has a **timeout**, and is
  written to an audit log.
* There is **no remediation**: the advisor suggests tests and a diagnosis, nothing else.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

log = logging.getLogger(__name__)


class AdapterError(Exception):
    """Base class for adapter policy violations."""


class ApprovalRequired(AdapterError):
    """A diagnostic action was attempted without a named human approval."""


class AdapterTimeout(AdapterError):
    """The adapter exceeded its time limit."""


class AdapterNotAllowed(AdapterError):
    """Registration or lookup violated the allowlist rules."""


@runtime_checkable
class DiagnosticAdapter(Protocol):
    """A read-only probe that returns an outcome label (e.g. ``PASS`` / ``FAIL``)."""

    id: str
    read_only: bool
    destinations: tuple[str, ...]

    def run(self) -> str: ...


@dataclass
class SimulatedAdapter:
    """Adapter backed by a callable; used for tests and simulation. Contacts no network."""

    id: str
    func: Callable[[], str]
    read_only: bool = True
    destinations: tuple[str, ...] = ()

    def run(self) -> str:
        return self.func()


@dataclass(frozen=True)
class AuditRecord:
    ts: datetime
    test_id: str
    approved_by: str
    outcome: str | None
    error: str | None


@dataclass
class AdapterRegistry:
    allowed_destinations: frozenset[str] = frozenset()
    timeout_seconds: float = 10.0
    audit_log: list[AuditRecord] = field(default_factory=list)
    _adapters: dict[str, DiagnosticAdapter] = field(default_factory=dict)
    _pool: ThreadPoolExecutor = field(default_factory=lambda: ThreadPoolExecutor(max_workers=2))

    def register(self, adapter: DiagnosticAdapter) -> None:
        if not adapter.read_only:
            raise AdapterNotAllowed(f"adapter {adapter.id!r} is not read-only")
        extra = set(adapter.destinations) - self.allowed_destinations
        if extra:
            raise AdapterNotAllowed(
                f"adapter {adapter.id!r} uses destinations outside the allowlist: {sorted(extra)}"
            )
        if adapter.id in self._adapters:
            raise AdapterNotAllowed(f"adapter {adapter.id!r} is already registered")
        self._adapters[adapter.id] = adapter

    def available(self) -> list[str]:
        return sorted(self._adapters)

    def execute(self, test_id: str, approved_by: str | None) -> str:
        """Run a registered adapter after named human approval, with a timeout."""
        if not approved_by or not approved_by.strip():
            raise ApprovalRequired(f"running {test_id!r} requires approval by a named person")
        adapter = self._adapters.get(test_id)
        if adapter is None:
            raise AdapterNotAllowed(f"no registered adapter for {test_id!r}")
        future = self._pool.submit(adapter.run)
        try:
            outcome = future.result(timeout=self.timeout_seconds)
        except FutureTimeout as exc:
            future.cancel()
            self._record(test_id, approved_by, None, "timeout")
            raise AdapterTimeout(f"{test_id!r} exceeded {self.timeout_seconds}s") from exc
        except Exception as exc:
            self._record(test_id, approved_by, None, type(exc).__name__)
            raise AdapterError(f"{test_id!r} failed: {type(exc).__name__}") from exc
        self._record(test_id, approved_by, outcome, None)
        return outcome

    def _record(self, test_id: str, approver: str, outcome: str | None, error: str | None) -> None:
        rec = AuditRecord(datetime.now(UTC), test_id, approver, outcome, error)
        self.audit_log.append(rec)
        log.info(
            "adapter executed", extra={"test": test_id, "approved_by": approver, "error": error}
        )

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
