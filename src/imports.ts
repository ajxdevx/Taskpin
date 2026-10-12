import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveryContext } from "./discovery.js";
import { normalizeRelPath } from "./discovery.js";

const IMPORT_FROM =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g;
const IMPORT_SIDE = /import\s+["']([^"']+)["']/g;
const REQUIRE_RE = /require\s*\(\s*["']([^"']+)["']\s*\)/g;

const RESOLVE_EXT = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.mjs",
];

export function parseImportSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const re of [IMPORT_FROM, IMPORT_SIDE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1]?.trim();
      if (spec) specs.add(spec);
    }
  }
  return [...specs];
}

function aliasSpec(spec: string): string {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  return spec;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function resolveImportSpecifier(
  root: string,
  fromRel: string,
  specifier: string,
): Promise<string | null> {
  const spec = aliasSpec(specifier);
  if (!spec.startsWith(".")) return null;
  const fromDir = path.dirname(fromRel);
  const absBase = path.resolve(root, fromDir, spec);
  for (const suffix of RESOLVE_EXT) {
    const candidate = normalizeRelPath(
      path.relative(root, `${absBase}${suffix}`),
    );
    if (!candidate || candidate.startsWith("..")) continue;
    if (await fileExists(path.join(root, candidate))) return candidate;
  }
  return null;
}

export async function importNeighborScores(
  seeds: string[],
  root: string,
  discovery: DiscoveryContext,
  task: string,
  maxHops = 2,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const visited = new Set<string>();
  let frontier = [...new Set(seeds.map(normalizeRelPath))];

  for (let hop = 1; hop <= maxHops; hop++) {
    const hopScore = hop === 1 ? 44 : 28;
    const next: string[] = [];
    for (const rel of frontier) {
      if (visited.has(rel)) continue;
      visited.add(rel);
      const abs = path.join(root, rel);
      let source: string;
      try {
        source = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      const specs = parseImportSpecifiers(source);
      for (const spec of specs) {
        const resolved = await resolveImportSpecifier(root, rel, spec);
        if (!resolved || visited.has(resolved)) continue;
        const verdict = discovery.pathVerdict(resolved, task);
        if (!verdict.packable) continue;
        scores.set(resolved, Math.max(scores.get(resolved) ?? 0, hopScore));
        next.push(resolved);
      }
    }
    frontier = next;
  }
  return scores;
}
