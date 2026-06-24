#!/usr/bin/env bash
# Mnemazine guided installer. Walks a fresh device through setup in clear stages.
# Questions are numbered menus (terminal "dropdown"). Each stage gates the next.
# When a capability is missing we say so plainly and move on — never silently skip.
#
# Dry run (walk stages + questions, install/deploy nothing):
#   MNEMAZINE_SETUP_DRYRUN=1 bash setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY="${MNEMAZINE_SETUP_DRYRUN:-0}"
KNOWN_HOSTS="$ROOT/.mnemazine/known_hosts"

# ---- ui helpers -------------------------------------------------------------
b() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
note() { printf '  • %s\n' "$*"; }
stage() { printf '\n\033[1m\033[36m── Этап %s ──\033[0m %s\n' "$1" "$2"; }
miss() { printf '\n  \033[33mДруг, значит %s тебе не оставим.\033[0m %s\n' "$1" "${2:-}"; }
halt() { printf '\n\033[1mУстанови вот это, потом запусти setup.sh снова — перейдём к следующему этапу.\033[0m\n'; exit 1; }

# ask_choice "Question?" "opt1" "opt2" ... -> sets REPLY_IDX (1-based) and REPLY_VAL
ask_choice() {
  local q="$1"; shift
  local opts=("$@") i
  printf '\n%s\n' "$q"
  for i in "${!opts[@]}"; do printf '  %d) %s\n' $((i+1)) "${opts[$i]}"; done
  local sel
  while true; do
    printf 'Выбери [1-%d]: ' "${#opts[@]}"
    if ! read -r sel; then
      printf '\nНет TTY (ввод закрыт). Запусти setup.sh интерактивно или используй install.sh без вопросов.\n' >&2
      exit 1
    fi
    if [[ "$sel" =~ ^[0-9]+$ ]] && [ "$sel" -ge 1 ] && [ "$sel" -le "${#opts[@]}" ]; then
      REPLY_IDX="$sel"; REPLY_VAL="${opts[$((sel-1))]}"; return 0
    fi
    no "Не понял. Введи число от 1 до ${#opts[@]}."
  done
}

ask_text() { # ask_text "prompt" [silent] -> REPLY_TXT
  local p="$1" silent="${2:-}"
  if [ "$silent" = "secret" ]; then printf '%s: ' "$p"; read -rs REPLY_TXT || { printf '\nНет TTY.\n' >&2; exit 1; }; printf '\n'
  else printf '%s: ' "$p"; read -r REPLY_TXT || { printf '\nНет TTY.\n' >&2; exit 1; }; fi
}

run() { # run a command unless dry-run
  if [ "$DRY" = "1" ]; then printf '  [dry] %s\n' "$*"; return 0; fi
  "$@"
}

sq() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

b "Mnemazine — установка по шагам."
note "Каждый этап завершается прежде чем начнётся следующий."
[ "$DRY" = "1" ] && note "DRY RUN — ничего не ставится и не деплоится."

# ---- Stage 1: base environment (hard gate) ---------------------------------
stage 1 "Базовое окружение (обязательно)"
fail=0
if command -v git >/dev/null 2>&1; then ok "git"; else no "git нет"; note "macOS: xcode-select --install · Linux: apt install git"; fail=1; fi
if command -v node >/dev/null 2>&1; then
  ver="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$ver" -ge 20 ]; then ok "node $(node -v)"; else no "node слишком старый ($(node -v)), нужен >=20"; note "https://nodejs.org или nvm install 20"; fail=1; fi
else no "node нет (нужен >=20)"; note "https://nodejs.org или: brew install node"; fail=1; fi
[ "$fail" = "1" ] && halt
ok "База готова."

# ---- Stage 2: local engines (optional, degrade gracefully) -----------------
stage 2 "Локальные движки распознавания (по желанию — экономят токены)"
have_py=0; have_ff=0; have_whisper=0; have_swift=0
command -v python3 >/dev/null 2>&1 && { ok "python3 (markitdown: PDF/DOCX/PPTX/XLSX/HTML)"; have_py=1; } || miss "разбор офис-файлов локально" "поставь python3 — иначе их распознает LLM в deep-режиме."
command -v ffmpeg  >/dev/null 2>&1 && { ok "ffmpeg (видео-кадры/аудио)"; have_ff=1; } || miss "локальную обработку видео/аудио" "brew install ffmpeg / apt install ffmpeg."
command -v whisper >/dev/null 2>&1 && { ok "whisper (транскрипт речи)"; have_whisper=1; } || miss "локальный транскрипт речи" "pip install openai-whisper — иначе только субтитры/LLM."
if [ "$(uname)" = "Darwin" ]; then
  command -v swiftc >/dev/null 2>&1 && { ok "swiftc (Apple Vision OCR картинок)"; have_swift=1; } || miss "Apple Vision OCR" "xcode-select --install — картинки распознает LLM."
