import path from "node:path";
import os from "node:os";
import { applyProposal } from "../src/apply-proposal.mjs";

const args = process.argv.slice(2);
const file = args.find((x) => !x.startsWith("--"));
if (!file || args.includes("--help")) {
  console.log("Usage: node scripts/apply-skill-edit.mjs proposal.json [--apply]");
  console.log("Defaults to dry-run. Run --apply only after reviewing the proposal and");
  console.log("ensuring Skills Manager is not simultaneously editing that skill.");
  process.exit(file ? 0 : 1);
}
const root = process.env.SKILLS_MANAGER_SKILLS_ROOT ||
  path.join(os.homedir(), ".skills-manager", "skills");
try {
  const result = await applyProposal(root, file, { apply: args.includes("--apply") });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Edit not applied:", error.message);
  process.exitCode = 1;
}
