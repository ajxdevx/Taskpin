import fs from "node:fs/promises";
import path from "node:path";
import {
  buildVariants,
  optimizeBudgetFill,
  type PackedFileCandidate,
} from "../budget-pack.js";
import {
  createDiscoveryContext,
  MAX_FILE_BYTES,
} from "../discovery.js";
import { entrypointScores } from "../entrypoints.js";
import { collectGitSignals, gitBlobShaForPath } from "../git.js";
import {
  defaultFileIndexPath,
  indexReadyForPathMatch,
} from "../file-index.js";
import { resolveWorkspace, scopeGitSignals } from "../workspace.js";
import { manifestFileMap } from "../manifest.js";
import { importNeighborScores } from "../imports.js";
import { pathMatchHits } from "../pathmatch.js";
import { fuseRankingsWithSignals } from "../rank.js";
import { runContentSearch } from "../search.js";
import { processFileSecrets } from "../secrets.js";
import { parseTask } from "../task.js";
import { testPairScores } from "../testpair.js";
import {
  allocatePackBudget,
  createTokenEstimator,
  resolveTokenModel,
} from "../tokens.js";
import type { OmittedReceipt } from "../types.js";
import {
  buildChangedAllowlist,
  collectGraphSeeds,
  collectRuleFiles,
} from "./candidates.js";
import { buildContributions } from "./contributions.js";
import { parsePackRequest } from "../core/pack-request.js";
import type { PackPlan, PackPlanOptions, PlannedPackedFile } from "./types.js";

