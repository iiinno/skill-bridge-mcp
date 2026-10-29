import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import YAML from "yaml";

// Markdown is the source of truth. No vectors, inference API, SQLite or daemon.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = ["pending", "active", "archived"];
const KINDS = ["decision", "constraint", "lesson", "project", "reference", "conversation-summary"];
const SOURCES = ["chatgpt", "user", "github", "codex", "dsh", "other"];
const MAX_NOTES = 10000;
const MAX_BYTES = 30000;
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const clamp = (n, limit) => Math.max(1, Math.min(limit, Number.isInteger(n) ? n : limit));
const normalize = (v) => String(v).normalize("NFKC").toLocaleLowerCase("en").trim();
const stringField = (v, label, limit, required = true) => {
  if (typeof v !== "string" || (required && !v.trim()) || v.length > limit) {
    throw new Error("Invalid " + label);
  }
  return v.trim();
};

function fields(input) {
  const title = stringField(input.title, "title", 180);
  const content = stringField(input.content, "content", 20000);
  const kind = stringField(input.kind, "kind", 40);
  const source = stringField(input.source, "source", 40);
  const sourceRef = stringField(input.source_ref ?? "", "source_ref", 500, false);
  const tags = input.tags ?? [];
  if (title.length < 2) throw new Error("Invalid title");
  if (content.length < 5) throw new Error("Invalid content");
  if (!KINDS.includes(kind) || !SOURCES.includes(source) ||
      !Array.isArray(tags) || tags.length > 16 ||
      tags.some((v) => typeof v !== "string" || !v.trim() || v.length > 50)) {
    throw new Error("Invalid memory metadata");
  }
  return { title, content, kind, source, source_ref: sourceRef,
    tags: [...new Set(tags.map((tag) => tag.trim()))] };
}

function serialize(note) {
  const { content, ...meta } = note;
  const frontmatter = YAML.stringify(meta, { lineWidth: 0 });
  return "---\n" + frontmatter + "---\n\n" + content.trim() + "\n";
}

function parse(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Malformed memory Markdown");
  const meta = YAML.parse(match[1], { uniqueKeys: true });
  if (!meta || !ID.test(meta.id) || !STATES.includes(meta.status) ||
      !KINDS.includes(meta.kind) || !SOURCES.includes(meta.source) ||
      !Array.isArray(meta.tags) || !meta.tags.every((v) => typeof v === "string") ||
      typeof meta.title !== "string") {
    throw new Error("Invalid memory frontmatter");
  }
  return { ...meta, content: match[2].trim(), revision: digest(raw) };
}

function tokens(text) {
  const s = normalize(text);
  const words = new Set(s.match(/[\p{L}\p{N}_-]+/gu) || []);
  // CJK bigrams avoid requiring a tokenizer, dictionary or embedding service.
  for (const run of s.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || []) {
    for (let i = 0; i + 1 < run.length; i++) words.add(run.slice(i, i + 2));
  }
  return [...words].filter((w) => w.length >= 2).slice(0, 80);
}

function relevance(note, query) {
  const q = normalize(query);
  const text = normalize(note.content);
  const title = normalize(note.title);
  const tags = normalize(note.tags.join(" "));
  const keys = tokens(query);
  if (!keys.length) return 0;
  let score = 0;
  for (const term of keys) {
    if (title.includes(term)) score += 12;
    if (tags.includes(term)) score += 8;
    if (text.includes(term)) score += 2;
  }
  if (title.includes(q)) score += 15;
  if (text.includes(q)) score += 8;
  return score;
}

