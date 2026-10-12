import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveryContext } from "./discovery.js";
import { normalizeRelPath } from "./discovery.js";
import { isTextCandidate } from "./files.js";
import { runPool } from "./pool.js";

const DIR_CONCURRENCY = 10;
const FILE_VERIFY_CONCURRENCY = 24;

export async function walkPackableFiles(
  discovery: DiscoveryContext,
  task: string,
): Promise<string[]> {
  const root = discovery.root;
  const out: string[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirs: Array<{ abs: string; rel: string }> = [];
    const fileEntries: Array<{ abs: string; rel: string }> = [];

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const norm = normalizeRelPath(rel);
      if (entry.isDirectory()) {
        if (!discovery.traverseAllowed(norm)) continue;
        subdirs.push({ abs: path.join(absDir, entry.name), rel: norm });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isTextCandidate(norm)) continue;
      const verdict = discovery.pathVerdict(norm, task);
      if (!verdict.packable) continue;
      fileEntries.push({ abs: path.join(absDir, entry.name), rel: norm });
    }

    const verified = await runPool(
      fileEntries,
      FILE_VERIFY_CONCURRENCY,
      async (item) => {
        const readable = await discovery.verifyReadable(
          item.abs,
          item.rel,
          task,
        );
        return readable.packable ? item.rel : null;
      },
    );
    for (const rel of verified) {
      if (rel) out.push(rel);
    }

    await runPool(subdirs, DIR_CONCURRENCY, async (item) => {
      await walk(item.abs, item.rel);
    });
  }

  await walk(root, "");
  return out;
}
