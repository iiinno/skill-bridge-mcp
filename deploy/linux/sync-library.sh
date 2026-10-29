#!/usr/bin/env bash
# Pull only a dedicated read-only checkout of the private Skills Manager backup.
# Never pushes, resets, or modifies the PC's Skills Manager repository or DB.
set -euo pipefail
library="${SKILL_BRIDGE_PRIVATE_LIB:-$HOME/services/skill-bridge-private-library}"
key="${SKILL_BRIDGE_DEPLOY_KEY:-$HOME/.ssh/skill-bridge-readonly}"
if [[ ! -d "$library/.git" || ! -r "$key" ]]; then
  echo "Missing private checkout or read-only deploy key" >&2
  exit 1
fi
if [[ -n "$(git -C "$library" status --porcelain)" ]]; then
  echo "Private checkout has local changes; refusing to overwrite" >&2
  exit 1
fi
export GIT_SSH_COMMAND="ssh -i $key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8"
git -C "$library" fetch --quiet origin main
old="$(git -C "$library" rev-parse HEAD)"
new="$(git -C "$library" rev-parse origin/main)"
if [[ "$old" == "$new" ]]; then
  echo "Skill library unchanged at ${old:0:8}"
  exit 0
fi
git -C "$library" merge --ff-only --quiet origin/main
echo "Skill library updated ${old:0:8} -> ${new:0:8}"
