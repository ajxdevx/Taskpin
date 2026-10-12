import path from "node:path";
import type { GitSignals } from "./git.js";
import { findGitRoot, isGitRepo } from "./git.js";
import { normalizeRelPath } from "./discovery.js";

export interface WorkspaceLayout {
  packRoot: string;
  gitRoot: string | null;
  scopePrefix: string;
  gitAvailable: boolean;
}

export async function resolveWorkspace(packRoot: string): Promise<WorkspaceLayout> {
  const resolved = path.resolve(packRoot);
  const gitRoot = await findGitRoot(resolved);
  const gitAvailable = gitRoot !== null;
  let scopePrefix = "";
  if (gitAvailable && gitRoot) {
    const rel = path.relative(gitRoot, resolved).replace(/\\/g, "/");
    scopePrefix = rel === "." ? "" : normalizeRelPath(rel);
  }
  return {
    packRoot: resolved,
    gitRoot,
    scopePrefix,
    gitAvailable,
  };
}

export function gitPathToPackRelative(
  gitRel: string,
  scopePrefix: string,
): string | null {
  const norm = normalizeRelPath(gitRel);
  if (!scopePrefix) return norm;
  const prefix = scopePrefix.endsWith("/")
    ? scopePrefix.slice(0, -1)
    : scopePrefix;
  if (norm === prefix) return null;
  if (norm.startsWith(`${prefix}/`)) {
    return norm.slice(prefix.length + 1);
  }
  return null;
}

export function filterPathsToScope(
  paths: string[],
  scopePrefix: string,
): string[] {
  if (!scopePrefix) {
    return paths.map((p) => normalizeRelPath(p));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const rel = gitPathToPackRelative(p, scopePrefix);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

export function scopeGitSignals(
  signals: GitSignals,
  scopePrefix: string,
): GitSignals {
  if (!scopePrefix) return signals;
  return {
    recent: filterPathsToScope(signals.recent, scopePrefix),
    branchDiff: filterPathsToScope(signals.branchDiff, scopePrefix),
    sinceDiff: filterPathsToScope(signals.sinceDiff, scopePrefix),
    pickaxe: filterPathsToScope(signals.pickaxe, scopePrefix),
    meta: signals.meta,
  };
}

export function resolvePackRoot(
  baseRoot: string,
  scope?: string,
): string {
  const base = path.resolve(baseRoot);
  if (!scope || !scope.trim()) return base;
  return path.resolve(base, scope.trim().replace(/\\/g, "/"));
}
