import fs from "node:fs/promises";
import path from "node:path";
import { gitBlobShaForPath, gitHeadSha } from "./git.js";
import { PACK_SCHEMA_VERSION } from "./schema.js";
import type { ContextPack, PackReason } from "./types.js";

export const MANIFEST_VERSION = "1.0";
export const DEFAULT_MANIFEST_REL = ".taskpin/manifest.json";

export interface ManifestFileEntry {
  path: string;
  blobSha: string;
  storedContent: string;
  presentation: "full" | "slice" | "signature";
  tokens: number;
  score: number;
  reasons: PackReason[];
}

export interface PackSessionManifest {
  manifest_version: string;
  schema_version: string;
  root: string;
  task: string;
  head: string | null;
  budgetTokens: number;
  generatedAt: string;
  files: ManifestFileEntry[];
}

export function defaultManifestPath(root: string): string {
  return path.join(path.resolve(root), DEFAULT_MANIFEST_REL);
}

export async function loadSessionManifest(
  manifestPath: string,
): Promise<PackSessionManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const doc = JSON.parse(raw) as PackSessionManifest;
    if (!doc || doc.manifest_version !== MANIFEST_VERSION) return null;
    if (!Array.isArray(doc.files)) return null;
    return doc;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function saveSessionManifest(
  manifestPath: string,
  manifest: PackSessionManifest,
): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export function manifestFileMap(
  manifest: PackSessionManifest,
): Map<string, ManifestFileEntry> {
  return new Map(manifest.files.map((f) => [f.path, f]));
}

export async function buildManifestFromPack(
  pack: ContextPack,
  storedBodies: Map<string, { blobSha: string; storedContent: string }>,
): Promise<PackSessionManifest> {
  const head = await gitHeadSha(pack.root);
  const files: ManifestFileEntry[] = [];
  for (const f of pack.files) {
    const body = storedBodies.get(f.path);
    const blobSha =
      body?.blobSha ??
      (await gitBlobShaForPath(pack.root, f.path)) ??
      "unknown";
    const storedContent = body?.storedContent ?? f.content;
    files.push({
      path: f.path,
      blobSha,
      storedContent,
      presentation: f.presentation,
      tokens: f.tokens,
      score: f.score,
      reasons: f.reasons,
    });
  }
  return {
    manifest_version: MANIFEST_VERSION,
    schema_version: PACK_SCHEMA_VERSION,
    root: pack.root,
    task: pack.task,
    head,
    budgetTokens: pack.budgetTokens,
    generatedAt: pack.generatedAt,
    files,
  };
}

export function manifestMatchesTask(
  manifest: PackSessionManifest,
  task: string,
  root: string,
): boolean {
  return (
    manifest.task.trim() === task.trim() &&
    path.resolve(manifest.root) === path.resolve(root)
  );
}
