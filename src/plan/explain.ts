import path from "node:path";
import type { ScoreContribution } from "../rank.js";
import type { PackReason } from "../types.js";
import type { ExplainPathResult, PackPlan } from "./types.js";

function normalizeExplainPath(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function normalizeTargetPath(root: string, input: string): string {
  const norm = normalizeExplainPath(input);
  if (norm.includes("..")) return norm;
  const abs = path.resolve(root, norm);
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel;
  }
  return norm;
}

export function contributionsForPath(
  contributions: ScoreContribution[],
  relPath: string,
): ScoreContribution[] {
  const norm = normalizeExplainPath(relPath);
  return contributions.filter((c) => c.path === norm);
}

export function explainPathFromPlan(
  plan: PackPlan,
  targetInput: string,
): ExplainPathResult {
  const rel = normalizeTargetPath(plan.root, targetInput);
  const packed = plan.packed.find((f) => f.path === rel);
  if (packed) {
    return {
      path: rel,
      known: true,
      packed: true,
      score: packed.score,
      reasons: packed.reasons,
      signals: packed.signals,
      omit: null,
      rawContributions: contributionsForPath(plan.contributions, rel),
      suppressedHits: plan.suppressed
        .filter((s) => s.path === rel)
        .map((s) => ({ reason: s.reason, points: s.points })),
    };
  }

  const omitted = plan.omitted.find((o) => o.path === rel);
  if (omitted) {
    return {
      path: rel,
      known: true,
      packed: false,
      score: omitted.score,
      reasons: omitted.reasons,
      signals: omitted.signals,
      omit: omitted.omit,
      detail: omitted.detail,
      rawContributions: contributionsForPath(plan.contributions, rel),
      suppressedHits: plan.suppressed
        .filter((s) => s.path === rel)
        .map((s) => ({ reason: s.reason, points: s.points })),
    };
  }

  const ranked = plan.ranked.find((r) => r.path === rel);
  const raw = contributionsForPath(plan.contributions, rel);
  const suppressedHits = plan.suppressed
    .filter((s) => s.path === rel)
    .map((s) => ({ reason: s.reason, points: s.points }));

  if (ranked) {
    return {
      path: rel,
      known: true,
      packed: false,
      score: ranked.score,
      reasons: ranked.reasons,
      signals: ranked.signals,
      omit: null,
      diversityPenalty: ranked.diversityPenalty,
      rawContributions: raw,
      suppressedHits,
    };
  }

  if (raw.length > 0 || suppressedHits.length > 0) {
    return {
      path: rel,
      known: true,
      packed: false,
      score: null,
      reasons: [],
      signals: [],
      omit: "not-ranked",
      detail:
        suppressedHits.length > 0
          ? "signal capped globally (too many files for this reason)"
          : "below fusion threshold or filtered in changed mode",
      rawContributions: raw,
      suppressedHits,
    };
  }

  return {
    path: rel,
    known: false,
    packed: false,
    score: null,
    reasons: [],
    signals: [],
    omit: null,
    rawContributions: [],
    suppressedHits: [],
  };
}