export async function computePackPlan(
  options: PackPlanOptions,
): Promise<PackPlan> {
  const req = parsePackRequest(options);
  const {
    root,
    task,
    budgetTokens,
    redactSecrets,
    mode,
    base,
    since,
    model,
    useIndex,
    indexPath,
  } = req;
  const readBodies = options.readBodies ?? true;
  const sessionManifest = options.sessionManifest ?? null;
  const tokenModel = resolveTokenModel(model);
  const estimateTokens = createTokenEstimator(tokenModel);
  const { contentBudget, reserved } = allocatePackBudget(budgetTokens);
  const workspace = await resolveWorkspace(root);
  const absRoot = workspace.packRoot;
  const discovery = await createDiscoveryContext(absRoot, {
    configRoot: workspace.gitRoot ?? absRoot,
  });
  const parsed = parseTask(task);
  const indexWarnings: string[] = [];
  let packableFromIndex: string[] | undefined;
  if (useIndex) {
    const idxPath = indexPath ?? defaultFileIndexPath(absRoot);
    const ready = await indexReadyForPathMatch(absRoot, idxPath);
    if (ready) {
      packableFromIndex = ready.paths;
      indexWarnings.push(
        `Using file index for path matching (${ready.paths.length} paths).`,
      );
    } else {
      indexWarnings.push(
        "File index missing or stale; full tree walk for path matching.",
      );
    }
  }

  const gitSignalsRaw =
    workspace.gitAvailable && workspace.gitRoot
      ? await collectGitSignals(
          workspace.gitRoot,
          parsed.symbols,
          base,
          since,
        )
      : {
          recent: [],
          branchDiff: [],
          sinceDiff: [],
          pickaxe: [],
          meta: {
            branch: null,
            base: null,
            since: since ?? null,
            head: null,
          },
        };
  const gitSignals = scopeGitSignals(gitSignalsRaw, workspace.scopePrefix);

  const [ruleFiles, search, pathHits] = await Promise.all([
    collectRuleFiles(absRoot),
    runContentSearch(parsed, discovery, task),
    pathMatchHits(parsed, discovery, task, {
      packableFiles: packableFromIndex,
    }),
  ]);

  const pathHitKeys = [...pathHits.keys()];
  const changedAllow =
    mode === "changed"
      ? buildChangedAllowlist(ruleFiles, gitSignals, pathHitKeys)
      : null;

  const graphSeeds = collectGraphSeeds(
    parsed,
    pathHitKeys,
    search,
    gitSignals,
  ).filter((s) => changedAllow === null || changedAllow.has(s));

  const [importNeighbors, testPairs, entrypoints] = await Promise.all([
    importNeighborScores(graphSeeds, absRoot, discovery, task),
    testPairScores(graphSeeds, absRoot, discovery, task),
    entrypointScores(parsed, absRoot, discovery, task),
  ]);

  if (changedAllow !== null) {
    for (const rel of importNeighbors.keys()) changedAllow.add(rel);
    for (const rel of testPairs.keys()) changedAllow.add(rel);
  }

  const contributions = buildContributions(
    discovery,
    parsed,
    ruleFiles,
    search,
    pathHits,
    gitSignals,
    importNeighbors,
    testPairs,
    entrypoints,
    changedAllow,
    task,
  );

  const { ranked, suppressed } = fuseRankingsWithSignals(contributions);
  const blockedSecrets: PackPlan["blockedSecrets"] = [];
  const omitted: OmittedReceipt[] = [];
  const packCandidates: PackedFileCandidate[] = [];
  const manifestCache = sessionManifest
    ? manifestFileMap(sessionManifest)
    : new Map();
  const storedBodies = new Map<
    string,
    { blobSha: string; storedContent: string }
  >();
  let reusedFileBodies = 0;

  for (const item of ranked) {
    const abs = path.join(absRoot, item.path);
    const readable = await discovery.verifyReadable(abs, item.path, task);
    if (!readable.packable) {
      omitted.push({
        path: item.path,
        score: Math.round(item.score),
        reasons: item.reasons,
        signals: item.signals,
        omit: "not-packable",
        detail: readable.reason,
      });
      continue;
    }

    if (!readBodies) {
      let estFull = 200;
      try {
        const stat = await fs.stat(abs);
        const bytes = Math.min(stat.size, MAX_FILE_BYTES);
        estFull = Math.max(40, estimateTokens(" ".repeat(Math.min(bytes, 8000))));
        if (bytes > 8000) {
          estFull = Math.ceil(estFull * (bytes / 8000));
        }
      } catch {
        estFull = 200;
      }
      const estSig = Math.min(estFull, Math.max(48, Math.ceil(estFull * 0.12)));
      packCandidates.push({
        path: item.path,
        reasons: item.reasons,
        score: item.score,
        variants: [
          { presentation: "full", content: "", tokens: estFull },
          { presentation: "signature", content: "", tokens: estSig },
        ],
      });
      continue;
    }

    let raw: string;
    const cached = manifestCache.get(item.path);
    const blobSha = await gitBlobShaForPath(absRoot, item.path);
    if (cached && blobSha && cached.blobSha === blobSha) {
      raw = cached.storedContent;
      reusedFileBodies++;
    } else {
      try {
        raw = await fs.readFile(abs, "utf8");
      } catch {
        omitted.push({
          path: item.path,
          score: Math.round(item.score),
          reasons: item.reasons,
          signals: item.signals,
          omit: "read-error",
        });
        continue;
      }
    }

    const secretOutcome = processFileSecrets(raw, { redact: redactSecrets });
    if (secretOutcome.action === "blocked") {
      blockedSecrets.push({ path: item.path, kinds: secretOutcome.kinds });
      omitted.push({
        path: item.path,
        score: Math.round(item.score),
        reasons: item.reasons,
        signals: item.signals,
        omit: "blocked-secret",
        detail: secretOutcome.kinds.join(", "),
      });
      continue;
    }
    const content = secretOutcome.content;
    const sha =
      blobSha ?? (await gitBlobShaForPath(absRoot, item.path)) ?? "unknown";
    storedBodies.set(item.path, { blobSha: sha, storedContent: content });
    const fileReasons = [...item.reasons];
    for (const r of secretOutcome.extraReasons) {
      if (!fileReasons.includes(r)) fileReasons.push(r);
    }

    const matchLines = search.matchLines.get(item.path) ?? [];
    const variants = buildVariants(
      item.path,
      content,
      matchLines,
      estimateTokens,
    );
    packCandidates.push({
      path: item.path,
      reasons: fileReasons,
      score: item.score,
      variants,
    });
  }

  const filled = optimizeBudgetFill(
    packCandidates,
    contentBudget,
    estimateTokens,
    (p) => estimateTokens(`\n## ${p}\n`),
  );

  const packedSet = new Set(filled.map((f) => f.path));
  for (const c of packCandidates) {
    if (!packedSet.has(c.path)) {
      const rankedEntry = ranked.find((r) => r.path === c.path);
      omitted.push({
        path: c.path,
        score: Math.round(c.score),
        reasons: c.reasons,
        signals: rankedEntry?.signals ?? [],
        omit: "budget",
      });
    }
  }

  const rankedByPath = new Map(ranked.map((r) => [r.path, r]));
  const packed: PlannedPackedFile[] = filled.map((f) => {
    const meta = rankedByPath.get(f.path);
    return {
      path: f.path,
      reasons: f.reasons,
      score: Math.round(f.score),
      signals: meta?.signals ?? [],
      presentation: f.presentation,
      tokens: f.tokens,
      content: f.content,
    };
  });

  const warnings = [
    ...indexWarnings,
    ...parsed.warnings,
    ...(search.ripgrep
      ? []
      : [
          "ripgrep not available: install rg on PATH or npm install @vscode/ripgrep (content search disabled).",
        ]),
    ...(mode === "changed" && gitSignals.branchDiff.length === 0
      ? [
          "Changed mode: no branch diff vs base (commit on a branch or set --base).",
        ]
      : []),
    ...(gitSignals.meta.since && gitSignals.sinceDiff.length === 0
      ? [`Since ${gitSignals.meta.since}: no changed files in range.`]
      : []),
    ...(sessionManifest && reusedFileBodies > 0
      ? [
          `Session refresh: reused ${reusedFileBodies} unchanged file bod${reusedFileBodies === 1 ? "y" : "ies"} from manifest.`,
        ]
      : []),
    ...(!workspace.gitAvailable
      ? [
          "Not a git repository (or no parent git root): branch/recent/pickaxe signals disabled.",
        ]
      : workspace.scopePrefix
        ? [
            `Monorepo scope: packing \`${workspace.scopePrefix}\` (paths relative to pack root).`,
          ]
        : []),
  ];

  return {
    root: absRoot,
    task,
    budgetTokens,
    tokenModel,
    contentBudget,
    budgetReserved: reserved,
    contributions,
    ranked: ranked.map((r) => ({
      path: r.path,
      score: Math.round(r.score),
      reasons: r.reasons,
      signals: r.signals,
      diversityPenalty: r.diversityPenalty,
    })),
    suppressed,
    packed,
    omitted,
    blockedSecrets,
    parsed,
    search,
    gitSignals,
    mode,
    warnings,
    reusedFileBodies,
    storedBodies,
    workspace,
  };
}
