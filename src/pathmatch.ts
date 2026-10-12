import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveryContext } from "./discovery.js";
import { normalizeRelPath } from "./discovery.js";
import type { ParsedTask } from "./task.js";
import { walkPackableFiles } from "./walk.js";

function basename(pathLike: string): string {
  const n = pathLike.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

function pathEndsWith(rel: string, suffix: string): boolean {
  const a = normalizeRelPath(rel).toLowerCase();
  const b = normalizeRelPath(suffix).toLowerCase();
  return a === b || a.endsWith(`/${b}`);
}

export async function pathMatchHits(
  parsed: ParsedTask,
  discovery: DiscoveryContext,
  task: string,
  options?: { packableFiles?: string[] },
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const root = discovery.root;

  for (const wanted of parsed.paths) {
    const norm = normalizeRelPath(wanted);
    const verdict = discovery.pathVerdict(norm, task);
    if (!verdict.packable) continue;
    const abs = path.join(root, norm);
    try {
      const stat = await fs.stat(abs);
      if (stat.isFile()) {
        scores.set(norm, Math.max(scores.get(norm) ?? 0, 95));
      }
    } catch {
    }
  }

  const wantFilenames = new Set(
    parsed.filenames.map((f) => f.toLowerCase()),
  );
  const wantStems = new Set(
    parsed.filenames
      .map((f) => f.replace(/\.[^.]+$/, "").toLowerCase())
      .filter((s) => s.length >= 2),
  );
  const wantPathSuffixes = parsed.paths.map((p) => normalizeRelPath(p));

  if (
    wantFilenames.size === 0 &&
    wantPathSuffixes.length === 0 &&
    parsed.paths.length === 0
  ) {
    return scores;
  }

  const files =
    options?.packableFiles ?? (await walkPackableFiles(discovery, task));
  for (const rel of files) {
    const base = basename(rel);
    const baseLower = base.toLowerCase();
    const stem = base.replace(/\.[^.]+$/, "").toLowerCase();

    for (const suffix of wantPathSuffixes) {
      if (pathEndsWith(rel, suffix)) {
        scores.set(rel, Math.max(scores.get(rel) ?? 0, 88));
      }
    }

    if (wantFilenames.has(baseLower)) {
      scores.set(rel, Math.max(scores.get(rel) ?? 0, 78));
    } else if (wantStems.has(stem) && stem.length >= 3) {
      scores.set(rel, Math.max(scores.get(rel) ?? 0, 58));
    }
  }

  return scores;
}
