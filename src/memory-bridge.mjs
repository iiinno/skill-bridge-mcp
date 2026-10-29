import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const MAX_TITLE = 180;
const MAX_CONTENT = 10000;
const KINDS = new Set(["decision", "constraint", "lesson", "project", "reference", "conversation-summary"]);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = (value) => createHash("sha256").update(value).digest("hex");
const ALLOWED_SOURCE = new Set(["chatgpt", "user", "github", "other"]);

function sanitizedFields(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid memory candidate");
  const title = String(input.title || "").trim();
  const content = String(input.content || "").trim();
  const kind = String(input.kind || "").trim();
  const source = String(input.source || "").trim();
  const sourceRef = String(input.source_ref || "").trim();
  const tags = input.tags ?? [];
  if (title.length < 2 || title.length > MAX_TITLE || content.length < 5 ||
      content.length > MAX_CONTENT) throw new Error("Invalid title/content length");
  if (!KINDS.has(kind) || !ALLOWED_SOURCE.has(source) || sourceRef.length > 500 ||
      !Array.isArray(tags) || tags.length > 12 ||
      tags.some((tag) => typeof tag !== "string" || tag.length < 1 || tag.length > 48)) {
    throw new Error("Invalid memory metadata");
  }
  return { title, content, kind, source, source_ref: sourceRef, tags: [...new Set(tags)] };
}

async function loadJson(file) {
  const data = await fs.readFile(file, "utf8");
  if (Buffer.byteLength(data) > 30000) throw new Error("Memory record exceeds size limit");
  return JSON.parse(data);
}

export class MemoryBridge {
  constructor(root) {
    this.root = root ? path.resolve(root) : null;
  }
  get configured() { return Boolean(this.root); }
  async ensure() {
    if (!this.configured) throw new Error("Memory Bridge not configured");
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const st = await fs.lstat(this.root);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("Memory store must be a real directory");
    for (const type of ["pending", "approved", "rejected"]) {
      const dest = path.join(this.root, type);
      await fs.mkdir(dest, { mode: 0o700, recursive: true });
      const sub = await fs.lstat(dest);
      if (!sub.isDirectory() || sub.isSymbolicLink()) throw new Error("Invalid memory store directory");
    }
  }
  file(kind, id) {
    if (!["pending", "approved", "rejected"].includes(kind) || !ID.test(id)) {
      throw new Error("Invalid memory record ID");
    }
    return path.join(this.root, kind, id + ".json");
  }
  async propose(input) {
    await this.ensure();
    const fields = sanitizedFields(input);
    const digest = HASH(JSON.stringify(fields));
    // Dedup only over previously stored proposals/approved items. No database required.
    for (const folder of ["pending", "approved"]) {
      const existing = await fs.readdir(path.join(this.root, folder));
      for (const name of existing.slice(0, 10000)) {
        if (!name.endsWith(".json") || !ID.test(name.slice(0, -5))) continue;
        try {
          const record = await loadJson(path.join(this.root, folder, name));
          if (record.digest === digest) {
            return { id: record.id, status: record.status, duplicate: true };
          }
        } catch { /* corrupt or inaccessible record is ignored, never overwritten */ }
      }
    }
    const id = randomUUID();
    const record = { schema: 1, id, status: "pending", digest,
      created_at: new Date().toISOString(), ...fields };
    await fs.writeFile(this.file("pending", id), JSON.stringify(record, null, 2),
      { flag: "wx", mode: 0o600 });
    return { id, status: "pending", duplicate: false, title: fields.title,
      note: "This is a candidate only. It is NOT saved to AgentMemory; local review is required." };
  }
  async list(kind = "pending", limit = 30) {
    await this.ensure();
    if (!["pending", "approved"].includes(kind)) throw new Error("Invalid status filter");
    const names = (await fs.readdir(path.join(this.root, kind))).filter((n) => ID.test(n.slice(0, -5)) && n.endsWith(".json"));
    const results = [];
    for (const name of names.slice(0, 2000)) {
      try {
        const r = await loadJson(path.join(this.root, kind, name));
        results.push({ id: r.id, title: r.title, kind: r.kind, status: r.status,
          tags: r.tags, created_at: r.created_at });
      } catch { /* no arbitrary file reads */ }
    }
    return results.sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.min(100, Math.max(1, limit)));
  }
  async search(query, limit = 8) {
    await this.ensure();
    const q = String(query || "").trim().toLocaleLowerCase();
    if (q.length < 2 || q.length > 200) throw new Error("Query must be 2-200 characters");
    const names = (await fs.readdir(path.join(this.root, "approved"))).filter((n) => n.endsWith(".json"));
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 12);
    const hits = [];
    for (const name of names.slice(0, 2000)) {
      if (!ID.test(name.slice(0, -5))) continue;
      try {
        const r = await loadJson(path.join(this.root, "approved", name));
        const title = r.title.toLocaleLowerCase();
        const body = r.content.toLocaleLowerCase();
        const tags = r.tags.join(" ").toLocaleLowerCase();
        let score = 0;
        for (const term of terms) {
          if (title.includes(term)) score += 6;
          if (tags.includes(term)) score += 4;
          if (body.includes(term)) score += 2;
        }
        if (score) hits.push({ id: r.id, title: r.title, content: r.content,
          kind: r.kind, source: r.source, source_ref: r.source_ref, tags: r.tags, score });
      } catch { /* skip unreadable content */ }
    }
    return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(limit, 20)));
  }
  async review(id, action) {
    await this.ensure();
    if (!["approve", "reject"].includes(action)) throw new Error("Invalid review action");
    const record = await loadJson(this.file("pending", id));
    if (record.status !== "pending" || record.id !== id) throw new Error("Not a pending record");
    const destination = action === "approve" ? "approved" : "rejected";
    const next = { ...record, status: destination,
      reviewed_at: new Date().toISOString() };
    // Create destination first; the source is removed only after a complete write.
    await fs.writeFile(this.file(destination, id), JSON.stringify(next, null, 2),
      { flag: "wx", mode: 0o600 });
    await fs.unlink(this.file("pending", id));
    return { id, status: destination, title: record.title };
  }
}
