import { normalizeRelPath } from "./discovery.js";

export interface ParsedTask {
  raw: string;
  paths: string[];
  filenames: string[];
  symbols: string[];
  quoted: string[];
  keywords: string[];
  warnings: string[];
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "when",
  "where",
  "what",
  "how",
  "fix",
  "fixed",
  "fixes",
  "bug",
  "bugs",
  "issue",
  "issues",
  "error",
  "errors",
  "update",
  "change",
  "make",
  "add",
  "remove",
  "use",
  "using",
  "help",
  "need",
  "please",
  "just",
  "also",
  "very",
  "some",
  "any",
  "all",
  "not",
  "but",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "can",
  "could",
  "should",
  "would",
  "will",
  "our",
  "your",
  "app",
  "code",
  "file",
  "files",
]);

const FILE_EXT =
  /(?:@\/)?(?:\.\/|\.\.\/)?[\w./\\-]+\.(tsx?|jsx?|mjs|cjs|astro|vue|svelte|py|go|rs|java|kt|rb|php|md|mdc|json|yaml|yml|css|scss|html)\b/gi;

const PASCAL = /\b[A-Z][a-zA-Z0-9]{2,}\b/g;
const CAMEL = /\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*\b/g;

function uniqueOrdered(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractQuoted(task: string): { quoted: string[]; stripped: string } {
  const quoted: string[] = [];
  const patterns = [
    /"([^"]+)"/g,
    /'([^']+)'/g,
    /`([^`]+)`/g,
  ];
  let stripped = task;
  for (const re of patterns) {
    stripped = stripped.replace(re, (_m, inner: string) => {
      const t = inner.trim();
      if (t) quoted.push(t);
      return " ";
    });
  }
  return { quoted, stripped };
}

function extractPaths(text: string): string[] {
  const paths: string[] = [];
  const re = new RegExp(FILE_EXT.source, FILE_EXT.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].replace(/^@\//, "").replace(/\\/g, "/");
    paths.push(normalizeRelPath(raw));
  }
  return uniqueOrdered(paths);
}

function basename(pathLike: string): string {
  const n = pathLike.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

function extractSymbols(text: string): string[] {
  const symbols: string[] = [];
  const pascal = text.match(PASCAL) ?? [];
  const camel = text.match(CAMEL) ?? [];
  for (const s of [...pascal, ...camel]) {
    if (STOPWORDS.has(s.toLowerCase())) continue;
    symbols.push(s);
  }
  return uniqueOrdered(symbols);
}

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, " ")
    .split(/\s+/)
    .flatMap((w) => w.split(/[/_.-]+/))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return uniqueOrdered(words);
}

function buildWarnings(parsed: ParsedTask): string[] {
  const warnings: string[] = [];
  const anchored =
    parsed.paths.length > 0 ||
    parsed.symbols.length > 0 ||
    parsed.quoted.length > 0 ||
    parsed.filenames.length > 0;

  if (!anchored && parsed.keywords.length <= 2) {
    warnings.push(
      "Task is vague: add a file path, filename, symbol, or quoted phrase (e.g. src/Hero.tsx or \"SHero\").",
    );
  }

  if (parsed.raw.trim().length < 12 && !anchored) {
    warnings.push("Task is very short; the pack may be broad or empty.");
  }

  return warnings;
}

export function parseTask(task: string): ParsedTask {
  const raw = task.trim();
  const { quoted, stripped } = extractQuoted(raw);
  const paths = extractPaths(raw);
  const filenames = uniqueOrdered([
    ...paths.map((p) => basename(p)),
    ...extractPaths(stripped).map((p) => basename(p)),
  ]);

  let symbolSource = stripped;
  for (const p of paths) {
    symbolSource = symbolSource.replaceAll(p, " ");
    symbolSource = symbolSource.replaceAll(basename(p), " ");
  }

  const symbols = extractSymbols(symbolSource);
  for (const q of quoted) {
    symbols.push(...extractSymbols(q));
  }

  const keywords = extractKeywords(symbolSource);
  for (const q of quoted) {
    keywords.push(...extractKeywords(q));
  }

  const parsed: ParsedTask = {
    raw,
    paths: uniqueOrdered(paths),
    filenames: uniqueOrdered(filenames),
    symbols: uniqueOrdered(symbols),
    quoted: uniqueOrdered(quoted),
    keywords: uniqueOrdered(keywords),
    warnings: [],
  };
  parsed.warnings = buildWarnings(parsed);
  return parsed;
}

export function searchTermsFromParsed(parsed: ParsedTask): string[] {
  const terms: string[] = [];
  for (const q of parsed.quoted) {
    if (q.length >= 2) terms.push(q);
  }
  for (const s of parsed.symbols) {
    terms.push(s);
  }
  for (const f of parsed.filenames) {
    terms.push(f);
    const stem = f.replace(/\.[^.]+$/, "");
    if (stem.length >= 3) terms.push(stem);
  }
  for (const p of parsed.paths) {
    terms.push(p);
    terms.push(basename(p));
  }
  for (const k of parsed.keywords) {
    terms.push(k);
  }
  return uniqueOrdered(terms).slice(0, 16);
}

export function searchTermsFromTask(task: string): string[] {
  return searchTermsFromParsed(parseTask(task));
}
