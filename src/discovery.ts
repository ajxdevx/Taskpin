import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { isGitRepo } from "./git.js";

export const MAX_FILE_BYTES = 512_000;

export type SkipReason =
  | "ignored"
  | "deny-path"
  | "binary"
  | "oversized"
  | "lockfile"
  | "vendor";

export type PathVerdict =
  | { packable: true }
  | { packable: false; reason: SkipReason };

const DEFAULT_IGNORE = `
node_modules/
.git/
.taskpin/
dist/
build/
out/
.output/
.target/
.next/
.nuxt/
.astro/
coverage/
.nyc_output/
__pycache__/
.turbo/
.parcel-cache/
.svelte-kit/
*.min.js
*.map
.DS_Store
Thumbs.db
.env
.env.*
**/.env
**/.env.*
**/*.pem
**/*.p12
**/*.pfx
**/*.kdbx
**/id_rsa
**/id_rsa.*
**/id_dsa
**/id_ecdsa
**/id_ed25519
**/credentials.json
**/secrets.json
**/*-credentials.json
`;

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "gemfile.lock",
  "poetry.lock",
  "pipfile.lock",
  "cargo.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
]);

const DENY_BASENAMES = new Set([
  ".env",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

const DENY_BASENAME_PREFIXES = [".env."];

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|svg|avif|heic|mp3|mp4|mpe?g|wav|ogg|webm|mov|avi|mkv|flv|wmv|zip|tar|gz|bz2|xz|7z|rar|dmg|exe|dll|so|dylib|bin|dat|db|sqlite|sqlite3|woff2?|ttf|eot|otf|pdf|docx?|xlsx?|pptx?|class|jar|war|pyc|pyo|o|a|lib|wasm|pak)$/i;

const RG_EXTRA_DENY = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/id_rsa",
  "**/id_rsa.*",
  "**/node_modules/**",
  "**/.git/**",
  "**/vendor/**",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/composer.lock",
  "**/Gemfile.lock",
  "**/poetry.lock",
  "**/cargo.lock",
  "**/go.sum",
];

export function normalizeRelPath(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "");
}

