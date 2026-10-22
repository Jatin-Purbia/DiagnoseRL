# Training

Agents are trained with `sb3_contrib.MaskablePPO` (action masking at training and inference).

## Commands

```bash
# fast smoke run (small scenario, ~15 s): checks the pipeline, NOT a benchmark
python -m diagnoserl.training.train --config configs/smoke.yaml

# full run on the standard scenario (about an hour per seed on a laptop CPU)
python -m diagnoserl.training.train --config configs/full.yaml --seed 0 --run-name full_seed0
python -m diagnoserl.training.train --config configs/full.yaml --seed 1 --run-name full_seed1
python -m diagnoserl.training.train --config configs/full.yaml --seed 2 --run-name full_seed2

# options: --seed, --timesteps, --run-name, --mlflow
```

Each run writes `artifacts/runs/<run_name>/` (git-ignored):

| file | content |
|---|---|
| `config.json` | the exact validated config (reproducibility) |
| `metrics.jsonl` | validation metrics at each evaluation point |
| `best_model.zip` | checkpoint with the best *validation* reward |
| `final_model.zip` | last checkpoint |
| `checkpoints/` | periodic checkpoints |
| `summary.json` | run summary and SHA-256 of the saved models |
| `tensorboard/` | TensorBoard logs (`tensorboard --logdir artifacts/runs`) |

MLflow (`mlflow: true`) logs parameters and validation metrics to
`sqlite:///artifacts/mlflow.db` (`mlflow ui --backend-store-uri sqlite:///artifacts/mlflow.db`).

## Splits and seeds

* **Training**: episodes sampled from the stream seeded by `seed`.
* **Validation**: fixed incidents from `val_seed`; used for checkpoint selection and for choosing
  hyper-parameters.
* **Test**: incidents from `test_seed`; used only by `diagnoserl.evaluation.run`.

`seed`, `val_seed` and `test_seed` must all differ (validated). Training the same config with the
same seed on CPU gives identical results (tested).

## Hyper-parameters

See `configs/full.yaml`. Notes from tuning (validation set only, one seed):

* The Stable-Baselines3 default entropy coefficient (0.01) collapsed to "run one test, then
  declare" (validation reward about -5.7 at 200k steps).
* Raising `ent_coef` to 0.05 with `learning_rate = 5e-4` escaped this and kept improving, so these
  are the shipped defaults. Tuning was limited, so the RL numbers are not an upper bound.

## Device

`device: auto` selects CUDA when available, otherwise CPU. Tiny MLP policies usually run faster on
CPU.

## Loading checkpoints

SB3 checkpoints are pickle-based. Only load files you produced or trust. The model registry (backend
phase) validates paths and hashes before loading.

## Platform note

`torch 2.14.1` failed to initialise on a machine whose Python came from Anaconda (an old
`msvcp140.dll` shadows the system runtime, WinError 1114). `torch 2.8.0` (the oldest version
stable-baselines3 2.9 accepts) works, so `requirements.txt` pins it.
