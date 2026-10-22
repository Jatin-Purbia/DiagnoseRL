"""Concurrent requests must never corrupt a session."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from conftest import build_app
from diagnoserl.api import orm

API = "/api/v1"


def test_concurrent_identical_test_requests_apply_exactly_once(tmp_path):
    db_url = f"sqlite:///{(tmp_path / 'c.db').as_posix()}"
    with TestClient(build_app(tmp_path, database_url=db_url)) as c:
        sid = c.post(f"{API}/sessions", json={"scenario": "small", "seed": 4}).json()["id"]

        def hit(_: int) -> tuple[int, bool | None]:
            r = c.post(
                f"{API}/sessions/{sid}/tests", json={"test_id": "db_probe", "expected_step": 0}
            )
            return r.status_code, r.json().get("replayed")

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(hit, range(8)))

        # never a server error; at most one request applied the step, the rest replay or conflict
        assert all(code in (200, 409) for code, _ in results), results
        applied = [r for r in results if r == (200, False)]
        assert len(applied) == 1, results
        session = c.get(f"{API}/sessions/{sid}").json()
        assert session["steps"] == 1
        with c.app.state.session_factory() as db:
            n = db.execute(
                select(func.count())
                .select_from(orm.ExecutedTest)
                .where(orm.ExecutedTest.session_id == uuid.UUID(sid))
            ).scalar_one()
        assert n == 1


def test_concurrent_different_declarations_yield_one_winner(tmp_path):
    db_url = f"sqlite:///{(tmp_path / 'd.db').as_posix()}"
    with TestClient(build_app(tmp_path, database_url=db_url)) as c:
        sid = c.post(f"{API}/sessions", json={"scenario": "small", "seed": 5}).json()["id"]
        faults = ["db_down", "cpu_high", "disk_full", "bad_deploy"]

        def hit(fault: str) -> tuple[int, str]:
            r = c.post(f"{API}/sessions/{sid}/declare", json={"fault_id": fault})
            return r.status_code, fault

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(hit, faults))

        assert all(code in (200, 409) for code, _ in results), results
        winners = [f for code, f in results if code == 200]
        assert len(winners) == 1, results
        with c.app.state.session_factory() as db:
            decl = db.execute(
                select(orm.FaultDeclaration).where(
                    orm.FaultDeclaration.session_id == uuid.UUID(sid)
                )
            ).scalar_one()
        assert decl.fault_id == winners[0]
