import { performance } from "node:perf_hooks";
import path from "node:path";
import { SkillRegistry } from "../src/registry.mjs";

const dir = process.argv[2] || path.join(process.cwd(), "skill-library");
const registry = new SkillRegistry(dir);
const start = performance.now();
const skills = await registry.listSkills();
const coldMs = performance.now() - start;
const second = performance.now();
await registry.listSkills();
const warmMs = performance.now() - second;
const search = performance.now();
const results = await registry.searchSkills("設計", 10);
const searchMs = performance.now() - search;
// Only counts/timing: no private skill text or names are printed.
console.log(JSON.stringify({
  count: skills.length,
  cold_ms: +coldMs.toFixed(1),
  warm_ms: +warmMs.toFixed(1),
  search_ms: +searchMs.toFixed(1),
  search_matches: results.length
}));
