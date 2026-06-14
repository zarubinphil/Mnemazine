#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

if rg -n '/Users/fil|72\.56|root@|Полезные знания|_ВХОДЯЩИЕ|TODOCUPS|ПКК|legal-practice|Adventure Book|AthenaOS|Филипп' "$ROOT" -g '!node_modules/**' -g '!.git/**' -g '!scripts/check-public-release.sh'; then
  echo "Public release check failed: private marker found." >&2
  exit 1
fi

if rg -n 'gho_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+' "$ROOT" -g '!node_modules/**' -g '!.git/**' -g '!scripts/check-public-release.sh'; then
  echo "Public release check failed: token-like value found." >&2
  exit 1
fi

echo "Public release check passed."
