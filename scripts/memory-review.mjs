import path from "node:path";
import os from "node:os";
import { MemoryBridge } from "../src/memory-bridge.mjs";

const root = process.env.SKILL_BRIDGE_MEMORY_DIR ||
  path.join(os.homedir(), ".skill-bridge", "memory");
const bridge = new MemoryBridge(root);
const [action, id] = process.argv.slice(2);
try {
  if (action === "list") {
    console.log(JSON.stringify(await bridge.list("pending", 100), null, 2));
  } else if (action === "show" && id) {
    const file = bridge.file("pending", id);
    const { readFile } = await import("node:fs/promises");
    const value = JSON.parse(await readFile(file, "utf8"));
    console.log(JSON.stringify(value, null, 2));
  } else if (["approve", "reject"].includes(action) && id) {
    // Explicit operator action, never called by MCP. Review the full note first.
    const result = await bridge.review(id, action);
    console.log(JSON.stringify(result, null, 2));
    console.log("This action does NOT write to the external AgentMemory database.");
  } else {
    console.error("Usage: node scripts/memory-review.mjs list|show <uuid>|approve <uuid>|reject <uuid>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Memory review failed:", error.message);
  process.exitCode = 1;
}
