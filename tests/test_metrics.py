from __future__ import annotations

import numpy as np
import pytest

from diagnoserl.evaluation import NO_DIAGNOSIS, EpisodeRecord, summarize
from diagnoserl.evaluation.metrics import confusion_matrix, per_fault_precision_recall


def _rec(true, declared, *, tests=2, cost=3.0, elapsed=10.0, reward=1.0, truncated=False):
    return EpisodeRecord(
        incident_id=0,
        true_fault=true,
        declared_fault=declared,
        correct=(true == declared),
        truncated=truncated,
        n_tests=tests,
        cost=cost,
        elapsed=elapsed,
        reward=reward,
    )


def test_confusion_matrix_and_precision_recall():
    # true:     0  0  1  1  1
    # declared: 0  1  1  1  none
    records = [
        _rec(0, 0),
        _rec(0, 1),
        _rec(1, 1),
        _rec(1, 1),
        _rec(1, NO_DIAGNOSIS, truncated=True),
    ]
    cm = confusion_matrix(records, 2)
    assert cm.tolist() == [[1, 1, 0], [0, 2, 1]]
    precision, recall = per_fault_precision_recall(cm)
    np.testing.assert_allclose(precision, [1.0, 2 / 3])
    np.testing.assert_allclose(recall, [0.5, 2 / 3])


def test_precision_undefined_when_never_declared():
    cm = confusion_matrix([_rec(0, 0), _rec(1, 0)], 2)
    precision, recall = per_fault_precision_recall(cm)
    assert np.isnan(precision[1])
    assert recall[1] == 0.0


def test_summarize_headline_metrics(tiny_model):
    records = [
        _rec(0, 0, tests=1, cost=1, elapsed=2, reward=9.0),
        _rec(0, 1, tests=2, cost=4, elapsed=8, reward=-11.0),
        _rec(1, 1, tests=0, cost=0, elapsed=0, reward=10.0),
        _rec(1, NO_DIAGNOSIS, tests=2, cost=4, elapsed=8, reward=-15.0, truncated=True),
    ]
    s = summarize(records, tiny_model)
    assert s["n_episodes"] == 4
    assert s["accuracy"] == pytest.approx(0.5)
    assert s["incorrect_rate"] == pytest.approx(0.25)
    assert s["no_diagnosis_rate"] == pytest.approx(0.25)
    assert s["mean_tests"] == pytest.approx(1.25)
    assert s["mean_cost"] == pytest.approx(2.25)
    assert s["mean_duration"] == pytest.approx(4.5)
    assert s["median_duration"] == pytest.approx(5.0)
    assert s["mean_reward"] == pytest.approx(-1.75)
    assert s["per_fault"]["a"]["recall"] == pytest.approx(0.5)
    assert s["confusion_matrix"] == [[1, 1, 0], [0, 1, 1]]


def test_summarize_rejects_empty(tiny_model):
    with pytest.raises(ValueError):
        summarize([], tiny_model)
