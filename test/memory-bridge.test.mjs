import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryBridge } from "../src/memory-bridge.mjs";
import { readGithubMarkdown } from "../src/github-markdown.mjs";

test("memory candidate -> manual review -> search, dedupe and provenance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-memory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bridge = new MemoryBridge(path.join(root, "private"));
  const draft = { title: "DSH project decision", content: "Choose a stable runner for DSH.",
    kind: "decision", source: "chatgpt", source_ref: "conversation:test", tags: ["DSH", "design"] };
  const a = await bridge.propose(draft);
  assert.equal(a.status, "pending");
  assert.equal((await bridge.propose(draft)).duplicate, true);
  assert.equal((await bridge.search("DSH")).length, 0);
  assert.equal((await bridge.list()).length, 1);
  await assert.rejects(bridge.review("../etc/passwd", "approve"), /Invalid memory/);
  const before = JSON.parse(await readFile(bridge.file("pending", a.id), "utf8"));
  assert.equal(before.source_ref, "conversation:test");
  assert.equal((await bridge.review(a.id, "approve")).status, "approved");
  const results = await bridge.search("DSH");
  assert.equal(results.length, 1);
  assert.equal(results[0].content, draft.content);
  await assert.rejects(bridge.review(a.id, "approve"), /ENOENT/);
  await assert.rejects(bridge.propose({ ...draft, source: "unknown" }), /Invalid memory/);
});

test("GitHub reader fetches only a selected Markdown document and retains blob SHA", async () => {
  const seen = [];
  const fetcher = async (url, opts) => {
    seen.push([url, opts]);
    return new Response(JSON.stringify({ type: "file", encoding: "base64",
      content: Buffer.from("# A document").toString("base64"), sha: "testblobsha" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  const read = await readGithubMarkdown({ owner: "test", repo: "skills", file_path: "docs/design.md",
    ref: "main" }, { fetcher });
  assert.equal(read.markdown, "# A document");
  assert.equal(read.sha, "testblobsha");
  assert.match(seen[0][0], /^https:\/\/api\.github\.com\//);
  await assert.rejects(readGithubMarkdown({ owner: "test", repo: "skills",
    file_path: "../.env" }, { fetcher }), /Markdown/);
});
