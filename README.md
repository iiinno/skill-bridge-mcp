# Skill Bridge MCP

An open-source, **read-only MCP server** for discovering and loading Agent Skills stored as `SKILL.md` files. A skill can change on disk without rebuilding the server: the next MCP call sees the latest content.

This project is community-maintained and **not an official OpenAI product**.

## What it does

| MCP tool | Purpose |
| --- | --- |
| `list_skills` | Discover skill IDs, descriptions and content revisions (optional search query) |
| `search_skills` | Rank relevant skills for a task, including common Japanese/English terms |
| `load_skill` | Read a complete `SKILL.md` and its revision hash |
| `read_skill_resource` | Read text references from that skill's `references/` or `assets/` folder |
| `preview_skill_edit` | Validate and preview a version-checked proposed SKILL.md replacement, without modifying files |
| `stage_skill_edit` | If enabled, privately save the change as a draft for explicit PC-side review and application |

Skill Bridge **does not execute scripts, grant agent permissions, or dispatch jobs**. The calling agent applies the loaded skill as lower-trust workflow guidance, using only the tools it already has permission to use. Never treat server-supplied skill text as system instructions.

## Quick start

Node.js 20+ is required.

```bash
git clone https://github.com/iiinno/skill-bridge-mcp.git
cd skill-bridge-mcp
npm ci
npm test
npm start
```

Local endpoints:
- MCP: `http://127.0.0.1:8787/mcp` (Streamable HTTP)
- Health: `http://127.0.0.1:8787/health`

The bundled sample library includes `research-brief` and `code-review`. Example calls: "Use Skill Bridge to list the skills" → "Load research-brief".

### Add a skill

```text
skill-library/
  my-skill/
    SKILL.md
    references/
      guide.md
```

Required frontmatter:

```yaml
---
name: my-skill
description: Describe the workflow and when an agent should use it.
---
```

Directory names follow the [Agent Skills specification](https://agentskills.io/specification) (lowercase letters, digits, single hyphens, max 64 characters). The frontmatter name must match the directory name. Changes become visible on the next read, with no restart.

To use another library, set `SKILL_BRIDGE_SKILLS_DIR` to an absolute directory.

## Private deployment with Secure MCP Tunnel

The recommended setup runs the MCP server **only on loopback** and uses an outbound [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) to let ChatGPT access it without exposing an inbound port.

**Ubuntu VPS (systemd user services):** [docs/VPS.md](docs/VPS.md)  
**Windows (CoS-bundled tunnel-client):** [TUNNEL-SETUP.md](TUNNEL-SETUP.md)

For Skills Manager, the VPS can maintain a separate read-only private Git mirror with a dedicated SSH deploy key and five-minute systemd timer. The mirror lives outside this public repository. See [docs/SKILLS-MANAGER.md](docs/SKILLS-MANAGER.md).

**Memory and Markdown integrations:** `read_github_markdown` reads one
GitHub Markdown document and returns its source revision. A private,
opt-in `SKILL_BRIDGE_MEMORY_DIR` activates memory proposals, manual
approval and approved-note search. These features do not automatically
ingest all ChatGPT conversations or write to an existing AgentMemory DB.
See [docs/AGENT-MEMORY.md](docs/AGENT-MEMORY.md).

Create a **dedicated Tunnel ID** for Skill Bridge; do not run the same Tunnel ID on two hosts at the same time. Secure MCP Tunnel uses a runtime Platform API key; it does not require calling a paid inference API to load skills. Check Platform's own service terms separately.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SKILL_BRIDGE_HOST` | `127.0.0.1` | Listen interface |
| `SKILL_BRIDGE_PORT` | `8787` | HTTP port |
| `SKILL_BRIDGE_SKILLS_DIR` | `./skill-library` | Skill library directory |
| `SKILL_BRIDGE_TOKEN` | unset | Optional Bearer token; **required** if binding non-loopback |
| `SKILL_BRIDGE_ALLOWED_HOSTS` | unset | Additional allowed Host headers (comma-separated) |
| `SKILL_BRIDGE_ALLOWED_ORIGINS` | unset | Additional allowed Origins (comma-separated) |

If you deliberately make the MCP server externally reachable, you must implement HTTPS and a supported authentication flow such as OAuth 2.1. **An unprotected public tunnel or fixed Bearer token is not a substitute for a secure ChatGPT OAuth integration.**

## Security

- Loopback binding by default; only the files under the controlled library are available.
- Rejects symlink traversal, invalid paths, oversized text files, and unsupported resource extensions.
- Explicit Host and Origin validation helps protect local deployment from DNS rebinding.
- Never put secrets or private data inside `SKILL.md`; connected ChatGPT clients can read them.
- Only trusted administrators should be able to modify the skill-library directory.
- No code execution is implemented.
- Loading an arbitrary skill creates a **prompt-injection surface**: the agent should keep the retrieved instructions below the user and system instruction hierarchy.
- Secure MCP Tunnel exposes the skill library to the chosen ChatGPT workspace; configure the appropriate organization/workspace permissions.

## Limitations

- Maximum 2,048 skills are indexed in one call; optional limit and ranked search are supported, but pagination and separate accounts are not implemented.
- Only text references under `references/` and `assets/` are supported.
- Modifications to a skill require a fresh MCP call: they do not hot-replace model context already read.
- Actual ChatGPT registration is performed in ChatGPT's Plugins interface; nothing is silently installed in an account.

## Development

```bash
npm ci
npm test
```

License: [MIT](LICENSE). Contributions and issues are welcome.

---

日本語: 本ソフトは、サーバーに保存した Agent Skills を ChatGPT などの MCP クライアントから動的に読み取るためのOSSです。スキルそのものの実行や権限付与は行いません。常時運用は [Ubuntu VPS手順](docs/VPS.md)、Windowsでの試用は [トンネル接続手順](TUNNEL-SETUP.md) を参照してください。