function basename(rel: string): string {
  const n = normalizeRelPath(rel);
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

function taskAllowsLockfiles(task: string): boolean {
  return /\b(lockfiles?|lockfile|lock|deps|dependencies|npm|yarn|pnpm|bun|composer|poetry|cargo|gemfile|package\.json)\b/i.test(
    task,
  );
}

function taskAllowsVendor(task: string): boolean {
  return /\b(vendor|composer|php|laravel|symfony)\b/i.test(task);
}

function isLockfilePath(rel: string): boolean {
  return LOCKFILE_NAMES.has(basename(rel).toLowerCase());
}

function isVendorPath(rel: string): boolean {
  const n = normalizeRelPath(rel);
  if (n === "vendor" || n.startsWith("vendor/")) return true;
  return n.includes("/vendor/");
}

function isDenyBasename(rel: string): boolean {
  const base = basename(rel);
  const lower = base.toLowerCase();
  if (DENY_BASENAMES.has(lower)) return true;
  for (const p of DENY_BASENAME_PREFIXES) {
    if (lower.startsWith(p)) return true;
  }
  if (lower.endsWith(".pem") || lower.endsWith(".p12") || lower.endsWith(".pfx")) {
    return true;
  }
  return false;
}

async function readUtf8IfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export interface DiscoveryContext {
  root: string;
  pathVerdict(rel: string, task: string): PathVerdict;
  traverseAllowed(relDir: string): boolean;
  filterRelPaths(paths: string[], task: string): string[];
  ripgrepExtraArgs(): string[];
  verifyReadable(absPath: string, rel: string, task: string): Promise<PathVerdict>;
}

export async function createDiscoveryContext(
  packRoot: string,
  options?: { configRoot?: string },
): Promise<DiscoveryContext> {
  const absRoot = path.resolve(packRoot);
  const configRoot = path.resolve(options?.configRoot ?? packRoot);
  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  const gitMetaRoot = (await isGitRepo(configRoot)) ? configRoot : absRoot;
  if (await isGitRepo(gitMetaRoot)) {
    const exclude = await readUtf8IfExists(
      path.join(gitMetaRoot, ".git", "info", "exclude"),
    );
    if (exclude) ig.add(exclude);
  }

  const gitignore = await readUtf8IfExists(
    path.join(configRoot, ".gitignore"),
  );
  if (gitignore) ig.add(gitignore);

  const repoCursor = await readUtf8IfExists(
    path.join(configRoot, ".cursorignore"),
  );
  if (repoCursor) ig.add(repoCursor);

  const packCursor = await readUtf8IfExists(
    path.join(absRoot, ".cursorignore"),
  );
  if (packCursor && configRoot !== absRoot) ig.add(packCursor);

  const cursorIgnorePath = path.join(absRoot, ".cursorignore");

  function pathVerdict(rel: string, task: string): PathVerdict {
    const norm = normalizeRelPath(rel);
    if (!norm || norm.includes("..")) {
      return { packable: false, reason: "deny-path" };
    }
    if (isDenyBasename(norm)) {
      return { packable: false, reason: "deny-path" };
    }
    const lockOverride =
      isLockfilePath(norm) && taskAllowsLockfiles(task);
    if (isLockfilePath(norm) && !taskAllowsLockfiles(task)) {
      return { packable: false, reason: "lockfile" };
    }
    const vendorOverride = isVendorPath(norm) && taskAllowsVendor(task);
    if (isVendorPath(norm) && !taskAllowsVendor(task)) {
      return { packable: false, reason: "vendor" };
    }
    if (!lockOverride && !vendorOverride && ig.ignores(norm)) {
      return { packable: false, reason: "ignored" };
    }
    if (BINARY_EXT.test(norm)) {
      return { packable: false, reason: "binary" };
    }
    return { packable: true };
  }

  function traverseAllowed(relDir: string): boolean {
    const norm = normalizeRelPath(relDir);
    if (!norm || norm.includes("..")) return false;
    if (isDenyBasename(norm)) return false;
    if (ig.ignores(norm) || ig.ignores(`${norm}/`)) return false;
    return true;
  }

  function filterRelPaths(paths: string[], task: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of paths) {
      const norm = normalizeRelPath(p);
      if (!norm || seen.has(norm)) continue;
      const v = pathVerdict(norm, task);
      if (!v.packable) continue;
      seen.add(norm);
      out.push(norm);
    }
    return out;
  }

  async function verifyReadable(
    absPath: string,
    rel: string,
    task: string,
  ): Promise<PathVerdict> {
    const base = pathVerdict(rel, task);
    if (!base.packable) return base;
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        return { packable: false, reason: "deny-path" };
      }
      if (stat.size > MAX_FILE_BYTES) {
        return { packable: false, reason: "oversized" };
      }
      if (await fileHasNullByte(absPath)) {
        return { packable: false, reason: "binary" };
      }
      return { packable: true };
    } catch {
      return { packable: false, reason: "deny-path" };
    }
  }

  let cursorIgnoreExists = false;
  try {
    await fs.access(cursorIgnorePath);
    cursorIgnoreExists = true;
  } catch {
    cursorIgnoreExists = false;
  }

  return {
    root: absRoot,
    pathVerdict,
    traverseAllowed,
    filterRelPaths,
    ripgrepExtraArgs: () => {
      const args: string[] = [];
      for (const g of RG_EXTRA_DENY) {
        args.push("-g", `!${g}`);
      }
      if (cursorIgnoreExists) {
        args.push("--ignore-file", cursorIgnorePath);
      }
      return args;
    },
    verifyReadable,
  };
}

async function fileHasNullByte(absPath: string): Promise<boolean> {
  const fh = await fs.open(absPath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    await fh.close();
  }
}
