# Evaluation protocol

```bash
python -m diagnoserl.evaluation.run \
    --runs artifacts/runs/full_seed0 artifacts/runs/full_seed1 artifacts/runs/full_seed2 \
    --out artifacts/eval/standard
```

Outputs `results.json`, `report.md` and `figures/*.png`, all generated from recorded data. The results
obtained with this protocol, and the answers to the research questions, are in [results.md](results.md).
Stopping behaviour: `python -m diagnoserl.evaluation.stopping --runs ... --results .../results.json --out ...`.

## Fairness rules

1. **Disjoint seeds.** Train, validation and test incidents use different seeds.
2. **Paired incidents.** All policies are scored on the identical test incidents, and each incident
   fixes every test's potential outcome (see `docs/environment.md`).
3. **Baselines are tuned like the agent**: fixed-order `k`, random stop probability and
   information-gain threshold are chosen on the *validation* incidents, then reported on the test set.
4. **Randomised policies** run several independent trials; per-incident reward is averaged so it
   stays paired.
5. **RL**: reported per training seed and as mean ± std over seeds. Model selection (`best_model`)
   uses validation reward only.
6. **Uncertainty.** Mean reward per policy has a 95% bootstrap CI over incidents. RL-vs-baseline
   differences use a *paired* bootstrap over incidents (RL reward averaged over seeds). A difference
   is called significant only if its CI excludes zero. This accounts for incident sampling noise;
   seed-to-seed variation is shown separately as the std over seeds.
7. Truncated episodes count as failures (`accuracy` is correct / all episodes).

## Metrics

Accuracy; incorrect-declaration rate; no-diagnosis rate; mean tests; mean cost; mean / median / p90 /
p95 duration; mean reward; per-fault precision and recall; confusion matrix (last column = no
diagnosis).

## Policies

| name | description |
|---|---|
| `fixed_order` | runbook order, stop after `k` tests, declare max-posterior fault |
| `random` | stop with probability `p` each step, otherwise random legal test |
| `info_gain` | greedy IG per weighted cost, stop at a confidence threshold |
| `cost_aware_bayes` | expected-utility lookahead (depth 1 or 2) |
| `exact_dp` | optimal policy (small scenarios only) |
| `ppo` | MaskablePPO |

## Robustness experiments

`diagnoserl.evaluation.robustness`: the *nominally trained* agent is deployed (not retrained) under
noisier tests (`with_noise`), different wrong-diagnosis penalties, higher test costs and shifted
fault priors (informed: beliefs use the new prior; misspecified: incidents come from the new prior
while beliefs keep the old one). Baselines are rebuilt for the shifted model with their nominal tuned
parameters. These measure how well a policy transfers, not what an agent retrained per condition
could achieve.

A fixed-size network does not generalise to a different number of faults or tests without
architectural changes or retraining.

## Ablations

Train with `include_posterior: false` to remove the Bayesian posterior from the observation, then run
the same evaluation on those runs with `--out` pointing elsewhere.
