"""Reading and writing historical incident files (JSON array or JSON Lines)."""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path

from pydantic import ValidationError

from diagnoserl.historical.schema import HistoricalIncident


class IncidentDataError(ValueError):
    """Raised when an incident file is malformed. The message names the offending record."""


def load_incidents(path: str | Path) -> list[HistoricalIncident]:
    """Load and validate incidents from ``.jsonl`` (one object per line) or ``.json`` (array)."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    incidents: list[HistoricalIncident] = []
    if p.suffix.lower() == ".json":
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            raise IncidentDataError(f"{p.name}: invalid JSON: {exc}") from exc
        if not isinstance(raw, list):
            raise IncidentDataError(f"{p.name}: expected a JSON array of incidents")
        records: Iterable[tuple[str, object]] = ((f"record {i + 1}", r) for i, r in enumerate(raw))
    else:
        records = (
            (f"line {i + 1}", line) for i, line in enumerate(text.splitlines()) if line.strip()
        )
    seen: set[str] = set()
    for where, rec in records:
        try:
            obj = json.loads(rec) if isinstance(rec, str) else rec
            incident = HistoricalIncident.model_validate(obj)
        except (json.JSONDecodeError, ValidationError) as exc:
            raise IncidentDataError(f"{p.name} {where}: {exc}") from exc
        if incident.incident_id in seen:
            raise IncidentDataError(
                f"{p.name} {where}: duplicate incident_id {incident.incident_id!r}"
            )
        seen.add(incident.incident_id)
        incidents.append(incident)
    return incidents


def write_incidents(path: str | Path, incidents: Iterable[HistoricalIncident]) -> int:
    """Write incidents as JSON Lines; returns the number written."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with p.open("w", encoding="utf-8") as fh:
        for inc in incidents:
            fh.write(inc.model_dump_json() + "\n")
            n += 1
    return n
