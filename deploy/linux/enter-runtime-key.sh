#!/usr/bin/env bash
# Run over trusted SSH with -tt. The runtime key is never echoed or logged.
set -euo pipefail
[[ -t 0 ]] || { echo "Interactive terminal required" >&2; exit 1; }
directory="$HOME/.config/skill-bridge-mcp"
mkdir -p "$directory"
chmod 700 "$directory"
original_tty="$(stty -g)"
trap 'stty "$original_tty"' EXIT
printf 'Paste your Skill Bridge runtime key, then Enter: ' >&2
stty -echo
IFS= read -r key
stty "$original_tty"
printf '\n' >&2
[[ -n "$key" ]] || { echo 'Empty key; nothing saved.' >&2; exit 1; }
umask 077
printf '%s' "$key" > "$directory/runtime-key"
unset key
chmod 600 "$directory/runtime-key"
trap - EXIT
echo 'Runtime key stored privately on this VPS.'
