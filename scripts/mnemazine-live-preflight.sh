#!/usr/bin/env bash
set -euo pipefail

ROOT="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

fail=0

ok() { printf 'ok %s\n' "$*"; }
warn() { printf 'warn %s\n' "$*" >&2; }
bad() { printf 'fail %s\n' "$*" >&2; fail=1; }

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then ok "$1 found"; else bad "$1 missing"; fi
}

active_count() {
  local dir="$1"
  find "$dir" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l | tr -d ' '
}

need_cmd git
need_cmd node
need_cmd npm

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$node_major" -ge 20 ]; then ok "node >=20"; else bad "node >=20 required"; fi
fi

if [ ! -f package-lock.json ]; then
  bad "package-lock.json missing; npm audit/ci are not reproducible"
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ -n "$dirty" ]; then
    if [ "${MNEMAZINE_PREFLIGHT_ALLOW_DIRTY:-0}" = "1" ]; then
      warn "tracked git changes present, allowed by MNEMAZINE_PREFLIGHT_ALLOW_DIRTY=1"
    else
      bad "tracked git changes present; commit or stash before live run"
      printf '%s\n' "$dirty" >&2
    fi
  else
    ok "tracked git tree clean"
  fi

  if [ "${MNEMAZINE_PREFLIGHT_SKIP_REMOTE:-0}" != "1" ] && git remote get-url origin >/dev/null 2>&1; then
    if git fetch origin main >/dev/null 2>&1; then
      head="$(git rev-parse HEAD)"
      remote="$(git rev-parse origin/main)"
      if [ "$head" = "$remote" ]; then ok "HEAD matches origin/main"; else bad "HEAD differs from origin/main"; fi
    else
      bad "could not fetch origin/main"
    fi
  fi
fi

npm run audit:local
npm run protocol:desktop:dry-run

env_inbox="${MNEMAZINE_INBOX:-}"
[ -f "$ROOT/.mnemazine/config.local.sh" ] && . "$ROOT/.mnemazine/config.local.sh"
base_inbox="${env_inbox:-${MNEMAZINE_INBOX:-$HOME/Desktop/Mnemazine Inbox}}"
nested_inbox="$base_inbox/mnemazine-inbox"
base_count="$(active_count "$base_inbox")"
nested_count=0
[ -d "$nested_inbox" ] && nested_count="$(active_count "$nested_inbox")"
total_count=$((base_count + nested_count))

printf 'live inbox: %s (%s files)\n' "$base_inbox" "$base_count"
[ "$nested_count" -gt 0 ] && printf 'nested legacy inbox: %s (%s files)\n' "$nested_inbox" "$nested_count"

if [ "$total_count" -eq 0 ] && [ "${MNEMAZINE_PREFLIGHT_ALLOW_EMPTY:-0}" != "1" ]; then
  bad "no active inbox files; add files before live run"
fi

if [ "$fail" -ne 0 ]; then
  echo "live preflight failed" >&2
  exit 1
fi

echo "live preflight passed"
echo "next: npm start"
