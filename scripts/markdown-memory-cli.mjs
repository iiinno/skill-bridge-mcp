import { MarkdownMemory } from "../src/markdown-memory.mjs";
import os from "node:os";
import path from "node:path";

const root = process.env.SKILL_BRIDGE_MARKDOWN_MEMORY_DIR ||
  path.join(os.homedir(), ".local", "share", "skill-bridge-memory");
const memory = new MarkdownMemory(root);
const [command, ...args] = process.argv.slice(2);
try {
  let result;
  if (command === "list") {
    result = await memory.list(args[0] || "active", 100);
  } else if (command === "search") {
    result = await memory.search(args.join(" "), 20);
  } else if (command === "get") {
    result = await memory.read(args[1] || "active", args[0]);
  } else if (["approve", "archive"].includes(command)) {
    const [id, expectedRevision] = args;
    result = await memory.mutate(id, expectedRevision, command);
  } else {
    throw new Error("Usage: markdown-memory-cli.mjs list [pending|active|archived] | search <words> | get <UUID> [status] | approve <UUID> <revision> | archive <UUID> <revision>");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
