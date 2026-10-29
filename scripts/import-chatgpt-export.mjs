// Preview ONE explicitly selected conversation from a ChatGPT data export.
// Never silently copies the user's complete history into any backend.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { MemoryBridge } from "../src/memory-bridge.mjs";

const argv = process.argv.slice(2);
const arg = (key) => argv[argv.indexOf(key) + 1];
const filename = argv.includes("--file") ? arg("--file") : null;
const conversationId = argv.includes("--conversation-id") ? arg("--conversation-id") : null;
if (!filename) {
  console.error("Usage: node scripts/import-chatgpt-export.mjs --file conversations.json [--conversation-id ID --stage]");
  process.exit(1);
}
const stat = await fs.stat(filename);
if (stat.size > 300_000_000) throw new Error("Export too large: maximum 300 MB");
const conversations = JSON.parse(await fs.readFile(filename, "utf8"));
if (!Array.isArray(conversations)) throw new Error("Expected a ChatGPT conversations.json array");
if (!conversationId) {
  console.log(JSON.stringify({ conversations: conversations.length,
    note: "No content has been imported. Supply --conversation-id for one conversation." }));
  process.exit(0);
}
const chosen = conversations.find((c) => c.id === conversationId || c.conversation_id === conversationId);
if (!chosen) throw new Error("Conversation ID not found");
const nodes = Object.values(chosen.mapping || {});
const messages = nodes.map((n) => n?.message).filter(Boolean)
  .filter((m) => ["user", "assistant"].includes(m.author?.role))
  .sort((a, b) => (a.create_time || 0) - (b.create_time || 0))
  .map((m) => ({
    role: m.author.role,
    text: (m.content?.parts || []).filter((v) => typeof v === "string").join("\n")
  })).filter((m) => m.text.trim());
// Deliberately omit system messages, tool calls, files, and all other conversations.
const sourceRef = createHash("sha256").update(conversationId).digest("hex").slice(0, 20);
const excerpt = messages.slice(-12).map((m) => m.role + ": " + m.text.slice(0, 700))
  .join("\n\n").slice(0, 8800);
console.log(JSON.stringify({ conversation_ref: sourceRef, messages: messages.length,
  excerpt_chars: excerpt.length, stage: argv.includes("--stage"),
  note: "Excerpt is a review candidate, not a verified summary. Check privacy and accuracy." }));
if (argv.includes("--stage")) {
  const bridge = new MemoryBridge(process.env.SKILL_BRIDGE_MEMORY_DIR ||
    path.join(os.homedir(), ".skill-bridge", "memory"));
  const result = await bridge.propose({
    title: String(chosen.title || "ChatGPT conversation").slice(0, 180),
    content: "Unverified ChatGPT conversation excerpt; review and summarize before reuse:\n\n" + excerpt,
    kind: "conversation-summary", source: "chatgpt", source_ref: "chatgpt-export:" + sourceRef,
    tags: ["chatgpt-import", "requires-review"]
  });
  console.log(JSON.stringify(result));
}
