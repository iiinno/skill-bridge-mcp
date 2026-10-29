import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { scoreSkill } from "./ranker.mjs";

// Agent Skills naming convention: 1-64 lowercase alphanumerics / single hyphens.
const SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_PART = /^[a-zA-Z0-9._-]+$/;
const RESOURCE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv"]);
const MAX_SKILL_BYTES = 131072;
const MAX_RESOURCE_BYTES = 131072;
const MAX_SKILLS = 2048;

async function readLimitedText(file, directory, maxBytes) {
  const realDirectory = await fs.realpath(directory);
  const realFile = await fs.realpath(file);
  const relative = path.relative(realDirectory, realFile);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Resource escapes the skill directory");
  }
  const handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Text file is unavailable or too large");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export class SkillRegistry {
  constructor(root) {
    this.root = path.resolve(root);
    this.cache = new Map();
  }

  async rootPath() {
    const rootStat = await fs.lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Skill root must be a real directory");
    return this.root;
  }

  async skillPath(name) {
    if (!SKILL_NAME.test(name)) throw new Error("Invalid skill name");
    const root = await this.rootPath();
    const dir = path.join(root, name);
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Skill is not a regular directory");
    return dir;
  }

  async readSkill(name) {
    const dir = await this.skillPath(name);
    const file = path.join(dir, "SKILL.md");
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_BYTES) {
      throw new Error("SKILL.md is unavailable or too large");
    }
    const fingerprint = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
    const hit = this.cache.get(name);
    if (hit?.fingerprint === fingerprint) return hit.skill;
    const content = await readLimitedText(file, dir, MAX_SKILL_BYTES);
    const meta = parseMetadata(content);
    if (meta.name !== name) throw new Error("Frontmatter name must equal skill directory name");
    const revision = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const skill = { id: name, name: meta.name, description: meta.description,
      tags: meta.tags, aliases: meta.aliases, revision, instructions: content };
    this.cache.set(name, { fingerprint, skill });
    return skill;
  }

  async listSkills(query = "", limit = MAX_SKILLS) {
    await this.rootPath();
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const selected = entries.filter((entry) => entry.isDirectory() && SKILL_NAME.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SKILLS);
    const loaded = await Promise.all(selected.map(async (entry) => {
      try {
        const { id, description, tags, aliases, revision } = await this.readSkill(entry.name);
        return { id, description, tags, aliases, revision };
      } catch {
        return null; // Bad or incomplete skills are not exposed.
      }
    }));
    return loaded.filter(Boolean).map((skill) => ({ ...skill, ...scoreSkill(skill, query) }))
      .filter((skill) => !query.trim() || skill.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(limit, MAX_SKILLS)))
      .map(({ score, reason, ...skill }) => skill);
  }

  async searchSkills(query, limit = 12) {
    if (typeof query !== "string" || !query.trim() || query.length > 200) {
      throw new Error("Provide a nonempty query (max 200 characters)");
    }
    const candidates = await this.listSkills();
    return candidates.map((skill) => ({ ...skill, ...scoreSkill(skill, query) }))
      .filter((skill) => skill.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(limit, 50)));
  }

  async readResource(name, relativePath) {
    const dir = await this.skillPath(name);
    if (typeof relativePath !== "string" || relativePath.length > 240) throw new Error("Invalid resource path");
    const parts = relativePath.replaceAll("\\", "/").split("/");
    if (parts.length < 2 || parts.length > 8 || !["references", "assets"].includes(parts[0]) ||
        parts.some((part) => !RESOURCE_PART.test(part) || part === "." || part === "..")) {
      throw new Error("Only files under references/ and assets/ are readable");
    }
    if (!RESOURCE_EXTENSIONS.has(path.extname(parts.at(-1)).toLowerCase())) {
      throw new Error("Only text resources are readable");
    }
    let current = dir;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Symlink access is blocked");
      if (i < parts.length - 1 && !stat.isDirectory()) throw new Error("Invalid resource directory");
      if (i === parts.length - 1 && (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES)) {
        throw new Error("Resource is unavailable or too large");
      }
    }
    return { skill: name, path: parts.join("/"), text: await readLimitedText(current, dir, MAX_RESOURCE_BYTES) };
  }
}

export function parseMetadata(content) {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.md must start with YAML frontmatter");
  const meta = YAML.parse(match[1], { uniqueKeys: true });
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("Invalid frontmatter");
  if (typeof meta.name !== "string" || !SKILL_NAME.test(meta.name)) throw new Error("Invalid name");
  if (typeof meta.description !== "string" || meta.description.trim().length < 1 || meta.description.length > 1024) {
    throw new Error("Invalid description");
  }
  const strings = (v) => Array.isArray(v)
    ? v.filter((item) => typeof item === "string" && item.length <= 80).slice(0, 24)
    : [];
  return { name: meta.name, description: meta.description,
    tags: strings(meta.tags), aliases: strings(meta.aliases) };
}
