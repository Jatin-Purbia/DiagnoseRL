# DiagnoseRL

DiagnoseRL uses reinforcement learning to identify software faults by selecting
diagnostic tests and deciding when to declare a root cause. The agent is trained
in a simulated application and learns to balance diagnosis accuracy against the
time and cost of running tests.

Its troubleshooting efficiency is evaluated against fixed-order, random, and
information-gain strategies.

## Overview

At each step, the agent observes the current diagnostic state and chooses
whether to:

1. Run an available diagnostic test.
2. Continue investigating.
3. Declare a root cause.

The environment rewards correct diagnoses while penalizing unnecessary test
execution, elapsed troubleshooting time, and testing cost. This encourages the
agent to find accurate explanations efficiently rather than simply running
every test.

## Strategies

DiagnoseRL compares the learned policy with several baseline strategies:

- **Fixed-order**: runs tests in a predetermined order.
- **Random**: selects an available test at random.
- **Information gain**: prioritizes the test expected to reduce uncertainty
  about the root cause.
- **Reinforcement learning**: learns a policy from simulated troubleshooting
  episodes and the resulting accuracy/cost trade-off.

## Evaluation

Useful evaluation metrics include:

- Root-cause identification accuracy.
- Number of tests executed.
- Diagnostic time.
- Testing cost.
- Episodes in which no root cause is identified.
- A combined efficiency or reward score.

Comparing these metrics across policies shows whether the learned agent can
reduce troubleshooting effort while maintaining or improving diagnostic
accuracy.

## Project structure

The repository can be organized around the following components:

```text
DiagnoseRL/
├── environment/      # Simulated application and diagnostic state
├── agents/           # Reinforcement-learning policies
├── baselines/        # Fixed-order, random, and information-gain policies
├── training/         # Training loops and experiment configuration
├── evaluation/       # Metrics, comparisons, and result generation
├── tests/             # Unit and integration tests
└── README.md
```

## Getting started

This project is under active development. Once the training entry point is
available, a typical local workflow will be:

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

Run training, baseline evaluation, and result generation using the commands
provided by the corresponding modules or experiment scripts.

## Reproducibility

For comparable experiments, record the random seed, environment configuration,
available diagnostic tests, reward weights, training steps, and evaluation
episodes. Generated model checkpoints, datasets, logs, and experiment outputs
are intentionally excluded from version control; see
[`.gitignore`](.gitignore) for the complete list.

## License

No license has been specified yet.
