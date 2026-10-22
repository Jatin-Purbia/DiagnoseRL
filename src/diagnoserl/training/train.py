"""MaskablePPO training with fixed validation incidents and checkpointing.

Usage::

    python -m diagnoserl.training.train --config configs/smoke.yaml [--seed 3]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, SupportsFloat

import gymnasium as gym
from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker
from stable_baselines3.common.callbacks import BaseCallback, CallbackList, CheckpointCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

from diagnoserl.agents.rl_policy import RLPolicy
from diagnoserl.config import DiagnosticModel
from diagnoserl.env import DiagnoseRLEnv
from diagnoserl.evaluation import evaluate_policy, summarize
from diagnoserl.incident import generate_incidents
from diagnoserl.logging_config import configure_logging
from diagnoserl.training.config import TrainConfig, load_train_config

log = logging.getLogger(__name__)


class RewardScale(gym.RewardWrapper[Any, Any]):
    """Divide rewards by a constant (training only; Monitor still logs raw rewards)."""

    def __init__(self, env: gym.Env[Any, Any], scale: float) -> None:
        super().__init__(env)
        self._scale = scale

    def reward(self, reward: SupportsFloat) -> float:
        return float(reward) / self._scale


def _action_masks(env: Any) -> Any:
    return env.unwrapped.action_masks()


def make_env(model: DiagnosticModel, cfg: TrainConfig) -> Any:
    """Training environment: monitored and exposing action masks to MaskablePPO."""
    env = DiagnoseRLEnv(
        model, cfg.reward.to_reward_config(), include_posterior=cfg.include_posterior
    )
    return ActionMasker(RewardScale(Monitor(env), cfg.reward_scale), _action_masks)


class ValidationCallback(BaseCallback):
    """Periodically evaluates on a *fixed* validation incident set.

    Uses the same evaluation harness as the baselines. Keeps the best checkpoint by
    mean validation reward. Never touches the test incident set.
    """

    def __init__(
        self, model_spec: DiagnosticModel, cfg: TrainConfig, run_dir: Path, mlflow_run: Any = None
    ) -> None:
        super().__init__()
        self.spec = model_spec
        self.cfg = cfg
        self.run_dir = run_dir
        self.mlflow = mlflow_run
        self.incidents = generate_incidents(model_spec, cfg.n_val_episodes, seed=cfg.val_seed)
        self.env = DiagnoseRLEnv(
            model_spec, cfg.reward.to_reward_config(), include_posterior=cfg.include_posterior
        )
        self.best_reward = float("-inf")
        self._next_eval = 0
        self.history: list[dict[str, Any]] = []

    def validate(self) -> dict[str, Any]:
        policy = RLPolicy(self.model)  # type: ignore[arg-type]
        records = evaluate_policy(self.env, policy, self.incidents)
        summary = summarize(records, self.spec)
        return {"timesteps": int(self.num_timesteps), **summary}

    def _record(self, summary: dict[str, Any]) -> None:
        scalars = {
            f"val/{k}": summary[k]
            for k in ("mean_reward", "accuracy", "mean_tests", "mean_cost", "no_diagnosis_rate")
        }
        for key, value in scalars.items():
            self.logger.record(key, value)
        if self.mlflow is not None:
            import mlflow

            mlflow.log_metrics(
                {k.replace("/", "_"): v for k, v in scalars.items()}, step=summary["timesteps"]
            )
        slim = {k: v for k, v in summary.items() if k not in ("confusion_matrix", "per_fault")}
        self.history.append(slim)
        with (self.run_dir / "metrics.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(slim) + "\n")

    def _evaluate_and_maybe_save(self) -> None:
        summary = self.validate()
        self._record(summary)
        if summary["mean_reward"] > self.best_reward:
            self.best_reward = summary["mean_reward"]
            self.model.save(str(self.run_dir / "best_model"))
        log.info(
            "validation",
            extra={
                "timesteps": summary["timesteps"],
                "val_reward": round(summary["mean_reward"], 3),
                "val_accuracy": round(summary["accuracy"], 3),
                "val_tests": round(summary["mean_tests"], 2),
            },
        )

    def _on_training_start(self) -> None:
        self._evaluate_and_maybe_save()  # untrained baseline point on the curve
        self._next_eval = self.cfg.eval_freq

    def _on_step(self) -> bool:
        if self.num_timesteps >= self._next_eval:
            self._evaluate_and_maybe_save()
            self._next_eval += self.cfg.eval_freq
        return True


@dataclass
class TrainResult:
    run_dir: Path
    best_model_path: Path
    final_model_path: Path
    best_val_reward: float
    final_val: dict[str, Any]
    wall_seconds: float


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def train(cfg: TrainConfig) -> TrainResult:
    """Train one MaskablePPO agent and return paths/metrics. Fully seeded."""
    start = time.time()
    spec = cfg.load_scenario()
    run_dir = Path(cfg.output_dir) / cfg.resolved_run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "metrics.jsonl").write_text("", encoding="utf-8")
    (run_dir / "config.json").write_text(cfg.model_dump_json(indent=2), encoding="utf-8")

    mlflow_run = None
    if cfg.mlflow:
        import mlflow

        mlflow.set_tracking_uri(cfg.mlflow_tracking_uri)
        mlflow.set_experiment(cfg.mlflow_experiment)
        mlflow_run = mlflow.start_run(run_name=cfg.resolved_run_name)
        mlflow.log_params(
            {
                k: v
                for k, v in cfg.model_dump().items()
                if k not in ("reward", "net_arch") and not isinstance(v, dict)
            }
            | {f"reward_{k}": v for k, v in cfg.reward.model_dump().items()}
            | {"net_arch": str(cfg.net_arch)}
        )

    try:
        vec_env = DummyVecEnv([lambda: make_env(spec, cfg) for _ in range(cfg.n_envs)])
        ppo = MaskablePPO(
            "MlpPolicy",
            vec_env,
            learning_rate=cfg.learning_rate,
            n_steps=cfg.n_steps,
            batch_size=cfg.batch_size,
            n_epochs=cfg.n_epochs,
            gamma=cfg.gamma,
            gae_lambda=cfg.gae_lambda,
            ent_coef=cfg.ent_coef,
            clip_range=cfg.clip_range,
            policy_kwargs={"net_arch": cfg.net_arch},
            tensorboard_log=str(run_dir / "tensorboard") if cfg.tensorboard else None,
            seed=cfg.seed,
            device=cfg.device,
            verbose=0,
        )
        validation = ValidationCallback(spec, cfg, run_dir, mlflow_run)
        checkpoints = CheckpointCallback(
            save_freq=max(cfg.checkpoint_freq // cfg.n_envs, 1),
            save_path=str(run_dir / "checkpoints"),
            name_prefix="ppo",
        )
        ppo.learn(
            total_timesteps=cfg.total_timesteps,
            callback=CallbackList([validation, checkpoints]),
        )

        if validation.history[-1]["timesteps"] != ppo.num_timesteps:
            validation.num_timesteps = ppo.num_timesteps
            validation._evaluate_and_maybe_save()  # final point on the curve
        final_path = run_dir / "final_model.zip"
        ppo.save(str(final_path))
        final_val = validation.history[-1]
        best_path = run_dir / "best_model.zip"

        summary = {
            "run_name": cfg.resolved_run_name,
            "seed": cfg.seed,
            "scenario": spec.name,
            "total_timesteps": int(ppo.num_timesteps),
            "best_val_reward": validation.best_reward,
            "final_val": final_val,
            "best_model_sha256": _sha256(best_path),
            "final_model_sha256": _sha256(final_path),
            "wall_seconds": round(time.time() - start, 1),
        }
        (run_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        if mlflow_run is not None:
            import mlflow

            mlflow.log_artifact(str(run_dir / "summary.json"))
            mlflow.log_artifact(str(run_dir / "config.json"))
        return TrainResult(
            run_dir=run_dir,
            best_model_path=best_path,
            final_model_path=final_path,
            best_val_reward=validation.best_reward,
            final_val=final_val,
            wall_seconds=time.time() - start,
        )
    finally:
        if mlflow_run is not None:
            import mlflow

            mlflow.end_run()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a DiagnoseRL MaskablePPO agent.")
    parser.add_argument("--config", required=True, help="path to a training YAML config")
    parser.add_argument("--seed", type=int, help="override the training seed")
    parser.add_argument("--timesteps", type=int, help="override total_timesteps")
    parser.add_argument("--run-name", help="override the run name")
    parser.add_argument("--mlflow", action="store_true", help="enable MLflow tracking")
    args = parser.parse_args()

    configure_logging()
    cfg = load_train_config(args.config)
    updates: dict[str, Any] = {}
    if args.seed is not None:
        updates["seed"] = args.seed
    if args.timesteps is not None:
        updates["total_timesteps"] = args.timesteps
    if args.run_name:
        updates["run_name"] = args.run_name
    if args.mlflow:
        updates["mlflow"] = True
    cfg = TrainConfig.model_validate({**cfg.model_dump(), **updates})
    result = train(cfg)
    print(
        json.dumps(
            {
                "run_dir": str(result.run_dir),
                "best_val_reward": result.best_val_reward,
                "final_val_accuracy": result.final_val["accuracy"],
                "wall_seconds": round(result.wall_seconds, 1),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
