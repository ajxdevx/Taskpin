import type { FileSignal, PackReason, ScoredFile } from "./types.js";

export interface ScoreContribution {
  path: string;
  reason: PackReason;
  points: number;
}

const REASON_WEIGHT: Record<PackReason, number> = {
  "agent-rules": 1,
  readme: 0.9,
  "keyword-match": 1,
  "phrase-match": 1.05,
  "path-match": 1.1,
  "branch-diff": 1.15,
  pickaxe: 1.05,
  "recent-change": 0.95,
  "since-change": 1.12,
  "import-neighbor": 1,
  "test-pair": 1.08,
  entrypoint: 0.95,
  "secret-redacted": 0,
};

const PER_FILE_REASON_CAP: Partial<Record<PackReason, number>> = {
  "keyword-match": 45,
  "phrase-match": 52,
  "recent-change": 32,
  "import-neighbor": 48,
  pickaxe: 45,
  "branch-diff": 75,
  "since-change": 70,
};

const GLOBAL_REASON_MAX_FILES: Partial<Record<PackReason, number>> = {
  "keyword-match": 12,
  "phrase-match": 8,
  "recent-change": 8,
  "import-neighbor": 14,
  "branch-diff": 25,
  pickaxe: 12,
};

const MAX_FILES_PER_TOP_DIR = 4;

function topLevelDir(relPath: string): string {
  const norm = relPath.replace(/\\/g, "/");
  const i = norm.indexOf("/");
  return i === -1 ? "." : norm.slice(0, i);
}

function allowedFilesPerReason(
  contributions: ScoreContribution[],
): Map<PackReason, Set<string>> {
  const byReason = new Map<PackReason, ScoreContribution[]>();
  for (const c of contributions) {
    const list = byReason.get(c.reason) ?? [];
    list.push(c);
    byReason.set(c.reason, list);
  }

  const allowed = new Map<PackReason, Set<string>>();
  for (const [reason, list] of byReason) {
    const max = GLOBAL_REASON_MAX_FILES[reason];
    const set = new Set<string>();
    if (max === undefined) {
      for (const c of list) set.add(c.path);
      allowed.set(reason, set);
      continue;
    }
    const best = new Map<string, number>();
    for (const c of list) {
      best.set(c.path, Math.max(best.get(c.path) ?? 0, c.points));
    }
    const ordered = [...best.entries()].sort((a, b) => b[1] - a[1]);
    for (const [path] of ordered.slice(0, max)) set.add(path);
    allowed.set(reason, set);
  }
  return allowed;
}

export interface FusedRankEntry extends ScoredFile {
  signals: FileSignal[];
  diversityPenalty?: number;
}

export interface FusionResult {
  ranked: FusedRankEntry[];
  suppressed: Array<{ path: string; reason: PackReason; points: number }>;
}

export function fuseRankingsWithSignals(
  contributions: ScoreContribution[],
): FusionResult {
  const allowed = allowedFilesPerReason(contributions);
  const files = new Map<string, FusedRankEntry>();
  const suppressed: FusionResult["suppressed"] = [];

  for (const c of contributions) {
    const permit = allowed.get(c.reason);
    if (permit && !permit.has(c.path)) {
      suppressed.push({ path: c.path, reason: c.reason, points: c.points });
      const cur =
        files.get(c.path) ??
        ({
          path: c.path,
          score: 0,
          reasons: [],
          tokens: 0,
          signals: [],
        } satisfies FusedRankEntry);
      cur.signals.push({
        reason: c.reason,
        points: c.points,
        weighted: 0,
        applied: false,
      });
      files.set(c.path, cur);
      continue;
    }

    const weight = REASON_WEIGHT[c.reason] ?? 1;
    const cap = PER_FILE_REASON_CAP[c.reason] ?? c.points;
    const raw = Math.min(c.points, cap);
    const weighted = raw * weight;

    const cur =
      files.get(c.path) ??
      ({
        path: c.path,
        score: 0,
        reasons: [],
        tokens: 0,
        signals: [],
      } satisfies FusedRankEntry);
    cur.score += weighted;
    if (!cur.reasons.includes(c.reason)) cur.reasons.push(c.reason);
    cur.signals.push({
      reason: c.reason,
      points: c.points,
      weighted,
      applied: true,
    });
    files.set(c.path, cur);
  }

  const ranked = [...files.values()].sort((a, b) => b.score - a.score);
  const dirCounts = new Map<string, number>();

  for (const item of ranked) {
    const dir = topLevelDir(item.path);
    const count = dirCounts.get(dir) ?? 0;
    if (count >= MAX_FILES_PER_TOP_DIR) {
      const before = item.score;
      item.score *= 0.82;
      item.diversityPenalty = before - item.score;
    }
    dirCounts.set(dir, count + 1);
  }

  ranked.sort((a, b) => b.score - a.score);
  return { ranked, suppressed };
}

export function fuseRankings(
  contributions: ScoreContribution[],
): ScoredFile[] {
  return fuseRankingsWithSignals(contributions).ranked;
}

export function pushContribution(
  list: ScoreContribution[],
  path: string,
  reason: PackReason,
  points: number,
): void {
  if (points <= 0) return;
  list.push({ path, reason, points });
}
