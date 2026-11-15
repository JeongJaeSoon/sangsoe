// Decision 265: derives the permissions.allow rules from what sangsoe runs.
//   node scripts/gen-permissions.ts            prints core/install/permissions.generated.ts
//   node scripts/gen-permissions.ts --check    exits 1 when the checked-in file differs or a command is unclassified
//   node scripts/gen-permissions.ts --explain  prints every hit with its file:line
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { derive, renderGenerated } from "./permissions/derive.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const d = derive(root);
const problems = [
  ...d.unclassified.map((h) => `${h.file}:${h.line} runs "${h.path}", which scripts/permissions/policy.ts does not classify`),
  ...d.unlisted.map((u) => `${u.file}:${u.line} runs "${u.key}" in code, which is not in policy.ts (ORCA_POLICY or OTHER_EXEC)`),
  ...d.stale.map((s) => `policy.ts names "${s}", which no source runs`),
];

const mode = process.argv[2];
if (mode === "--explain") {
  for (const h of d.hits) console.log(`${h.file}:${h.line}\t${h.origin}\t${h.path}`);
  for (const r of d.rules) console.log(`rule\t${r.rule}\t${r.source}`);
} else if (mode === "--check") {
  if (readFileSync(`${root}core/install/permissions.generated.ts`, "utf8") !== renderGenerated(d)) problems.push("core/install/permissions.generated.ts is not what the sources derive: run node scripts/gen-permissions.ts and replace it");
} else process.stdout.write(renderGenerated(d));

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
