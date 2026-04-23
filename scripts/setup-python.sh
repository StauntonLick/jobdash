#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PATH="${JOBDASH_VENV_PATH:-$REPO_ROOT/venv}"
BOOTSTRAP_PYTHON="${JOBDASH_BOOTSTRAP_PYTHON:-python3}"

if [[ ! -x "$VENV_PATH/bin/python" ]]; then
  echo "Creating virtual environment at: $VENV_PATH"
  "$BOOTSTRAP_PYTHON" -m venv "$VENV_PATH"
fi

"$VENV_PATH/bin/python" -m pip install --upgrade pip
"$VENV_PATH/bin/python" -m pip install -r "$REPO_ROOT/requirements.txt"

echo "Python setup complete."
echo "Interpreter: $VENV_PATH/bin/python"
