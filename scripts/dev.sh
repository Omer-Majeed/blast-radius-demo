#!/usr/bin/env bash
# Run backend + frontend in parallel with prefixed logs.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT"
npx concurrently \
  --names "backend,frontend" \
  --prefix "[{name}]" \
  --prefix-colors "cyan,magenta" \
  "npm run dev:backend" \
  "npm run dev:frontend"
