import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitContextMeta {
  branch: string | null;
  base: string | null;
  since: string | null;
  head: string | null;
}

export interface GitSignals {
  recent: string[];
  branchDiff: string[];
  sinceDiff: string[];
  pickaxe: string[];
  meta: GitContextMeta;
}

function normalizeGitPath(line: string): string | null {
  const p = line.trim().replace(/\\/g, "/");
  if (!p || p.startsWith(".git/") || p === ".git") return null;
  return p;
}

function uniquePaths(lines: string[], limit: number): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const line of lines) {
    const p = normalizeGitPath(line);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    ordered.push(p);
    if (ordered.length >= limit) break;
  }
  return ordered;
}

async function gitOutput(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

export async function findGitRoot(start: string): Promise<string | null> {
  try {
    const out = await gitOutput(path.resolve(start), [
      "rev-parse",
      "--show-toplevel",
    ]);
    const top = out.trim();
    return top ? path.resolve(top) : null;
  } catch {
    return null;
  }
}

export async function resolveDefaultBase(root: string): Promise<string | null> {
  for (const ref of ["main", "master", "develop"]) {
    try {
      await execFileAsync(
        "git",
        ["-C", root, "rev-parse", "--verify", ref],
        { encoding: "utf8" },
      );
      return ref;
    } catch {
    }
  }
  try {
    const upstream = await gitOutput(root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    const trimmed = upstream.trim();
    if (trimmed.includes("/")) {
      return trimmed.split("/").slice(1).join("/");
    }
  } catch {
  }
  return null;
}

export async function currentBranch(root: string): Promise<string | null> {
  try {
    const name = await gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const b = name.trim();
    if (!b || b === "HEAD") return null;
    return b;
  } catch {
    return null;
  }
}

export async function gitRecentFiles(
  root: string,
  limit = 40,
): Promise<string[]> {
  try {
    const stdout = await gitOutput(root, [
      "log",
      "-n",
      "30",
      "--name-only",
      "--pretty=format:",
    ]);
    return uniquePaths(stdout.split(/\r?\n/), limit);
  } catch {
    return [];
  }
}

export async function gitRevParse(
  root: string,
  ref: string,
): Promise<string | null> {
  try {
    const out = await gitOutput(root, ["rev-parse", ref]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function gitHeadSha(root: string): Promise<string | null> {
  return gitRevParse(root, "HEAD");
}

export async function gitBlobShaForPath(
  root: string,
  relPath: string,
): Promise<string | null> {
  try {
    const out = await gitOutput(root, ["hash-object", relPath]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function gitFilesSince(
  root: string,
  sinceRef: string,
  limit = 80,
): Promise<string[]> {
  try {
    const sinceSha = await gitRevParse(root, sinceRef);
    if (!sinceSha) return [];
    const stdout = await gitOutput(root, [
      "diff",
      "--name-only",
      `${sinceSha}..HEAD`,
    ]);
    const unstaged = await gitOutput(root, ["diff", "--name-only", "HEAD"]);
    const lines = [...stdout.split(/\r?\n/), ...unstaged.split(/\r?\n/)];
    return uniquePaths(lines, limit);
  } catch {
    return [];
  }
}

export async function gitBranchDiffFiles(
  root: string,
  base: string,
  limit = 60,
): Promise<string[]> {
  try {
    const stdout = await gitOutput(root, [
      "diff",
      "--name-only",
      `${base}...HEAD`,
    ]);
    const unstaged = await gitOutput(root, ["diff", "--name-only", "HEAD"]);
    const lines = [...stdout.split(/\r?\n/), ...unstaged.split(/\r?\n/)];
    return uniquePaths(lines, limit);
  } catch {
    try {
      const stdout = await gitOutput(root, ["diff", "--name-only", base]);
      return uniquePaths(stdout.split(/\r?\n/), limit);
    } catch {
      return [];
    }
  }
}

export async function gitPickaxeFiles(
  root: string,
  symbols: string[],
  limit = 30,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols.slice(0, 4)) {
    if (symbol.length < 3) continue;
    try {
      const stdout = await gitOutput(root, [
        "log",
        "-S",
        symbol,
        "-n",
        "25",
        "--name-only",
        "--pretty=format:",
      ]);
      for (const line of stdout.split(/\r?\n/)) {
        const p = normalizeGitPath(line);
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push(p);
        if (out.length >= limit) return out;
      }
    } catch {
    }
  }
  return out;
}

export async function collectGitSignals(
  root: string,
  symbols: string[],
  baseOverride?: string,
  sinceRef?: string,
): Promise<GitSignals> {
  const empty: GitSignals = {
    recent: [],
    branchDiff: [],
    sinceDiff: [],
    pickaxe: [],
    meta: { branch: null, base: null, since: null, head: null },
  };
  if (!(await isGitRepo(root))) return empty;

  const branch = await currentBranch(root);
  const base = baseOverride ?? (await resolveDefaultBase(root));
  const head = await gitHeadSha(root);
  const since = sinceRef?.trim() || null;
  const [recent, branchDiff, sinceDiff, pickaxe] = await Promise.all([
    gitRecentFiles(root),
    base ? gitBranchDiffFiles(root, base) : Promise.resolve([]),
    since ? gitFilesSince(root, since) : Promise.resolve([]),
    gitPickaxeFiles(root, symbols),
  ]);

  return {
    recent,
    branchDiff,
    sinceDiff,
    pickaxe,
    meta: { branch, base, since, head },
  };
}
