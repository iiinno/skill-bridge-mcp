import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, readdir, readFile, writeFile, lstat, symlink } from "node:fs/promises";
import { MarkdownMemory } from "../src/markdown-memory.mjs";

test("Markdown memory is its own source of truth with safe revisions and archive", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-md-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const engine = new MarkdownMemory(path.join(root, "private-memory"));
  const input = { title: "DSHで記憶を共有する", content: "記憶はVPSでMarkdownとして保存する。",
    kind: "decision", source: "chatgpt", source_ref: "chatgpt:discussion",
    tags: ["DSH", "memory"] };
  const created = await engine.create(input);
  assert.equal(created.status, "pending");
  assert.equal((await engine.create(input)).duplicate, true);
  assert.deepEqual(await engine.search("記憶"), []);
  const pending = await engine.read("pending", created.id);
  assert.equal(pending.title, input.title);
  assert.match(await readFile(engine.location("pending", created.id), "utf8"), /^---\n/);
  assert.equal((await lstat(engine.location("pending", created.id))).isFile(), true);
  await assert.rejects(engine.mutate(created.id, "0000000000000000", "approve"), /Revision conflict/);
  const approved = await engine.mutate(created.id, pending.revision, "approve");
  assert.equal(approved.status, "active");
  assert.equal((await engine.search("記憶"))[0].id, created.id);
  const loaded = await engine.read("active", created.id);
  const updated = await engine.mutate(created.id, loaded.revision, "update", {
    content: "記憶はVPS上のMarkdownファイルで一元管理する。"
  });
  assert.equal(updated.status, "active");
  assert.notEqual(updated.revision, loaded.revision);
  assert.equal((await engine.read("active", created.id)).source_ref, input.source_ref);
  await assert.rejects(engine.mutate(created.id, loaded.revision, "update",
    { content: "古い変更" }), /Revision conflict/);
  assert.ok((await readdir(path.join(root, "private-memory", ".history"))).length >= 2);
  const archived = await engine.mutate(created.id, updated.revision, "archive");
  assert.equal(archived.status, "archived");
  assert.deepEqual(await engine.search("記憶"), []);
  assert.equal((await engine.read("archived", created.id)).id, created.id);
});

test("Markdown store rejects invalid paths/metadata and symlinks", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-md-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const engine = new MarkdownMemory(path.join(root, "private"));
  await assert.rejects(engine.create({ title: "x", content: "secret",
    kind: "decision", source: "chatgpt", tags: [] }), /Invalid title/);
  await assert.rejects(engine.read("active", "../../foo"), /Invalid memory/);
  await engine.ensure();
  await writeFile(path.join(root, "other.md"), "not a memory");
  const id = "9e4e6f54-bb41-4bcb-aec4-828d53ff62ad";
  await symlink(path.join(root, "other.md"), engine.location("active", id));
  await assert.rejects(engine.read("active", id), /unavailable/);
  assert.deepEqual(await engine.search("other"), []);
});
