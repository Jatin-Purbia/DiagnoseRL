# Limitations

* **Simulation only.** Fault/test probabilities are hand-authored. Performance on the simulator is
  **not** evidence of real-world performance, and nothing here has been validated on live systems.
* **Conditional independence.** Test outcomes are independent given the fault. Real diagnostics are
  correlated (e.g. a network partition affects several probes jointly), which would invalidate the
  naive-Bayes posterior. Correlated evidence needs a joint observation model.
* **Single root cause** per episode; no concurrent or cascading faults.
* **Categorical outcomes** (PASS/FAIL/DEGRADED); no continuous metrics.
* **Fixed-size policy network.** A trained agent is tied to its scenario's number of faults and
  tests. Retraining (or a set-based architecture) is required for different catalogues.
* **Limited tuning and seeds.** RL hyper-parameters were tuned lightly on one seed. Results come from
  a small number of training seeds, so seed variance is reported rather than hidden.
* **Exact solver scales exponentially** in the number of tests; it is a validation tool for small
  scenarios only.
* **Policy explanations.** Information-gain and cost-aware-Bayes explanations come from the policy's
  own computation. For PPO only the masked action distribution is available; those are action
  preferences, not calibrated probabilities that a diagnosis is correct.
* **Security.** SB3 checkpoints are pickle-based and must only be loaded from trusted sources.
