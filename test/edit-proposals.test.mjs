import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "../src/registry.mjs";
import { EditProposals } from "../src/edit-proposals.mjs";
import { applyProposal } from "../src/apply-proposal.mjs";
import { execFileSync } from "node:child_process";

const oldSkill = "---\nname: demo\ndescription: Demo process\n---\n\n# Original\n";
const updatedSkill = "---\nname: demo\ndescription: Demo process updated\n---\n\n# Updated\n";

test("edits are versioned drafts; explicit PC apply is atomic and preserves backup", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-bridge-edit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = path.join(root, "library");
  const proposals = path.join(root, "proposals");
  const backupDir = path.join(root, "backup");
  await mkdir(path.join(library, "demo"), { recursive: true });
  await writeFile(path.join(library, "demo", "SKILL.md"), oldSkill);
  execFileSync("git", ["init", "-q", library]);
  execFileSync("git", ["-C", library, "add", "."]);
  execFileSync("git", ["-C", library, "-c", "user.name=Test", "-c",
    "user.email=test@example.test", "commit", "-qm", "initial"]);
  const registry = new SkillRegistry(library);
  const edits = new EditProposals(registry, proposals);
  const skill = await registry.readSkill("demo");
  await assert.rejects(edits.preview("demo", "0000000000000000", updatedSkill), /Revision conflict/);
  await assert.rejects(edits.preview("demo", skill.revision,
    updatedSkill.replace("name: demo", "name: bad")), /name must match/);
  const preview = await edits.preview("demo", skill.revision, updatedSkill);
  assert.equal(preview.changed, true);
  assert.equal((await readFile(path.join(library, "demo", "SKILL.md"), "utf8")), oldSkill);
  const draft = await edits.stage("demo", skill.revision, updatedSkill);
  assert.equal(draft.status, "staged_for_review");
  const file = path.join(proposals, draft.proposal_id + ".json");
  assert.equal((await applyProposal(library, file)).applied, false);
  assert.equal((await readFile(path.join(library, "demo", "SKILL.md"), "utf8")), oldSkill);
  assert.equal((await applyProposal(library, file, { apply: true, backupRoot: backupDir })).applied, true);
  assert.equal((await readFile(path.join(library, "demo", "SKILL.md"), "utf8")), updatedSkill);
  await assert.rejects(applyProposal(library, file, { apply: true, backupRoot: backupDir }),
    /Revision conflict/);
});
