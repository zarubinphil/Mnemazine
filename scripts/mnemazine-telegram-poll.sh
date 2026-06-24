#!/usr/bin/env bash
# Runs every ~5 min via launchd. Decides whether to run the Mnemazine protocol:
#   - manual: mini app touched .run-now on the VPS (consumed atomically here)
#   - daily:  first eligible tick at/after 09:00 local that hasn't run today
# Reverse channel VPS->Mac without a public Mac: Mac polls a flag the VPS sets.
set -euo pipefail

REPO="${MNEMAZINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# Live host/key/paths live in a gitignored config, never hardcoded here.
[ -f "$REPO/.mnemazine/config.env" ] && . "$REPO/.mnemazine/config.env"
# Non-secret personal overrides (e.g. MNEMAZINE_INBOX), gitignored.
[ -f "$REPO/.mnemazine/config.local.sh" ] && . "$REPO/.mnemazine/config.local.sh"
VPS="${MNEMAZINE_VPS:-deploy@YOUR_VPS_HOST}"
KEY="${MNEMAZINE_VPS_KEY:-$HOME/.ssh/id_rsa}"
REMOTE_INBOX="${MNEMAZINE_REMOTE_INBOX:-mnemazine/inbox}"
REMOTE_REPORTS="${MNEMAZINE_REMOTE_REPORTS:-mnemazine/reports}"
SSH_BIN="${MNEMAZINE_SSH_BIN:-ssh}"
SYNC_BIN="${MNEMAZINE_TELEGRAM_SYNC_BIN:-$REPO/scripts/mnemazine-telegram-sync.sh}"

# ponytail: fail fast if still on the placeholder — beats a confusing ssh error.
if [ "$VPS" = "deploy@YOUR_VPS_HOST" ]; then
  echo "Set MNEMAZINE_VPS (and MNEMAZINE_VPS_KEY) in $REPO/.mnemazine/config.env" >&2
  exit 1
fi
if [ "${MNEMAZINE_REMOTE_MUTATION:-0}" != "1" ]; then
  echo "Set MNEMAZINE_REMOTE_MUTATION=1 after reviewing VPS paths; poll mutates remote flags/reports." >&2
  exit 1
fi
ATTEMPT_MARKER="$REPO/.mnemazine/.last-daily-attempt"
COMPLETED_MARKER="$REPO/.mnemazine/.last-daily-completed"
MAX_DAILY_ATTEMPTS="${MNEMAZINE_DAILY_MAX_ATTEMPTS:-3}"
DAILY_RETRY_SECONDS="${MNEMAZINE_DAILY_RETRY_SECONDS:-3600}"
mkdir -p "$REPO/.mnemazine"
KNOWN_HOSTS="${MNEMAZINE_SSH_KNOWN_HOSTS:-$REPO/.mnemazine/known_hosts}"
touch "$KNOWN_HOSTS"
HOST="${VPS#*@}"
if ! ssh-keygen -F "$HOST" -f "$KNOWN_HOSTS" >/dev/null 2>&1; then
  echo "VPS host key is not pinned. Run: MNEMAZINE_VPS=$VPS MNEMAZINE_VPS_HOST_FINGERPRINT=SHA256:... bash $REPO/scripts/mnemazine-pin-vps-host.sh" >&2
  exit 1
fi
SSH="$SSH_BIN -i $KEY -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes -o ConnectTimeout=10"

# Single-flight lock. macOS has no flock, so use an atomic mkdir lock dir.
# Steal a stale lock (>60 min) left by a killed run.
LOCK="$REPO/.mnemazine/poll.lock"
[ -d "$LOCK" ] && find "$LOCK" -maxdepth 0 -mmin +60 -exec rmdir {} \; 2>/dev/null
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi   # previous tick still running
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# Search queue (vault is Mac-only, so searches run here). Drain atomically:
# cat + truncate in one ssh. Each line is a JSON {topic}; parse safely in node.
queue="$($SSH "$VPS" "f=$REMOTE_INBOX/.search-queue; if [ -f \"\$f\" ]; then cat \"\$f\"; : > \"\$f\"; fi" 2>/dev/null || true)"
if [ -n "$queue" ]; then
  topics="$(printf '%s' "$queue" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const l of d.split("\n")){if(!l.trim())continue;try{const t=JSON.parse(l).topic;if(t)process.stdout.write(t.replace(/\n/g," ")+"\n")}catch{}}})' 2>/dev/null || true)"
  cd "$REPO"
  while IFS= read -r topic; do
    [ -z "$topic" ] && continue
    MNEMAZINE_DEEP=1 npm run --silent search -- --topic "$topic" || echo "search failed: $topic" >&2
  done <<< "$topics"
  # Push reports back so the mini app can read them (reverse channel Mac->VPS).
  [ -d "$REPO/reports" ] && rsync -az -e "$SSH" "$REPO/reports/" "$VPS:$REMOTE_REPORTS/" 2>/dev/null || true
fi

run=0; manual=0; daily=0
# Consume run-now flag atomically: print + delete in one ssh.
flag="$($SSH "$VPS" "f=$REMOTE_INBOX/.run-now; if [ -f \"\$f\" ]; then cat \"\$f\"; rm -f \"\$f\"; fi" 2>/dev/null || true)"
[ -n "$flag" ] && { run=1; manual=1; }

today="${MNEMAZINE_POLL_TODAY:-$(date +%F)}"
hour="${MNEMAZINE_POLL_HOUR:-$(date +%H)}"
now_epoch="${MNEMAZINE_POLL_EPOCH:-$(date +%s)}"
if [ "$(cat "$COMPLETED_MARKER" 2>/dev/null || true)" != "$today" ] && [ "$hour" -ge 9 ]; then
  read -r attempt_day attempt_count attempt_epoch < "$ATTEMPT_MARKER" 2>/dev/null || true
  if [ "${attempt_day:-}" != "$today" ]; then
    attempt_count=0
    attempt_epoch=0
  fi
  retry_wait=$((now_epoch - ${attempt_epoch:-0}))
  if [ "${attempt_count:-0}" -lt "$MAX_DAILY_ATTEMPTS" ] && { [ "${attempt_count:-0}" -eq 0 ] || [ "$retry_wait" -ge "$DAILY_RETRY_SECONDS" ]; }; then
    run=1
    daily=1
    attempt_count=$((attempt_count + 1))
    printf '%s %s %s\n' "$today" "$attempt_count" "$now_epoch" > "$ATTEMPT_MARKER"
  fi
fi

[ "$run" -eq 0 ] && exit 0

if bash "$SYNC_BIN"; then
  $SSH "$VPS" "echo $(date -u +%FT%TZ) > $REMOTE_INBOX/.last-run" 2>/dev/null || true
  [ "$daily" = "1" ] && echo "$today" > "$COMPLETED_MARKER"
else
  # A manual run-now we already consumed shouldn't vanish on failure — re-queue it.
  [ "$manual" = "1" ] && $SSH "$VPS" "echo retry > $REMOTE_INBOX/.run-now" 2>/dev/null || true
  exit 1
fi
