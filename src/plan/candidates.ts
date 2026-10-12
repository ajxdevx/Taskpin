import fs from "node:fs/promises";
import path from "node:path";
import type { GitSignals } from "../git.js";
import type { parseTask } from "../task.js";
import type { runContentSearch } from "../search.js";

export const ALWAYS_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  ".cursor/rules",
];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function collectRuleFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const rulesDir = path.join(root, ".cursor", "rules");
  if (await exists(rulesDir)) {
    try {
      const entries = await fs.readdir(rulesDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) {
          out.push(path.join(".cursor", "rules", e.name).replace(/\\/g, "/"));
        }
      }
    } catch {
    }
  }
  for (const f of ALWAYS_CANDIDATES) {
    if (f === ".cursor/rules") continue;
    if (await exists(path.join(root, f))) out.push(f);
  }
  return out;
}

export function buildChangedAllowlist(
  ruleFiles: string[],
  gitSignals: GitSignals,
  pathHitKeys: string[],
): Set<string> {
  return new Set<string>([
    ...ruleFiles,
    ...gitSignals.branchDiff,
    ...gitSignals.pickaxe,
    ...pathHitKeys,
  ]);
}

export function collectGraphSeeds(
  parsed: ReturnType<typeof parseTask>,
  pathHitKeys: string[],
  search: Awaited<ReturnType<typeof runContentSearch>>,
  gitSignals: GitSignals,
): string[] {
  const seeds = new Set<string>();
  for (const p of parsed.paths) seeds.add(p);
  for (const f of pathHitKeys) seeds.add(f);
  for (const f of search.keyword.keys()) seeds.add(f);
  for (const f of search.phrase.keys()) seeds.add(f);
  for (const f of gitSignals.branchDiff.slice(0, 20)) seeds.add(f);
  for (const f of gitSignals.sinceDiff.slice(0, 25)) seeds.add(f);
  for (const f of gitSignals.pickaxe.slice(0, 10)) seeds.add(f);
  return [...seeds];
}