export class MarkdownMemory {
  constructor(root) {
    this.root = root ? path.resolve(root) : "";
    this.cache = new Map();
  }
  get configured() { return Boolean(this.root); }
  location(status, id) {
    if (!STATES.includes(status) || !ID.test(id)) throw new Error("Invalid memory ID/status");
    return path.join(this.root, status, id + ".md");
  }
  async ensure() {
    if (!this.configured) throw new Error("Markdown Memory is not configured");
    for (const directory of [this.root, ...STATES.map((s) => path.join(this.root, s)),
      path.join(this.root, ".history"), path.join(this.root, ".locks")]) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Memory path is not a real directory");
    }
  }
  async read(status, id) {
    const filename = this.location(status, id);
    const st = await fs.lstat(filename);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_BYTES) {
      throw new Error("Memory file unavailable or exceeds size limit");
    }
    const fingerprint = [st.ino, st.size, st.mtimeMs, st.ctimeMs].join(":");
    const old = this.cache.get(filename);
    if (old?.fingerprint === fingerprint) return old.note;
    const raw = await fs.readFile(filename, "utf8");
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("Memory file too large");
    const note = parse(raw);
    if (note.id !== id || note.status !== status) throw new Error("Memory path and metadata disagree");
    this.cache.set(filename, { fingerprint, note });
    return note;
  }
  async list(status = "active", limit = 30) {
    await this.ensure();
    if (!STATES.includes(status)) throw new Error("Invalid status");
    const names = (await fs.readdir(path.join(this.root, status)))
      .filter((name) => name.endsWith(".md") && ID.test(name.slice(0, -3)));
    if (names.length > MAX_NOTES) throw new Error("Memory index limit exceeded");
    const out = [];
    for (const name of names) {
      try { out.push(await this.read(status, name.slice(0, -3))); } catch { /* invalid files never leave the directory */ }
    }
    return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, clamp(limit, 100)).map(({ content, ...meta }) => meta);
  }
  async search(query, limit = 10) {
    await this.ensure();
    if (typeof query !== "string" || query.trim().length < 2 || query.length > 240) {
      throw new Error("Query must be 2-240 characters");
    }
    const names = (await fs.readdir(path.join(this.root, "active")))
      .filter((n) => n.endsWith(".md") && ID.test(n.slice(0, -3)));
    if (names.length > MAX_NOTES) throw new Error("Memory index limit exceeded");
    const found = [];
    for (const name of names) {
      try {
        const note = await this.read("active", name.slice(0, -3));
        const score = relevance(note, query);
        if (score) found.push({ id: note.id, title: note.title, kind: note.kind,
          source: note.source, source_ref: note.source_ref, tags: note.tags,
          revision: note.revision, updated_at: note.updated_at,
          snippet: note.content.slice(0, 600), score });
      } catch { /* preserve other valid notes */ }
    }
    return found.sort((a, b) => b.score - a.score ||
      b.updated_at.localeCompare(a.updated_at)).slice(0, clamp(limit, 30));
  }
  async create(input, { status = "pending" } = {}) {
    await this.ensure();
    if (!["pending", "active"].includes(status)) throw new Error("Invalid initial status");
    const info = fields(input);
    const contentHash = digest(JSON.stringify(info));
    // Idempotent reruns are common in agent tools: prevent exact duplicates.
    for (const s of ["pending", "active"]) {
      const names = (await fs.readdir(path.join(this.root, s)))
        .filter((n) => n.endsWith(".md") && ID.test(n.slice(0, -3)));
      for (const name of names.slice(0, MAX_NOTES)) {
        try {
          const n = await this.read(s, name.slice(0, -3));
          if (n.content_hash === contentHash) {
            return { id: n.id, status: s, revision: n.revision, duplicate: true };
          }
        } catch { /* no overwrite */ }
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const note = { schema: 1, id, status, ...info, content_hash: contentHash,
      created_at: now, updated_at: now };
    const raw = serialize(note);
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("Memory exceeds file limit");
    await fs.writeFile(this.location(status, id), raw, { flag: "wx", mode: 0o600 });
    return { id, status, revision: digest(raw), duplicate: false };
  }
  async mutate(id, expectedRevision, action, changes = {}) {
    await this.ensure();
    if (!ID.test(id) || !/^[0-9a-f]{16}$/.test(expectedRevision)) {
      throw new Error("Invalid ID/revision");
    }
    if (!["approve", "archive", "update"].includes(action)) throw new Error("Invalid action");
    const lock = path.join(this.root, ".locks", id + ".lock");
    const lockHandle = await fs.open(lock, "wx", 0o600); // serialize writes
    let temp = "";
    try {
      const from = action === "approve" ? "pending" : "active";
      const old = await this.read(from, id);
      if (old.revision !== expectedRevision) throw new Error("Revision conflict; reload current memory");
      const to = action === "approve" ? "active" : action === "archive" ? "archived" : "active";
      let nextFields;
      if (action === "update") {
        // Keep origin immutable, and only allow title/content/tags to change.
        nextFields = fields({ ...old, ...changes, source: old.source, source_ref: old.source_ref,
          kind: old.kind });
      } else {
        nextFields = fields(old);
      }
      const next = { schema: 1, id, status: to, ...nextFields,
        content_hash: digest(JSON.stringify(nextFields)),
        created_at: old.created_at, updated_at: new Date().toISOString() };
      const sourcePath = this.location(from, id);
      const target = this.location(to, id);
      if (from !== to) {
        try { await fs.lstat(target); throw new Error("Destination memory already exists"); }
        catch (err) { if (err.code !== "ENOENT") throw err; }
      }
      const original = await fs.readFile(sourcePath, "utf8");
      if (digest(original) !== old.revision) throw new Error("Concurrent memory edit detected");
      const historyPath = path.join(this.root, ".history", id + "-" + old.revision + ".md");
      await fs.writeFile(historyPath, original, { flag: "wx", mode: 0o600 });
      const raw = serialize(next);
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("Memory exceeds file limit");
      temp = path.join(this.root, to, "." + id + "." + randomUUID() + ".tmp");
      await fs.writeFile(temp, raw, { flag: "wx", mode: 0o600 });
      await fs.rename(temp, target);
      temp = "";
      if (from !== to) await fs.unlink(sourcePath);
      this.cache.delete(sourcePath);
      this.cache.delete(target);
      return { id, status: to, revision: digest(raw), previous_revision: old.revision };
    } finally {
      if (temp) await fs.rm(temp, { force: true }).catch(() => {});
      await lockHandle.close();
      await fs.rm(lock, { force: true });
    }
  }
}
