import type { DiscoveryContext } from "./discovery.js";
import { normalizeRelPath } from "./discovery.js";
import { resolveRipgrep, runRipgrep, type RipgrepExecutable } from "./rg.js";
import type { ParsedTask } from "./task.js";
import { searchTermsFromParsed } from "./task.js";

export { searchTermsFromTask } from "./task.js";

export interface ContentSearchResult {
  keyword: Map<string, number>;
  phrase: Map<string, number>;
  matchLines: Map<string, number[]>;
  ripgrep: RipgrepExecutable | null;
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ingestStdout(
  stdout: string,
  absRoot: string,
  discovery: DiscoveryContext,
  task: string,
  into: Map<string, number>,
  lineMap?: Map<string, number[]>,
): void {
  const rootSlash = absRoot.replace(/\\/g, "/");
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const m = line.match(/^(.+?):(\d+):/);
    if (!m) continue;
    const file = m[1].replace(/\\/g, "/");
    const lineNo = parseInt(m[2], 10);
    const rel = file.startsWith(rootSlash)
      ? file.slice(rootSlash.length + 1)
      : file;
    const norm = normalizeRelPath(rel);
    const verdict = discovery.pathVerdict(norm, task);
    if (!verdict.packable) continue;
    into.set(norm, (into.get(norm) ?? 0) + 1);
    if (lineMap && Number.isFinite(lineNo)) {
      const arr = lineMap.get(norm) ?? [];
      arr.push(lineNo);
      lineMap.set(norm, arr);
    }
  }
}

function baseRgArgs(discovery: DiscoveryContext): string[] {
  return [
    "--no-heading",
    "--line-number",
    ...discovery.ripgrepExtraArgs(),
    "-g",
    "!*.{min.js,map,svg,png,jpg,jpeg,webp,gif,ico,woff,woff2,ttf,eot,pdf,zip,gz,mp4,mp3,wasm}",
  ];
}

async function runTermSearch(
  rg: RipgrepExecutable,
  parsed: ParsedTask,
  discovery: DiscoveryContext,
  task: string,
  lineMap: Map<string, number[]>,
): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  const terms = searchTermsFromParsed(parsed).filter((t) => t.length >= 2);
  if (terms.length === 0) return hits;

  const pattern = terms.map(escapeRegExp).slice(0, 12).join("|");
  const absRoot = discovery.root;
  try {
    const stdout = await runRipgrep(rg, [
      ...baseRgArgs(discovery),
      "-i",
      pattern,
      absRoot,
    ]);
    ingestStdout(stdout, absRoot, discovery, task, hits, lineMap);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code !== 1) throw err;
  }
  return hits;
}

async function runPhraseSearch(
  rg: RipgrepExecutable,
  parsed: ParsedTask,
  discovery: DiscoveryContext,
  task: string,
  lineMap: Map<string, number[]>,
): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  const phrases = parsed.quoted.filter((p) => p.trim().length >= 3).slice(0, 5);
  if (phrases.length === 0) {
    for (const s of parsed.symbols.filter((x) => x.length >= 4).slice(0, 3)) {
      phrases.push(s);
    }
  }
  const absRoot = discovery.root;
  for (const phrase of phrases) {
    try {
      const stdout = await runRipgrep(rg, [
        ...baseRgArgs(discovery),
        "-F",
        "-i",
        phrase,
        absRoot,
      ]);
      ingestStdout(stdout, absRoot, discovery, task, hits, lineMap);
    } catch (err: unknown) {
      const e = err as { code?: number };
      if (e.code !== 1) throw err;
    }
  }
  return hits;
}

export async function runContentSearch(
  parsed: ParsedTask,
  discovery: DiscoveryContext,
  task: string,
): Promise<ContentSearchResult> {
  const rg = await resolveRipgrep();
  if (!rg) {
    return {
      keyword: new Map(),
      phrase: new Map(),
      matchLines: new Map(),
      ripgrep: null,
    };
  }
  const matchLines = new Map<string, number[]>();
  const [keyword, phrase] = await Promise.all([
    runTermSearch(rg, parsed, discovery, task, matchLines),
    runPhraseSearch(rg, parsed, discovery, task, matchLines),
  ]);
  return { keyword, phrase, matchLines, ripgrep: rg };
}

export async function ripgrepHits(
  parsed: ParsedTask,
  discovery: DiscoveryContext,
  task: string,
): Promise<Map<string, number>> {
  const { keyword, phrase } = await runContentSearch(parsed, discovery, task);
  const merged = new Map<string, number>();
  for (const [k, v] of keyword) merged.set(k, (merged.get(k) ?? 0) + v);
  for (const [k, v] of phrase) merged.set(k, (merged.get(k) ?? 0) + v);
  return merged;
}
