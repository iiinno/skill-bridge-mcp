import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function startServer(env, t) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, SKILL_BRIDGE_HOST: "127.0.0.1", SKILL_BRIDGE_PORT: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Server startup timed out: " + output)), 30000);
    const onOutput = (chunk) => {
      output += chunk.toString();
      const match = output.match(/MCP listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("exit", (code) => { clearTimeout(timeout); reject(new Error("Server exited: " + code + " " + output)); });
  });
  return url;
}

test("MCP HTTP discovery, skill retrieval, hot reload and resource security", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-http-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "sample", "references"), { recursive: true });
  await writeFile(path.join(dir, "sample", "SKILL.md"),
    "---\nname: sample\ndescription: Example agent workflow available over MCP.\n---\n\n# Initial\n", "utf8");
  await writeFile(path.join(dir, "sample", "references", "guide.md"), "Reference V1", "utf8");
  const url = await startServer({ SKILL_BRIDGE_SKILLS_DIR: dir }, t);
  const client = new Client({ name: "skill-bridge-test", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  t.after(async () => { await client.close(); });

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((x) => x.name).sort(),
    ["list_skills", "load_skill", "preview_skill_edit", "read_skill_resource", "search_skills"]);
  const skills = await client.callTool({ name: "list_skills", arguments: {} });
  assert.equal(skills.structuredContent.skills[0].id, "sample");
  const ranked = await client.callTool({ name: "search_skills", arguments: { query: "workflow" } });
  assert.equal(ranked.structuredContent.skills[0].id, "sample");
  const first = await client.callTool({ name: "load_skill", arguments: { skill_id: "sample" } });
  assert.match(first.structuredContent.instructions, /Initial/);
  await writeFile(path.join(dir, "sample", "SKILL.md"),
    "---\nname: sample\ndescription: Example agent workflow available over MCP.\n---\n\n# Updated\n", "utf8");
  const second = await client.callTool({ name: "load_skill", arguments: { skill_id: "sample" } });
  assert.match(second.structuredContent.instructions, /Updated/);
  assert.notEqual(first.structuredContent.revision, second.structuredContent.revision);
  const resource = await client.callTool({ name: "read_skill_resource",
    arguments: { skill_id: "sample", relative_path: "references/guide.md" } });
  assert.equal(resource.structuredContent.text, "Reference V1");
  const blocked = await client.callTool({ name: "read_skill_resource",
    arguments: { skill_id: "sample", relative_path: "../outside.md" } });
  assert.equal(blocked.isError, true);
});

test("token-protected HTTP server rejects missing credentials", async (t) => {
  const url = await startServer({ SKILL_BRIDGE_TOKEN: "test-secret" }, t);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  assert.equal(response.status, 401);
});

test("MCP blocks spoofed Host and Origin headers (DNS rebinding protection)", async (t) => {
  const url = await startServer({}, t);
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "attack-test", version: "1" } }
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: "attacker.example:8787",
      origin: "http://attacker.example:8787"
    },
    body
  });
  assert.equal(response.status, 403);
});
