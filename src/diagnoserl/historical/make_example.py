"""Generate a clearly labelled SYNTHETIC example incident file.

The records come from the simulator, with engineers modelled as choosing tests by a simple
suspicion heuristic (so the file exhibits selection bias like real data does). They are *not*
real incidents and must not be presented as such. Every record carries
``resolution["source"] == "synthetic-simulator"``.

Usage::

    python -m diagnoserl.historical.make_example --out examples/incidents_example.jsonl --n 600
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta

import numpy as np

from diagnoserl.config import DiagnosticModel, load_model
from diagnoserl.historical.io import write_incidents
from diagnoserl.historical.schema import HistoricalIncident, TestRecord
from diagnoserl.incident import Incident, generate_incidents


def synthesize(
    model: DiagnosticModel, n: int, seed: int, p_missing: float = 0.05
) -> list[HistoricalIncident]:
    """Simulate engineers: first the cheap broad checks, then tests matching the likeliest fault."""
    rng = np.random.default_rng(seed)
    start = datetime(2025, 1, 1, tzinfo=UTC)
    out: list[HistoricalIncident] = []
    cheap_first = [int(t) for t in np.argsort(model.cost, kind="stable")[:2]]
    for inc in generate_incidents(model, n, seed):
        belief = model.prior.copy()
        ran: list[int] = []
        records: list[TestRecord] = []

        def run(
            t: int,
            belief: np.ndarray,
            ran: list[int],
            records: list[TestRecord],
            inc: Incident = inc,
        ) -> np.ndarray:
            ran.append(t)
            if rng.random() < p_missing:
                records.append(TestRecord(test_id=model.test_ids[t], status="missing"))
                return belief
            o = int(inc.outcomes[t])
            records.append(
                TestRecord(
                    test_id=model.test_ids[t],
                    status="observed",
                    outcome=model.outcome_labels[o],
                    duration_seconds=float(model.duration[t] * rng.uniform(0.8, 1.2)),
                    cost=float(model.cost[t]),
                )
            )
            post = belief * model.likelihood[t, :, o]
            return np.asarray(post / post.sum())

        for t in cheap_first:
            belief = run(t, belief, ran, records)
        for _ in range(3):  # then follow suspicion: the test most characteristic of the top fault
            top = int(np.argmax(belief))
            candidates = [
                t
                for t in model.available_tests(np.isin(np.arange(model.n_tests), ran)).nonzero()[0]
            ]
            if not candidates:
                break
            pick = max(candidates, key=lambda c: float(model.likelihood[c, top].max()))
            belief = run(int(pick), belief, ran, records)
        out.append(
            HistoricalIncident(
                incident_id=f"SYN-{inc.incident_id:05d}",
                timestamp=start + timedelta(hours=7 * inc.incident_id),
                confirmed_root_cause=model.fault_ids[inc.fault],
                symptoms=[],
                tests=records,
                resolution={"source": "synthetic-simulator", "note": "NOT real incident data"},
            )
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="examples/incidents_example.jsonl")
    parser.add_argument("--n", type=int, default=600)
    parser.add_argument("--seed", type=int, default=2025)
    parser.add_argument("--scenario", default="standard")
    args = parser.parse_args()
    n = write_incidents(args.out, synthesize(load_model(args.scenario), args.n, args.seed))
    print(f"wrote {n} SYNTHETIC incidents to {args.out}")


if __name__ == "__main__":
    main()
