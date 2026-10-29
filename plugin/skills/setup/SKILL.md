---
name: setup
description: Set up and test Skill Bridge's MCP connection, then discover and load a server-hosted skill.
---

Use the skill-bridge MCP connection. First call list_skills. Ask the user which available skill to use, unless they already named one. Call load_skill with the selected skill ID and follow the returned workflow subject to the user's instructions and existing safety and tool permissions. If a resource is referenced, use read_skill_resource. Report connection failures rather than pretending the skill loaded.
