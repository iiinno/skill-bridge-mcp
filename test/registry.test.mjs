import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "../src/registry.mjs";

const SKILL = "---\nname: sample\n" +
  "description: A sample workflow for integration tests.\n---\n\n# Sample\nRead references/guide.md\n";

test("registry lists, loads and immediately reflects changes", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "sample", "references"), { recursive: true });
  await writeFile(path.join(dir, "sample", "SKILL.md"), SKILL, "utf8");
  await writeFile(path.join(dir, "sample", "references", "guide.md"), "Hello", "utf8");
  const reg = new SkillRegistry(dir);
  assert.equal((await reg.listSkills()).length, 1);
  assert.equal((await reg.listSkills("none")).length, 0);
  const first = await reg.readSkill("sample");
  assert.match(first.instructions, /Sample/);
  assert.equal((await reg.readResource("sample", "references/guide.md")).text, "Hello");
  await writeFile(path.join(dir, "sample", "SKILL.md"), SKILL + "\nNew workflow step!\n", "utf8");
  const second = await reg.readSkill("sample");
  assert.notEqual(first.revision, second.revision);
  assert.match(second.instructions, /New workflow step/);
});

test("registry rejects traversal, symlinks and invalid metadata", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "sample", "references"), { recursive: true });
  await writeFile(path.join(dir, "sample", "SKILL.md"), SKILL, "utf8");
  const reg = new SkillRegistry(dir);
  await assert.rejects(reg.readSkill("../sample"));
  await assert.rejects(reg.readResource("sample", "../secret.txt"));
  await assert.rejects(reg.readResource("sample", "references/../../secret.txt"));
  await assert.rejects(reg.readResource("sample", "scripts/hack.js"));
  await writeFile(path.join(dir, "sample", "references", "evil.js"), "console.log('bad')");
  await assert.rejects(reg.readResource("sample", "references/evil.js"));
  try {
    await symlink(path.join(dir, "sample", "SKILL.md"), path.join(dir, "sample", "references", "link.md"));
    await assert.rejects(reg.readResource("sample", "references/link.md"));
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }
  await writeFile(path.join(dir, "sample", "SKILL.md"),
    "---\nname: mismatch\ndescription: Does not match directory.\n---\n", "utf8");
  assert.equal((await reg.listSkills()).length, 0);
});

test("ranked search matches Japanese intent and updates revisions", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-ranked-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, description, tags] of [
    ["security-review", "Review code for security vulnerabilities", "security,review"],
    ["docs-report", "Write reports and documents", "writing,report"],
    ["unrelated", "Unrelated workflow", "misc"]
  ]) {
    await mkdir(path.join(dir, name));
    await writeFile(path.join(dir, name, "SKILL.md"),
      "---\nname: " + name + "\ndescription: " + description +
      "\ntags: [" + tags + "]\n---\n\n# Skill\n");
  }
  const reg = new SkillRegistry(dir);
  const review = await reg.searchSkills("セキュリティレビュー");
  assert.equal(review[0].id, "security-review");
  assert.equal(review.some((x) => x.id === "unrelated"), false);
  assert.equal((await reg.searchSkills("資料", 1))[0].id, "docs-report");
  assert.equal((await reg.listSkills("", 2)).length, 2);
  const original = await reg.readSkill("docs-report");
  assert.equal((await reg.readSkill("docs-report")).revision, original.revision);
  await writeFile(path.join(dir, "docs-report", "SKILL.md"),
    "---\nname: docs-report\ndescription: A new report workflow\n---\n\n# New step\n");
  const next = await reg.readSkill("docs-report");
  assert.notEqual(next.revision, original.revision);
});
