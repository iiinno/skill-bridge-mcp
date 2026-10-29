// Minimal portable NDJSON interchange for a separate AgentMemory importer.
// This does NOT guess at an installation's private database or API schema.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const root = path.resolve(process.env.SKILL_BRIDGE_MEMORY_DIR ||
  path.join(os.homedir(), ".skill-bridge", "memory"));
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
if (outputIndex < 0 || !args[outputIndex + 1]) {
  console.error("Usage: node scripts/export-approved-memory.mjs --output path.ndjson");
  process.exit(1);
}
const dest = path.resolve(args[outputIndex + 1]);
if (dest.startsWith(root + path.sep)) throw new Error("Output must be outside live memory store");
const names = await fs.readdir(path.join(root, "approved"));
const result = [];
for (const name of names) {
  if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
  const value = JSON.parse(await fs.readFile(path.join(root, "approved", name), "utf8"));
  if (value.status !== "approved") continue;
  result.push({ id: value.id, title: value.title, content: value.content,
    type: value.kind, source: value.source, source_ref: value.source_ref,
    tags: value.tags, created_at: value.created_at, reviewed_at: value.reviewed_at });
}
await fs.writeFile(dest, result.map((r) => JSON.stringify(r)).join("\n") + (result.length ? "\n" : ""),
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ exported: result.length, destination: dest }));
console.log("Portable interchange only. No external AgentMemory API or database was mutated.");
