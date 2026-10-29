import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { parseMetadata } from "./registry.mjs";

const MAX_BYTES = 131072;
const sha = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);
function sampleDiff(before, after) {
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  const changes = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      changes.push({ line: i + 1, before: (a[i] || "").slice(0, 180),
        after: (b[i] || "").slice(0, 180) });
      if (changes.length >= 12) break;
    }
  }
  return changes;
}

export class EditProposals {
  constructor(registry, dir) {
    this.registry = registry;
    this.dir = dir ? path.resolve(dir) : "";
  }
  async preview(skillId, expectedRevision, newInstructions) {
    if (typeof newInstructions !== "string" ||
        Buffer.byteLength(newInstructions, "utf8") > MAX_BYTES) {
      throw new Error("New SKILL.md must be UTF-8 text up to 128 KiB");
    }
    const existing = await this.registry.readSkill(skillId);
    if (existing.revision !== expectedRevision) {
      throw new Error("Revision conflict: reload the latest skill before proposing an edit");
    }
    const metadata = parseMetadata(newInstructions);
    if (metadata.name !== skillId) throw new Error("Frontmatter name must match skill ID");
    return {
      skill_id: skillId, expected_revision: expectedRevision,
      proposed_revision: sha(newInstructions),
      changed: newInstructions !== existing.instructions,
      diff_preview: sampleDiff(existing.instructions, newInstructions),
      old_lines: existing.instructions.split(/\r?\n/).length,
      new_lines: newInstructions.split(/\r?\n/).length
    };
  }
  async stage(skillId, expectedRevision, newInstructions) {
    if (!this.dir) throw new Error("Editing is disabled on this server");
    const result = await this.preview(skillId, expectedRevision, newInstructions);
    if (!result.changed) throw new Error("No changes proposed");
    const root = await this.registry.rootPath();
    const relative = path.relative(root, this.dir);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error("Proposal storage must not be inside the skill library");
    }
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid proposal storage");
    const id = randomUUID();
    const proposal = { ...result, proposal_id: id, new_instructions: newInstructions,
      created_at: new Date().toISOString() };
    await fs.writeFile(path.join(this.dir, id + ".json"), JSON.stringify(proposal),
      { flag: "wx", mode: 0o600 });
    return { ...result, proposal_id: id, status: "staged_for_review",
      message: "Only a draft was saved. No Skills Manager file was changed. Review and apply on the managing PC." };
  }
}
