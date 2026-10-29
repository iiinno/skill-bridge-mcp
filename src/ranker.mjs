// Deterministic offline search over SKILL.md frontmatter.
// Avoids a paid embedding API and keeps private skill text on the user's host.
const synonyms = new Map([
  ["レビュー", ["review", "audit", "inspect"]],
  ["調査", ["research", "search", "investigate"]],
  ["検索", ["search", "find", "discover"]],
  ["設計", ["design", "architecture", "architect"]],
  ["開発", ["develop", "code", "implementation"]],
  ["テスト", ["test", "testing", "verify"]],
  ["検証", ["verify", "test", "validation"]],
  ["資料", ["document", "docs", "report"]],
  ["文章", ["writing", "draft", "document"]],
  ["画像", ["image", "visual", "illustration"]],
  ["スキル", ["skill", "skills", "workflow"]],
  ["同期", ["sync", "synchronization", "backup"]],
  ["安全", ["security", "secure", "safety"]],
  ["自動化", ["automate", "automation", "workflow"]]
]);

function normalized(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("en");
}
export function scoreSkill(skill, query) {
  const raw = normalized(query).trim();
  if (!raw) return { score: 0, reason: "all" };
  const id = normalized(skill.id);
  const description = normalized(skill.description);
  const tags = (skill.tags || []).map(normalized);
  const aliases = (skill.aliases || []).map(normalized);
  if (id === raw || aliases.includes(raw)) return { score: 1000, reason: "exact" };
  const terms = new Set(raw.match(/[\p{L}\p{N}_-]+/gu) || []);
  for (const [jp, words] of synonyms) {
    if (raw.includes(jp)) words.forEach((word) => terms.add(word));
  }
  let score = 0;
  for (const term of [...terms].slice(0, 30)) {
    if (id === term) score += 250;
    else if (id.startsWith(term)) score += 150;
    else if (id.includes(term)) score += 110;
    else if (tags.some((v) => v === term || v.includes(term))) score += 115;
    else if (aliases.some((v) => v.includes(term))) score += 120;
    else if (description.includes(term)) score += 36;
  }
  if (id.includes(raw)) score += 240;
  if (description.includes(raw)) score += 100;
  return { score, reason: score > 0 ? "keyword" : "none" };
}
