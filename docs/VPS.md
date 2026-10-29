# VPS deployment (private Secure MCP Tunnel)

Recommended topology: ChatGPT → OpenAI Secure MCP Tunnel → VPS-local tunnel-client → 127.0.0.1:18787/mcp.

No inbound port, publicly accessible domain, TLS certificate, or Tailscale Funnel is required. Tailscale SSH is for administration only. Use a dedicated Tunnel ID; **never run the same ID on Windows and Linux concurrently**.

## Requirements

- Linux (tested against Ubuntu x86_64), Node.js 20+, npm, git, systemd user services
- Outbound HTTPS internet access
- OpenAI Secure MCP Tunnel and restricted runtime key (Tunnels Read + Use)
- Enough user access to enable systemd lingering, if unattended operation after logout is required

## Installation

```sh
mkdir -p ~/services
git clone https://github.com/iiinno/skill-bridge-mcp.git ~/services/skill-bridge-mcp
cd ~/services/skill-bridge-mcp
npm ci --omit=dev
curl -fsS http://127.0.0.1:18787/health  # only after starting the service
```

Install the verified official OpenAI tunnel-client Linux release from https://github.com/openai/tunnel-client/releases into `~/services/skill-bridge-mcp/bin/` (include the bundled cloudflared companion if packaged). Verify the release's SHA256SUMS before use.

## Private runtime key

Create a dedicated OpenAI Platform tunnel and runtime API key (Tunnels Read + Use). Store the key in:

```text
~/.config/skill-bridge-mcp/runtime-key
```

The directory must be 0700 and the key file must be 0600. Never pass the secret in a CLI argument or commit it. Provision via a trusted secret manager or encrypted-to-SSH local transfer. If migrating from Windows, the DPAPI-encrypted local key is **not directly readable on Linux**; transfer via an authorized local secure helper or issue a replacement runtime key.

To enter a runtime key interactively without echoing it to the screen, use:

```sh
ssh -tt user@your-vps 'bash ~/services/skill-bridge-mcp/deploy/linux/enter-runtime-key.sh'
```

Paste the key at the hidden prompt. It is saved on the VPS with file permissions 0600.

```sh
mkdir -p ~/.config/skill-bridge-mcp/profiles ~/.local/state/skill-bridge-mcp
chmod 700 ~/.config/skill-bridge-mcp ~/.config/skill-bridge-mcp/profiles ~/.local/state/skill-bridge-mcp
```

Create the tunnel-client profile using the dedicated ID:

```sh
~/services/skill-bridge-mcp/bin/tunnel-client init \
  --sample sample_mcp_remote_no_auth \
  --profile skill-bridge \
  --profile-dir "$HOME/.config/skill-bridge-mcp/profiles" \
  --tunnel-id "tunnel_YOUR_DEDICATED_ID" \
  --mcp-server-url http://127.0.0.1:18787/mcp \
  --health-listen-addr 127.0.0.1:0 \
  --control-plane-api-key-ref "file:$HOME/.config/skill-bridge-mcp/runtime-key"
```

## Run as systemd user services

```sh
cd ~/services/skill-bridge-mcp
bash deploy/linux/install-services.sh
systemctl --user status skill-bridge-mcp
systemctl --user status skill-bridge-tunnel
curl -fsS http://127.0.0.1:18787/health
curl -fsS "$(cat ~/.local/state/skill-bridge-mcp/health.url)/readyz"
```

For unattended operation after SSH logout, enable lingering once:

```sh
sudo loginctl enable-linger "$(whoami)"
```

## Cutover and rollback

1. Confirm the VPS MCP endpoint passes local tests and has the desired skills.
2. Stop **only** the old Windows *Skill Bridge* tunnel process (not CoS or any other tunnel).
3. Start the VPS tunnel using the same dedicated ID.
4. Verify the VPS client's readyz endpoint, then invoke list_skills and load_skill from ChatGPT.
5. If remote fails, stop the VPS tunnel **first**, then restart Windows Skill Bridge. Never overlap the two tunnel clients.

Existing ChatGPT plugins pointing to that Tunnel ID may continue without URL changes, provided the remote tool contract is unchanged.

## Troubleshooting and security

```sh
journalctl --user -u skill-bridge-mcp -u skill-bridge-tunnel -n 100 --no-pager
systemctl --user restart skill-bridge-mcp
systemctl --user stop skill-bridge-tunnel
```

No inbound firewall rules are necessary. The MCP remains on 127.0.0.1 only. No Docker container is necessary, keeping CPU/memory costs low on small VPS hosts. All skills you place in the private registry are readable by users with permission to use the tunnel; do not store credentials or private records in SKILL.md. The server exposes read-only text, but an LLM may still misinterpret retrieved untrusted content as instructions—do not elevate skill text to system privileges.
