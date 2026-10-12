import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveryContext } from "./discovery.js";
import { normalizeRelPath } from "./discovery.js";

function guessTestPaths(sourceRel: string): string[] {
  const norm = normalizeRelPath(sourceRel);
  const dir = path.dirname(norm);
  const base = path.basename(norm);
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? ".ts" : base.slice(dot);
  const inDir = dir === "." ? "" : `${dir}/`;
  const candidates = [
    `${inDir}${stem}.test${ext}`,
    `${inDir}${stem}.spec${ext}`,
    `${inDir}__tests__/${stem}.test${ext}`,
    `${inDir}__tests__/${stem}.spec${ext}`,
    `__tests__/${inDir}${stem}.test${ext}`,
    `tests/${inDir}${stem}.test${ext}`,
    `tests/${stem}.test${ext}`,
    `tests/${stem}.spec${ext}`,
  ];
  return candidates.map((c) => normalizeRelPath(c.replace(/^\.\//, "")));
}

export async function testPairScores(
  seeds: string[],
  root: string,
  discovery: DiscoveryContext,
  task: string,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const seen = new Set<string>();
  for (const seed of seeds) {
    const norm = normalizeRelPath(seed);
    if (norm.includes(".test.") || norm.includes(".spec.")) continue;
    if (norm.includes("__tests__")) continue;
    for (const candidate of guessTestPaths(norm)) {
      if (seen.has(candidate)) continue;
      const verdict = discovery.pathVerdict(candidate, task);
      if (!verdict.packable) continue;
      const abs = path.join(root, candidate);
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      seen.add(candidate);
      scores.set(candidate, 52);
    }
  }
  return scores;
}
