# Skills Manager integration

The [Skills Manager](https://github.com/xingkongliang/skills-manager) desktop app remains the **single owner** of the user's skill library, tags, presets and backup history. Skill Bridge is a read-only MCP delivery/indexing layer.

## Source of truth and permissions

1. On the PC, Skills Manager manages its normal central library and syncs it to a **PRIVATE** Git repository via its own backup mechanism.
2. On the VPS, create a **dedicated read-only GitHub deploy key** on that private backup repository. Do not copy the Windows user's account token, the Skills Manager DB, or an SSH private key into this public project.
3. Clone the private backup to a separate directory such as `~/services/skill-bridge-private-library`. Use an SSH command constrained to the read-only key. Never initialize a writable Git remote for this checkout.
4. Run `deploy/linux/sync-library.sh` through `skill-bridge-library-sync.timer` (five-minute polling). The script refuses to overwrite a dirty local checkout, only fast-forwards, and never pushes.
5. Set `SKILL_BRIDGE_SKILLS_DIR` to that checkout. The MCP server reads its `SKILL.md` files directly and notices new files and changes without a restart.

The private skill repository is **not** a subdirectory or submodule of the public Skill Bridge OSS repository. **Never add it to `git add` in this public project.**

### Install sync services on Ubuntu VPS

```bash
cp ~/services/skill-bridge-mcp/deploy/systemd/skill-bridge-library-sync.* \
   ~/.config/systemd/user/
cp ~/services/skill-bridge-mcp/deploy/systemd/skill-bridge-mcp.service \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now skill-bridge-library-sync.timer
systemctl --user restart skill-bridge-mcp.service
systemctl --user status skill-bridge-library-sync.timer
node ~/services/skill-bridge-mcp/scripts/bench-library.mjs \
   ~/services/skill-bridge-private-library
```

Verify that the MCP service listens only on `127.0.0.1`, and that OpenAI Secure MCP Tunnel uses an independently authorized, valid runtime key. The tunnel's process readiness does not prove control-plane authentication.

### Editing

Real skills remain owned by **Skills Manager**, preserving its database, tags, presets, deployments and skill-aware conflict resolution. A change committed by Skills Manager arrives in the VPS mirror at the next poll.

The optional edit workflow keeps the VPS library read-only:

1. ChatGPT loads a skill to learn the current revision.
2. `preview_skill_edit` validates a proposed replacement `SKILL.md` and returns a short diff summary. It **does not write**.
3. `stage_skill_edit` (when `SKILL_BRIDGE_PROPOSALS_DIR` is configured) saves a private proposal only, never the live library.
4. On the **managing PC**, download the proposal by its UUID over SSH and review the full file:

```powershell
.\scripts\fetch-skill-edit.ps1 -ProposalId <UUID> -SshTarget user@your-vps
node scripts\apply-skill-edit.mjs "$HOME\.skills-manager\skill-bridge-edit-proposals\<UUID>.json"
```

5. Only after user review, pass `--apply`. The local script refuses stale revision IDs and a dirty Git worktree, takes an external backup, and atomically replaces one `SKILL.md`. Skills Manager can then perform its ordinary private Git backup.

This is **not** unattended AI write access: user approval on the managing PC is required. Do not edit the VPS Git mirror directly; that would create divergence and stop sync. The edit proposal and original skill text never enter the public OSS repository.

### What is synchronized?

Only the content present in the private Skills Manager Git backup. The local SQLite database, OS keychain and uncommitted local changes are not automatically available on the VPS. Changes may take the Skills Manager backup delay plus the VPS polling interval. Some `SKILL.md` files may be excluded by current registry safety limits (validation, file size, symlink protection); investigate excluded files rather than disabling security checks.

Be aware: once connected, the authorized ChatGPT workspace can retrieve the contents of **every valid SKILL.md** in the private mirror, even if a particular local agent is not using it. Audit the library for secrets and sensitive content before exposing it, or deploy a curated subset instead.
