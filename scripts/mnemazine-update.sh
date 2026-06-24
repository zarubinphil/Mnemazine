#!/usr/bin/env bash
set -euo pipefail

ROOT="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

git pull --ff-only
MNEMAZINE_FROM_SETUP=1 MNEMAZINE_SKIP_DEPS=1 bash install.sh

bash -n bin/mnemazine install.sh setup.sh scripts/mnemazine-desktop-protocol.sh scripts/mnemazine-telegram-sync.sh scripts/mnemazine-update.sh
node --check scripts/mnemazine-run.mjs
node --check scripts/mnemazine-complete-check.mjs
node --check scripts/mnemazine-synthesize.mjs
node --check scripts/mnemazine-verify.mjs
npm run selftest:security
npm run audit:security

echo "Mnemazine updated."
echo "Run from chat: Mnemazine"
echo "Run from terminal: mnemazine"
