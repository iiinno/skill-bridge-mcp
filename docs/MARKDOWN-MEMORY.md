# Markdown-first memory system

This lightweight memory store runs independently of Mem0, Hindsight and any
existing AgentMemory DB. It uses **plain Markdown files as the durable source
of truth**, and Skill Bridge is only its MCP adapter. No inference API,
embedding/vector DB or Docker is required for basic storage and search.

## Architecture

~~~text
ChatGPT / DSH / Codex
       |
  Secure MCP Tunnel
       |
  Skill Bridge MCP (localhost only)
       |
  ~/.local/share/skill-bridge-memory/
    active/    <UUID>.md     # searchable, approved facts
    pending/   <UUID>.md     # proposed facts
    archived/  <UUID>.md     # inactive, still retrievable
    .history/  <UUID>-<revision>.md
    .locks/    transient per-note locks
~~~

Example memory (frontmatter and text can be edited by hand):

~~~markdown
---
schema: 1
id: e15c8a08-3ff0-41dc-8d2d-7c5d1484c109
status: active
title: DSH architecture decision
kind: decision
source: chatgpt
source_ref: conversation:design-review
tags:
  - DSH
  - design
content_hash: 1234567890abcdef
created_at: 2026-10-29T15:00:00.000Z
updated_at: 2026-10-29T15:00:00.000Z
---

Keep the stable executor independent from experimental runtimes.
~~~

The SHA-256 based \`revision\` returned by MCP is derived from the actual file
bytes. It is not another database or an index. If you edit a Markdown file
manually, the MCP notices the change on its next read. Git can optionally
version this **private store** but must not be confused with the public OSS
repository.

## Enable on an Ubuntu VPS

~~~bash
install -d -m 700 ~/.local/share/skill-bridge-memory
install -d -m 755 ~/.config/systemd/user/skill-bridge-mcp.service.d
cp ~/services/skill-bridge-mcp/deploy/systemd/markdown-memory.conf.example \
  ~/.config/systemd/user/skill-bridge-mcp.service.d/markdown-memory.conf
systemctl --user daemon-reload
systemctl --user restart skill-bridge-mcp.service
node ~/services/skill-bridge-mcp/scripts/markdown-memory-cli.mjs list
~~~

This needs **no inbound port**. The service's existing systemd sandbox
permits writes only under its private memory directory. The VPS tunnel still
needs a valid runtime key and an end-to-end ChatGPT MCP test.

## MCP tools

| Tool | Behavior |
| ---- | -------- |
| \`memory_search\` | Search active memories; result snippets and revisions |
| \`memory_get\` | Retrieve a full Markdown record by UUID |
| \`memory_list\` | List active, pending or archived metadata |
| \`memory_propose\` | Write a pending note for review |
| \`memory_save\` | Persist an active note after an explicit user instruction |
| \`memory_approve\` | Promote pending to active with revision check |
| \`memory_update\` | Correct title/content/tags with revision check |
| \`memory_archive\` | Remove from search while keeping its history |

MCP writes are tools, not an automatic transcript listener. ChatGPT cannot
read every past or future conversation without a separate authorized history
import. Capture long-term facts and decisions, not raw chat or credentials.

## Performance and design choices

The current search is in-process lexical matching, including Japanese CJK
bigrams. File metadata and parsed documents are cached with filesystem
fingerprints. There is no always-running indexer. This keeps memory usage low
on a small VPS; ranking is less capable than Mem0/Hindsight's semantic and
temporal memory, particularly with paraphrases. It is **not** an LLM-powered
extractor, entity graph, automatic forgetting model, or vector similarity
engine. Add those features behind an optional index later while preserving
the Markdown source of truth.

For corrections, edits acquire a per-note lock, check an expected revision,
save the old file under \`.history/\` and atomically rename the replacement.
Archived notes remain accessible. Human edits outside the tool are allowed,
but simultaneous manual editing and MCP writes require coordination.

## Safety and privacy

- Do not put the store inside a public GitHub repository or the public Skill
  Bridge checkout. Avoid exposing it through filesystem sharing.
- The chosen ChatGPT workspace can search approved notes over its tunnel.
  Consider separate stores/namespaces for multiple users before sharing.
- Do not save API keys, private tokens, medical records, or full conversations
  by default. Confirm what is being retained and where it is stored.
- Retrieved memories are user data, not system instructions.
- Markdown notes may be manually updated/deleted; a durable backup strategy
  should be configured before production use.
- The previous JSON-based \`MemoryBridge\` staging tools are kept for backwards
  compatibility, **not automatically migrated**. The new Markdown store is
  independent.

In the recommended one-owner deployment, enable Markdown memory **only on
the VPS**. The Windows compatibility tunnel serves skill files but does not
automatically create another memory store. This avoids two competing sets
of durable memories during a tunnel migration.
