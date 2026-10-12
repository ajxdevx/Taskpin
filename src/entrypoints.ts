import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveryContext } from "./discovery.js";
import { normalizeRelPath } from "./discovery.js";
import type { ParsedTask } from "./task.js";

const CONFIG_TASK =
  /\b(build|deploy|auth|config|vite|webpack|docker|ci|test|lint|package|npm|yarn|pnpm|tsconfig|eslint|prettier|astro|next|vitest|jest|pytest|cargo|go\s*mod|composer)\b/i;

const CONFIG_CANDIDATES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "vite.config.ts",
  "vite.config.mts",
  "vitest.config.ts",
  "vitest.config.mts",
  "jest.config.js",
  "jest.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "astro.config.mjs",
  "astro.config.ts",
  "webpack.config.js",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".github/workflows/ci.yml",
];

export function taskWantsEntrypoints(parsed: ParsedTask): boolean {
  if (CONFIG_TASK.test(parsed.raw)) return true;
  for (const k of parsed.keywords) {
    if (CONFIG_TASK.test(k)) return true;
  }
  return false;
}

export async function entrypointScores(
  parsed: ParsedTask,
  root: string,
  discovery: DiscoveryContext,
  task: string,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!taskWantsEntrypoints(parsed)) return scores;

  for (const rel of CONFIG_CANDIDATES) {
    const norm = normalizeRelPath(rel);
    const verdict = discovery.pathVerdict(norm, task);
    if (!verdict.packable) continue;
    try {
      const stat = await fs.stat(path.join(root, norm));
      if (!stat.isFile()) continue;
      scores.set(norm, 55);
    } catch {
    }
  }
  return scores;
}
