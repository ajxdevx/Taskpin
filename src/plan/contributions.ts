import type { createDiscoveryContext } from "../discovery.js";
import { isTextCandidate } from "../files.js";
import type { GitSignals } from "../git.js";
import { pushContribution, type ScoreContribution } from "../rank.js";
import type { runContentSearch } from "../search.js";
import type { parseTask } from "../task.js";
import type { PackReason } from "../types.js";

export function buildContributions(
  discovery: Awaited<ReturnType<typeof createDiscoveryContext>>,
  parsed: ReturnType<typeof parseTask>,
  ruleFiles: string[],
  search: Awaited<ReturnType<typeof runContentSearch>>,
  pathHits: Map<string, number>,
  gitSignals: GitSignals,
  importNeighbors: Map<string, number>,
  testPairs: Map<string, number>,
  entrypoints: Map<string, number>,
  changedAllow: Set<string> | null,
  task: string,
): ScoreContribution[] {
  const contributions: ScoreContribution[] = [];
  const skipChanged = (rel: string): boolean =>
    changedAllow !== null && !changedAllow.has(rel);

  for (const f of discovery.filterRelPaths(ruleFiles, task)) {
    const reason: PackReason = f.endsWith("README.md")
      ? "readme"
      : f.includes("AGENTS") || f.includes("CLAUDE") || f.includes(".cursor")
        ? "agent-rules"
        : "readme";
    pushContribution(
      contributions,
      f,
      reason,
      reason === "agent-rules" ? 100 : 60,
    );
  }

  for (const [file, count] of search.keyword) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(
      contributions,
      file,
      "keyword-match",
      20 + Math.min(count * 3, 40),
    );
  }

  for (const [file, count] of search.phrase) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(
      contributions,
      file,
      "phrase-match",
      28 + Math.min(count * 4, 48),
    );
  }

  for (const [file, score] of pathHits) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(contributions, file, "path-match", score);
  }

  let diffRank = 0;
  for (const file of discovery.filterRelPaths(gitSignals.branchDiff, task)) {
    if (!isTextCandidate(file)) continue;
    pushContribution(
      contributions,
      file,
      "branch-diff",
      72 - Math.min(diffRank, 30),
    );
    diffRank++;
  }

  let pickaxeRank = 0;
  for (const file of discovery.filterRelPaths(gitSignals.pickaxe, task)) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(
      contributions,
      file,
      "pickaxe",
      48 - Math.min(pickaxeRank, 20),
    );
    pickaxeRank++;
  }

  let sinceRank = 0;
  for (const file of discovery.filterRelPaths(gitSignals.sinceDiff, task)) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(
      contributions,
      file,
      "since-change",
      65 - Math.min(sinceRank, 28),
    );
    sinceRank++;
  }

  let recentRank = 0;
  for (const file of discovery.filterRelPaths(gitSignals.recent, task)) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(
      contributions,
      file,
      "recent-change",
      35 - Math.min(recentRank, 25),
    );
    recentRank++;
  }

  for (const [file, score] of importNeighbors) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(contributions, file, "import-neighbor", score);
  }

  for (const [file, score] of testPairs) {
    if (!isTextCandidate(file) || skipChanged(file)) continue;
    pushContribution(contributions, file, "test-pair", score);
  }

  for (const [file, score] of entrypoints) {
    if (skipChanged(file)) continue;
    pushContribution(contributions, file, "entrypoint", score);
  }

  return contributions;
}