else
  miss "Apple Vision OCR" "доступен только на macOS — на этом устройстве картинки распознает LLM."
fi
note "Это не блокеры. Каркас поставится и без них."

# ---- Stage 3: inbox location (required question) ---------------------------
stage 3 "Куда класть inbox?"
ask_choice "Входящие материалы будут падать сюда:" \
  "На рабочий стол — $HOME/Desktop/Mnemazine Inbox" \
  "Внутри репозитория — $ROOT/inbox"
if [ "$REPLY_IDX" = "1" ]; then INBOX="$HOME/Desktop/Mnemazine Inbox"; else INBOX="$ROOT/inbox"; fi
ok "Inbox: $INBOX"

# ---- Stage 4: LLM provider (deep mode) -------------------------------------
stage 4 "LLM-провайдер для deep-режима (атомизация/обогащение/проверка)"
has_claude=0; has_codex=0
command -v claude >/dev/null 2>&1 && has_claude=1
command -v codex  >/dev/null 2>&1 && has_codex=1
if [ "$has_claude" = "1" ] || [ "$has_codex" = "1" ]; then
  opts=(); [ "$has_claude" = "1" ] && opts+=("Claude CLI"); [ "$has_codex" = "1" ] && opts+=("Codex CLI"); opts+=("Без deep — только локальный разбор")
  ask_choice "Найдены провайдеры. Чем работать?" "${opts[@]}"
  case "$REPLY_VAL" in
    "Claude CLI") LLM=claude ;; "Codex CLI") LLM=codex ;; *) LLM="" ;;
  esac
  [ -n "$LLM" ] && ok "Провайдер: $LLM" || ok "Deep выключен (conservative, 0 токенов)."
else
  LLM=""
  miss "deep-режим (атомизация/обогащение через LLM)" "не найден ни claude, ни codex CLI. Каркас и локальный разбор работают."
fi

# ---- Stage 5: Telegram bot --------------------------------------------------
stage 5 "Telegram-бот для приёма входящих"
BOT_TOKEN=""; BOT_MODE="none"
ask_choice "Подключить Telegram-бота? (шлёшь боту — падает в inbox)" "Да" "Нет"
if [ "$REPLY_IDX" = "1" ]; then
  ask_text "Вставь токен бота от @BotFather" secret; BOT_TOKEN="$REPLY_TXT"
  if [ -z "$BOT_TOKEN" ]; then
    miss "Telegram-бота" "токен пустой — пропускаем."
  else
    ok "Токен принят (в git не пишем)."
    b "Бот должен идти через VPS (всегда-онлайн, принимает пока твоё устройство спит)."
    ask_choice "Есть VPS для бота?" "Да, есть VPS" "Нет VPS"
    if [ "$REPLY_IDX" = "1" ]; then
      ask_text "VPS (user@host)"; BOT_VPS="$REPLY_TXT"
      ask_text "Путь к SSH-ключу (Enter = ~/.ssh/id_rsa)"; BOT_KEY="${REPLY_TXT:-$HOME/.ssh/id_rsa}"
      ask_text "SSH fingerprint хоста (SHA256:..., из панели VPS или ssh-keygen -lf)"; BOT_FP="$REPLY_TXT"
      [ -z "$BOT_FP" ] && { no "fingerprint пустой — небезопасно."; halt; }
      if [ "$DRY" != "1" ]; then
        mkdir -p "$ROOT/.mnemazine"
        touch "$KNOWN_HOSTS"
        MNEMAZINE_VPS="$BOT_VPS" MNEMAZINE_VPS_KEY="$BOT_KEY" MNEMAZINE_VPS_HOST_FINGERPRINT="$BOT_FP" bash "$ROOT/scripts/mnemazine-pin-vps-host.sh"
      fi
      if [ "$DRY" != "1" ] && ! ssh -i "$BOT_KEY" -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=yes -o ConnectTimeout=10 "$BOT_VPS" 'command -v node >/dev/null && command -v pm2 >/dev/null' 2>/dev/null; then
        no "VPS недоступен или нет node+pm2."
        halt
      fi
      BOT_MODE="vps"; ok "VPS на связи (node+pm2 есть)."
    else
      miss "бота через VPS" "Без VPS постоянного приёма нет. Можешь запускать бота локально, пока устройство включено."
      BOT_MODE="manual"
    fi
  fi
else
  note "Бот пропущен."
fi

