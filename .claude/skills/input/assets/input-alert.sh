#!/usr/bin/env bash
# input-alert.sh — the full "INPUT!" effect for humans, run in your own terminal.
# Prints the Number 5 banner, a tiny boot animation, and a best-effort voice
# alert. Everything degrades to silence if a tool isn't there — safe anywhere.
#
#   bash .claude/skills/input/assets/input-alert.sh
#
# Optional: source it in your shell as a shortcut, e.g. alias input='bash …/input-alert.sh'
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
art="$here/johnny5.txt"

# Boot flicker — three quick frames, then the banner. Skipped if not a TTY.
if [ -t 1 ]; then
  for f in ". . .   i n p u t" ".  .  .  I N P U T" "> > >  INPUT!"; do
    printf "\r      %s        " "$f"; sleep 0.18
  done
  printf "\r\033[K"
fi

[ -f "$art" ] && cat "$art" || echo "INPUT!  (Number 5 is alive)"

# Voice alert — first tool that exists wins; silent if none.
say_it() {
  local phrase="$1"
  if   command -v say      >/dev/null 2>&1; then say "$phrase" &            # macOS
  elif command -v spd-say  >/dev/null 2>&1; then spd-say "$phrase" &        # Linux (speech-dispatcher)
  elif command -v espeak   >/dev/null 2>&1; then espeak "$phrase" >/dev/null 2>&1 &
  fi
}
say_it "Input! Need more input!"

# Terminal bell as a last-resort acknowledgement.
printf '\a'
wait 2>/dev/null || true
