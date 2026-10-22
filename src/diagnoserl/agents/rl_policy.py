"""Adapter that runs a trained MaskablePPO model through the common Policy interface."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from sb3_contrib import MaskablePPO

from diagnoserl.baselines.base import Policy
from diagnoserl.env import PublicState


class RLPolicy(Policy):
    """Greedy (deterministic) execution of a MaskablePPO policy with action masking.

    Illegal actions are masked at inference, so the policy can never select a
    test that was already run or whose prerequisites are unmet.
    """

    def __init__(self, model: MaskablePPO, name: str = "maskable_ppo") -> None:
        self.model = model
        self.name = name

    @classmethod
    def load(cls, path: str | Path, name: str = "maskable_ppo", device: str = "cpu") -> RLPolicy:
        """Load a checkpoint. SB3 checkpoints are pickle-based: only load trusted files."""
        return cls(MaskablePPO.load(str(path), device=device), name=name)

    def act(self, state: PublicState, observation: np.ndarray) -> int:
        action, _ = self.model.predict(observation, action_masks=state.mask, deterministic=True)
        return int(action)

    def action_probabilities(self, state: PublicState, observation: np.ndarray) -> np.ndarray:
        """Masked action distribution of the policy network.

        These are the policy's *action preferences*, not calibrated probabilities
        that the corresponding diagnosis is correct.
        """
        policy = self.model.policy
        obs_tensor, _ = policy.obs_to_tensor(observation)
        dist = policy.get_distribution(obs_tensor, action_masks=state.mask[None, :])
        probs = dist.distribution.probs[0]  # type: ignore[union-attr]
        return np.asarray(probs.detach().cpu().numpy())

    def explain(self, state: PublicState) -> dict[str, Any]:
        # Explanations need the observation vector; use action_probabilities() directly.
        return {"method": "policy_network_action_distribution"}
