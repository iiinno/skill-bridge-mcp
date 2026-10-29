#!/usr/bin/env bash
set -euo pipefail
project="${SKILL_BRIDGE_PROJECT_DIR:-$HOME/services/skill-bridge-mcp}"
[[ -f "$project/server.mjs" ]] || { echo "Project not found: $project" >&2; exit 1; }
[[ -x "$project/bin/tunnel-client" ]] || { echo "Install tunnel-client into $project/bin first" >&2; exit 1; }
[[ -f "$HOME/.config/skill-bridge-mcp/profiles/skill-bridge.yaml" ]] || { echo 'Create the dedicated tunnel profile first' >&2; exit 1; }
[[ -f "$HOME/.config/skill-bridge-mcp/runtime-key" ]] || { echo 'Securely provision the runtime key first' >&2; exit 1; }
install -d -m 700 "$HOME/.config/skill-bridge-mcp/profiles" "$HOME/.local/state/skill-bridge-mcp"
install -d -m 755 "$HOME/.config/systemd/user"
install -m 644 "$project/deploy/systemd/skill-bridge-mcp.service" "$HOME/.config/systemd/user/"
install -m 644 "$project/deploy/systemd/skill-bridge-tunnel.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now skill-bridge-mcp.service
systemctl --user enable --now skill-bridge-tunnel.service
printf 'MCP: '; systemctl --user is-active skill-bridge-mcp.service
printf 'Tunnel: '; systemctl --user is-active skill-bridge-tunnel.service
echo 'Inspect health: curl http://127.0.0.1:18787/health'
