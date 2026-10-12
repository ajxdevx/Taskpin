import fs from "node:fs/promises";
import path from "node:path";
import { createDiscoveryContext } from "./discovery.js";
import { gitHeadSha } from "./git.js";
import { runPool } from "./pool.js";
import { walkPackableFiles } from "./walk.js";

export const FILE_INDEX_VERSION = "1.0";
export const DEFAULT_FILE_INDEX_REL = ".taskpin/file-index.json";

export interface FileIndexEntry {
  size: number;
  mtimeMs: number;
}

export interface PackFileIndex {
  index_version: string;
  root: string;
  builtAt: string;
  head: string | null;
  fileCount: number;
  files: Record<string, FileIndexEntry>;
}

export function defaultFileIndexPath(root: string): string {
  return path.join(path.resolve(root), DEFAULT_FILE_INDEX_REL);
}

export async function loadFileIndex(
  indexPath: string,
): Promise<PackFileIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const doc = JSON.parse(raw) as PackFileIndex;
    if (doc?.index_version !== FILE_INDEX_VERSION) return null;
    if (!doc.files || typeof doc.files !== "object") return null;
    return doc;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function saveFileIndex(
  indexPath: string,
  index: PackFileIndex,
): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

export async function buildFileIndex(
  root: string,
  task = "index",
): Promise<PackFileIndex> {
  const absRoot = path.resolve(root);
  const discovery = await createDiscoveryContext(absRoot);
  const paths = await walkPackableFiles(discovery, task);
  const files: Record<string, FileIndexEntry> = {};

  await runPool(paths, 32, async (rel) => {
    const stat = await fs.stat(path.join(absRoot, rel));
    files[rel] = { size: stat.size, mtimeMs: stat.mtimeMs };
  });

  const head = await gitHeadSha(absRoot);
  return {
    index_version: FILE_INDEX_VERSION,
    root: absRoot,
    builtAt: new Date().toISOString(),
    head,
    fileCount: paths.length,
    files,
  };
}

export interface StaleReport {
  indexPath: string;
  indexBuiltAt: string;
  added: string[];
  changed: string[];
  removed: string[];
  headDrift: boolean;
}

export async function computeStaleReport(
  root: string,
  index: PackFileIndex,
): Promise<StaleReport> {
  const absRoot = path.resolve(root);
  const discovery = await createDiscoveryContext(absRoot);
  const task = "index";
  const current = new Set(await walkPackableFiles(discovery, task));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const rel of current) {
    if (!index.files[rel]) {
      added.push(rel);
      continue;
    }
    const entry = index.files[rel];
    try {
      const stat = await fs.stat(path.join(absRoot, rel));
      if (stat.size !== entry.size || stat.mtimeMs !== entry.mtimeMs) {
        changed.push(rel);
      }
    } catch {
      changed.push(rel);
    }
  }

  for (const rel of Object.keys(index.files)) {
    if (!current.has(rel)) removed.push(rel);
  }

  const head = await gitHeadSha(absRoot);
  const headDrift = Boolean(index.head && head && index.head !== head);

  return {
    indexPath: defaultFileIndexPath(absRoot),
    indexBuiltAt: index.builtAt,
    added,
    changed,
    removed,
    headDrift,
  };
}

export async function indexReadyForPathMatch(
  root: string,
  indexPath: string,
): Promise<{ paths: string[] } | null> {
  const index = await loadFileIndex(indexPath);
  if (!index) return null;
  if (path.resolve(index.root) !== path.resolve(root)) return null;

  const head = await gitHeadSha(root);
  if (index.head && head && index.head !== head) return null;

  const absRoot = path.resolve(root);
  const discovery = await createDiscoveryContext(absRoot);
  const task = "index";

  for (const rel of Object.keys(index.files)) {
    const entry = index.files[rel];
    const verdict = discovery.pathVerdict(rel, task);
    if (!verdict.packable) return null;
    try {
      const stat = await fs.stat(path.join(absRoot, rel));
      if (stat.size !== entry.size || stat.mtimeMs !== entry.mtimeMs) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return { paths: Object.keys(index.files) };
}

export function formatStaleReport(report: StaleReport): string {
  const lines = [
    `# Index stale report`,
    ``,
    `**Index built:** ${report.indexBuiltAt}`,
    `**HEAD drift:** ${report.headDrift ? "yes (re-run taskpin index)" : "no"}`,
    `**Added:** ${report.added.length} · **Changed:** ${report.changed.length} · **Removed:** ${report.removed.length}`,
    ``,
  ];
  const show = (title: string, paths: string[]) => {
    if (paths.length === 0) return;
    lines.push(`## ${title}`, ``);
    for (const p of paths.slice(0, 80)) lines.push(`- \`${p}\``);
    if (paths.length > 80) {
      lines.push(`- … and ${paths.length - 80} more`);
    }
    lines.push(``);
  };
  show("Added", report.added);
  show("Changed", report.changed);
  show("Removed", report.removed);
  if (
    report.added.length === 0 &&
    report.changed.length === 0 &&
    report.removed.length === 0 &&
    !report.headDrift
  ) {
    lines.push(`Index matches the working tree.`);
  }
  return lines.join("\n");
}