# ---- Stage 6: build the skeleton -------------------------------------------
stage 6 "Ставлю каркас Mnemazine"
ok "Запускаю install.sh (vault, папки, venv, OCR-сборка)…"
if ! MNEMAZINE_FROM_SETUP=1 MNEMAZINE_ROOT="$ROOT" MNEMAZINE_INBOX="$INBOX" run bash "$ROOT/install.sh"; then
  no "install.sh завершился с ошибкой — каркас не собран."
  halt
fi

# deploy bot if VPS path chosen
if [ "$BOT_MODE" = "vps" ]; then
  stage 6.1 "Деплой бота на VPS"
  REMOTE_ROOT="mnemazine"
  REMOTE_INBOX="$REMOTE_ROOT/inbox"
  REMOTE_BOT="$REMOTE_ROOT/bot"
  # Persist the host/key boundary so poll/sync scripts read it (never hardcoded).
  if [ "$DRY" != "1" ]; then
    mkdir -p "$ROOT/.mnemazine"
    umask 177
    cat > "$ROOT/.mnemazine/config.env" <<CFG
MNEMAZINE_VPS="$BOT_VPS"
MNEMAZINE_VPS_KEY="$BOT_KEY"
MNEMAZINE_REMOTE_INBOX="$REMOTE_INBOX"
MNEMAZINE_REMOTE_MUTATION=1
CFG
    umask 022
    ok "Записал .mnemazine/config.env (chmod 600, gitignored)."
  fi
  if [ "$DRY" = "1" ]; then
    note "[dry] scp bot → $BOT_VPS:$REMOTE_BOT/ ; pm2 start с токеном"
  else
    SSH_OPTS=(-i "$BOT_KEY" -o "UserKnownHostsFile=$KNOWN_HOSTS" -o StrictHostKeyChecking=yes)
    ssh "${SSH_OPTS[@]}" "$BOT_VPS" "mkdir -p $REMOTE_BOT $REMOTE_INBOX" || { no "Не смог создать папки на VPS."; halt; }
    ssh "${SSH_OPTS[@]}" "$BOT_VPS" "cat > $REMOTE_BOT/mnemazine-telegram-bot.mjs" < "$ROOT/scripts/mnemazine-telegram-bot.mjs" || { no "Не смог загрузить bot script на VPS."; halt; }
    {
      printf 'TELEGRAM_BOT_TOKEN=%s\n' "$(sq "$BOT_TOKEN")"
      printf 'MNEMAZINE_INBOX=%s\n' "$(sq "$REMOTE_INBOX")"
    } | ssh "${SSH_OPTS[@]}" "$BOT_VPS" "umask 177; cat > $REMOTE_BOT/.env" || { no "Не смог записать .env на VPS."; halt; }
    # Idempotent: start, or restart if the process already exists (rerun-safe).
    ssh "${SSH_OPTS[@]}" "$BOT_VPS" "cd $REMOTE_BOT && set -a && . ./.env && set +a && pm2 start mnemazine-telegram-bot.mjs --name mnemazine-bot --update-env 2>/dev/null || pm2 restart mnemazine-bot --update-env; pm2 save" || { no "Не смог запустить pm2 на VPS."; halt; }
    ok "Бот запущен на VPS (bootstrap-режим)."
    note "Напиши боту сообщение, затем на VPS: pm2 logs mnemazine-bot — увидишь свой chat_id."
    note "Закрой доступ: перезапусти с ALLOWED_CHAT_IDS=<chat_id> (см. docs/telegram-intake.md)."
  fi
elif [ "$BOT_MODE" = "manual" ]; then
  stage 6.1 "Бот локально (вручную)"
  note "Запусти когда нужно:"
  note "TELEGRAM_BOT_TOKEN=<токен> MNEMAZINE_INBOX=$INBOX node $ROOT/scripts/mnemazine-telegram-bot.mjs"
fi

# ---- Stage 7: done ----------------------------------------------------------
stage 7 "Готово"
ok "Каркас: $ROOT"
ok "Inbox: $INBOX"
[ -n "$LLM" ] && ok "Deep-провайдер: $LLM" || note "Deep выключен — включишь позже через MNEMAZINE_LLM."
note "Открой папку vault в Obsidian."
note "Открой проект: $ROOT"
note "Клади файлы: $INBOX"
note "В чате агента: Mnemazine"
note "В терминале: npm start"
note "Если ~/.local/bin есть в PATH: mnemazine"
[ "$BOT_MODE" = "vps" ] && note "Mini App + ежедневный pull: см. docs/telegram-intake.md (этапы 2-3)."
b "Всё. Пользуйся."

# Author greeting last, so it is what the user sees at the end (not buried
# mid-flow inside install.sh, which stays silent under MNEMAZINE_FROM_SETUP).
[ "$DRY" = "1" ] || bash "$ROOT/scripts/hello.sh"
