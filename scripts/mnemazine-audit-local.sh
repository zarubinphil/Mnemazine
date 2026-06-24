#!/usr/bin/env bash
set -euo pipefail

ROOT="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

while IFS= read -r -d '' file; do bash -n "$file"; done < <(find . -maxdepth 2 -type f \( -name '*.sh' -o -name 'install.sh' -o -name 'setup.sh' \) -not -path './node_modules/*' -print0)
while IFS= read -r -d '' file; do node --check "$file"; done < <(find scripts tests -type f -name '*.mjs' -print0)

npm run selftest:security
npm audit --audit-level=moderate
npm run public-check

if rg -n --glob '!node_modules/**' --glob '!.git/**' --glob '!.mnemazine/**' --glob '!scripts/mnemazine-audit-local.sh' 'StrictHostKeyChecking=(no|accept-new)|root@[a-z0-9][A-Za-z0-9._-]*|(^|[^A-Za-z0-9_])--dangerously-skip-permissions([^A-Za-z0-9_]|$)|https?://[^/[:space:]'\''"]+@' .; then
  echo "audit:local failed: dangerous flag or credential URL pattern found." >&2
  exit 1
fi

if rg -n "fetch\\([^\\n]*(169\\.254\\.169\\.254|metadata\\.google|metadata\\.azure)" scripts webapp; then
  echo "audit:local failed: metadata/private fetch pattern found." >&2
  exit 1
fi

echo "audit:local passed"
