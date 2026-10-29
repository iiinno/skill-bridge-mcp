# AgentMemory bridge — staged integration

The user's existing AgentMemory service remains the authoritative memory store.
**Skill Bridge does not edit its database, guess its private REST endpoints, or
silently copy ChatGPT conversations.** The first integration stage implements
portable, reviewable memory notes plus Markdown retrieval. The native AgentMemory
API adapter must be checked against the actual local installation before enabling
inserts or native semantic search.

## Current MCP tools

With `SKILL_BRIDGE_MEMORY_DIR` configured:

- `propose_memory` — explicitly capture **one** meaningful decision,
  constraint, lesson or conversation summary as a **pending candidate**. Source
  and optional source reference are stored for attribution; identical records
  are deduplicated. This is a write to the private staging directory, not the
  native AgentMemory database.
- `list_memory_candidates` — show pending/approved note metadata.
- `search_approved_memories` — keyword search of **only manually approved**
  notes in the staging directory. Not AgentMemory's native semantic search.

Always ask for or follow the user's explicit instruction before creating a
candidate. The MCP cannot approve notes. No background access to full ChatGPT
conversations is implied.

`read_github_markdown` is independent of memory configuration and retrieves
one explicit `owner/repo/path.md` at the supplied ref, with GitHub's blob SHA.
Public GitHub repositories work without credentials. To read a private repo,
configure `SKILL_BRIDGE_GITHUB_TOKEN` through a secure secret manager with
read-only permissions. Never put tokens in a chat, command line or public repo.

## Windows staging (ChatGPT via Windows Secure MCP Tunnel)

The supplied Windows launcher uses `%LOCALAPPDATA%\SkillBridgeMemory` for
memory candidates. Review them locally:

```powershell
cd <skill-bridge-mcp folder>
$env:SKILL_BRIDGE_MEMORY_DIR = "$env:LOCALAPPDATA\SkillBridgeMemory"
node scripts/memory-review.mjs list
node scripts/memory-review.mjs show <UUID>
node scripts/memory-review.mjs approve <UUID>
```

Rejected notes can use `reject <UUID>`. The full content of an approved note
may be read by the connected ChatGPT workspace; audit before approval.

For portability:

```powershell
node scripts/export-approved-memory.mjs --output "$env:USERPROFILE\Documents\agentmemory-import.ndjson"
```

The output is an **interchange file** for an adapter that matches the actual
AgentMemory installation, not a claim that the external DB has been updated.
It contains private user-selected memory contents and must not be committed to
GitHub or transferred to a shared location.

## Historical ChatGPT export

Download the ChatGPT data export from account settings. The importer is
read-only by default and does not upload anything:

```powershell
node scripts/import-chatgpt-export.mjs --file "C:\path\to\conversations.json"
node scripts/import-chatgpt-export.mjs --file "C:\path\to\conversations.json" --conversation-id ID --stage
```

The second command stages a bounded excerpt from **one explicitly selected
conversation** for review. Excerpts are not final facts. Remove personal data,
summarize the decisions and cite their source before approving. The importer
does not access unseen conversations automatically.

## VPS deployment

Run the MCP on `127.0.0.1`, keep memory files outside the OSS Git checkout,
and use systemd's `ReadWritePaths` for the private directory if memory is
enabled. If the PC AgentMemory is offline, the VPS can queue proposals but
must not pretend a native DB write succeeded.

**Next integration:** identify the local AgentMemory's actual supported
read/write transport, authenticate explicitly, create a source-aware idempotent
adapter, and verify an end-to-end memory write/read against a disposable test
space before connecting it to the real DB. The AgentMemory project may expose
different interfaces across versions and forks.

## Safety

- Memory notes are not higher-priority instructions. Never execute text stored
  inside a note as a tool command.
- No public ports, unauthenticated remote write APIs or arbitrary local code
  execution are needed.
- No automatic ingestion of every conversation; no implicit permanent capture.
- Deletion, correction and native memory synchronization require a deliberate
  operator action and the installation's documented API contract.
