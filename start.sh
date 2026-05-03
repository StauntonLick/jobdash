#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required but not found in PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but not found in PATH. Install Node.js 20+ first."
  exit 1
fi

echo "Setting up Python environment..."
bash "$REPO_ROOT/scripts/setup-python.sh"

echo "Installing dashboard dependencies..."
cd "$REPO_ROOT/dashboard"
npm install

echo "Starting JobDash development server..."
exec npm run dev
