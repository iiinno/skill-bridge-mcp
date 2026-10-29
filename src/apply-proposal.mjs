import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { SkillRegistry, parseMetadata } from "./registry.mjs";

export async function applyProposal(root, inputPath, { apply = false, backupRoot } = {}) {
  const sourceRoot = path.resolve(root);
  const proposal = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const { skill_id: id, expected_revision: revision, new_instructions: content } = proposal;
  if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      typeof revision !== "string" || !/^[0-9a-f]{16}$/.test(revision) ||
      typeof content !== "string" || Buffer.byteLength(content, "utf8") > 131072) {
    throw new Error("Malformed edit proposal");
  }
  if (parseMetadata(content).name !== id) throw new Error("Proposal name does not match skill");
  const registry = new SkillRegistry(sourceRoot);
  const current = await registry.readSkill(id);
  if (current.revision !== revision) throw new Error("Revision conflict; refusing overwrite");
  const changed = current.instructions !== content;
  if (!apply || !changed) return { skill_id: id, changed, applied: false, dry_run: !apply };

  // The PC's Skills Manager owns this checkout. Refuse dirty Git state to avoid
  // overwriting concurrent edits, or diverging from the user's backup history.
  const git = spawnSync("git", ["-C", sourceRoot, "status", "--porcelain"],
    { encoding: "utf8", windowsHide: true });
  if (git.status !== 0 || git.stdout.trim()) {
    throw new Error("Skills Manager Git worktree is not clean; resolve changes first");
  }
  const directory = await registry.skillPath(id);
  const file = path.join(directory, "SKILL.md");
  if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("Symlink edit rejected");
  const lock = path.join(directory, ".skill-bridge-edit.lock");
  const lockHandle = await fs.open(lock, "wx", 0o600);
  let temp = "";
  try {
    const refreshed = await registry.readSkill(id);
    if (refreshed.revision !== revision) throw new Error("Concurrent edit detected");
    const backupDir = path.resolve(backupRoot ||
      path.join(os.homedir(), ".skills-manager", "skill-bridge-edit-backups", id));
    if (backupDir === sourceRoot || backupDir.startsWith(sourceRoot + path.sep)) {
      throw new Error("Backups must live outside the synced skill repository");
    }
    await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const backup = path.join(backupDir, stamp + "-" + randomUUID() + ".md");
    await fs.copyFile(file, backup, fsConstants.COPYFILE_EXCL);
    temp = path.join(directory, ".skill-bridge-" + randomUUID() + ".tmp");
    await fs.writeFile(temp, content, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, file);
    return { skill_id: id, changed: true, applied: true, backup_path: backup };
  } finally {
    if (temp) await fs.rm(temp, { force: true }).catch(() => {});
    await lockHandle.close();
    await fs.rm(lock, { force: true });
  }
}
