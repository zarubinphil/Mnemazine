#!/usr/bin/env bash
set -euo pipefail

ROOT="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

git pull --ff-only
MNEMAZINE_FROM_SETUP=1 MNEMAZINE_SKIP_DEPS=1 bash install.sh

npm run audit:local

echo "Mnemazine updated."
echo "Preflight before live run: npm run preflight:live"
echo "Run from chat: Mnemazine"
echo "Run from terminal: mnemazine"
