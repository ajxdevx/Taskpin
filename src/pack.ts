import {
  parsePackRequest,
  toPlanOptions,
  type PackBuildOptions,
} from "./core/pack-request.js";
import { computePackPlan } from "./plan.js";
import {
  buildManifestFromPack,
  defaultManifestPath,
  loadSessionManifest,
  manifestMatchesTask,
  saveSessionManifest,
} from "./manifest.js";
import { withSchemaMetadata } from "./schema.js";
import { createTokenEstimator, resolveTokenModel } from "./tokens.js";
import type { ContextPack } from "./types.js";

export async function buildPack(options: PackBuildOptions): Promise<ContextPack> {
  const req = parsePackRequest(options);
  const manifestPath =
    req.manifestPath ?? defaultManifestPath(req.root);
  let sessionManifest = options.sessionManifest ?? null;
  let previousHead: string | null = null;

  if (req.refresh) {
    const loaded = await loadSessionManifest(manifestPath);
    if (!loaded) {
      throw new Error(
        `No session manifest at ${manifestPath}. Run with --save-manifest first.`,
      );
    }
    if (!manifestMatchesTask(loaded, req.task, req.root)) {
      throw new Error(
        "Session manifest task/root does not match this pack request.",
      );
    }
    sessionManifest = loaded;
    previousHead = loaded.head;
  }

  const since =
    req.since ??
    (req.mode === "delta" && sessionManifest?.head
      ? sessionManifest.head
      : undefined);

  const plan = await computePackPlan(
    toPlanOptions(
      { ...req, since },
      { sessionManifest, readBodies: true },
    ),
  );
  const tokenModel = resolveTokenModel(req.model);
  const estimateTokens = createTokenEstimator(tokenModel);
  const headerBudget = estimateTokens(
    `# Context pack\nTask: ${plan.task}\n\n`,
  );

  let used = 0;
  const files: ContextPack["files"] = plan.packed.map((f) => {
    const fileHeader = estimateTokens(`\n## ${f.path}\n`);
    used += f.tokens + fileHeader;
    return {
      path: f.path,
      reasons: f.reasons,
      signals: f.signals,
      score: f.score,
      presentation: f.presentation,
      tokens: f.tokens,
      content: f.content,
    };
  });

  const omittedTop = plan.omitted
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  const packBody = {
    version: 1 as const,
    root: plan.root,
    task: plan.task,
    budgetTokens: plan.budgetTokens,
    tokenModel: plan.tokenModel,
    budgetReserved: plan.budgetReserved,
    usedTokens: used + headerBudget,
    generatedAt: new Date().toISOString(),
    git: {
      branch: plan.gitSignals.meta.branch,
      base: plan.gitSignals.meta.base,
      since: plan.gitSignals.meta.since,
      mode: plan.mode,
    },
    taskParse: {
      paths: plan.parsed.paths,
      filenames: plan.parsed.filenames,
      symbols: plan.parsed.symbols,
      quoted: plan.parsed.quoted,
      keywords: plan.parsed.keywords,
      warnings: plan.warnings,
    },
    files,
    omitted: omittedTop.length > 0 ? omittedTop : undefined,
    blockedSecrets:
      plan.blockedSecrets.length > 0 ? plan.blockedSecrets : undefined,
    workspace: {
      packRoot: plan.workspace.packRoot,
      gitRoot: plan.workspace.gitRoot,
      scopePrefix: plan.workspace.scopePrefix,
      gitAvailable: plan.workspace.gitAvailable,
    },
    session:
      req.refresh || req.saveManifest || plan.reusedFileBodies > 0
        ? {
            manifestPath,
            previousHead,
            currentHead: plan.gitSignals.meta.head,
            reusedFileBodies: plan.reusedFileBodies,
          }
        : undefined,
  };

  const pack = withSchemaMetadata(packBody);

  if (req.saveManifest) {
    const manifest = await buildManifestFromPack(pack, plan.storedBodies);
    await saveSessionManifest(manifestPath, manifest);
  }

  return pack;
}

export function packToMarkdown(pack: ContextPack): string {
  const lines = [
    `# Context pack`,
    ``,
    `**Task:** ${pack.task}`,
    `**Budget:** ~${pack.budgetTokens} tokens · **Used:** ~${pack.usedTokens} tokens · **Model:** ${pack.tokenModel ?? "chars4"}`,
    `**Root:** \`${pack.root}\``,
  ];

  if (pack.workspace?.scopePrefix) {
    lines.push(
      `**Scope:** \`${pack.workspace.scopePrefix}\` · **Pack root:** \`${pack.workspace.packRoot}\``,
      ``,
    );
  }

  if (pack.git) {
    const parts = [`mode ${pack.git.mode}`];
    if (pack.git.branch) parts.push(`branch \`${pack.git.branch}\``);
    if (pack.git.base) parts.push(`base \`${pack.git.base}\``);
    if (pack.git.since) parts.push(`since \`${pack.git.since}\``);
    lines.push(`**Git:** ${parts.join(" · ")}`, ``);
  } else {
    lines.push(``);
  }

  if (pack.session) {
    lines.push(
      `**Session:** manifest \`${pack.session.manifestPath}\` · reused ${pack.session.reusedFileBodies} file bod${pack.session.reusedFileBodies === 1 ? "y" : "ies"}`,
      ``,
    );
  }

  if (pack.taskParse?.warnings.length) {
    lines.push(`> **Warnings:** ${pack.taskParse.warnings.join(" ")}`, ``);
  }

  lines.push(
    `| File | Why | score | form | ~tokens |`,
    `| --- | --- | ---: | --- | ---: |`,
  );

  for (const f of pack.files) {
    const form = f.presentation === "full" ? "—" : f.presentation;
    lines.push(
      `| \`${f.path}\` | ${f.reasons.join(", ")} | ${f.score} | ${form} | ${f.tokens} |`,
    );
  }

  if (pack.omitted && pack.omitted.length > 0) {
    lines.push(``, `### Omitted (receipts)`, ``);
    lines.push(`| File | score | why omitted |`, `| --- | ---: | --- |`);
    for (const o of pack.omitted) {
      const detail = o.detail ? ` — ${o.detail}` : "";
      lines.push(
        `| \`${o.path}\` | ${o.score} | ${o.omit}${detail} |`,
      );
    }
  }

  if (pack.blockedSecrets && pack.blockedSecrets.length > 0) {
    lines.push(``, `### Blocked (secrets)`, ``);
    for (const b of pack.blockedSecrets) {
      lines.push(`- \`${b.path}\` — ${b.kinds.join(", ")}`);
    }
  }

  lines.push(``, `---`, ``);

  for (const f of pack.files) {
    const tag =
      f.presentation !== "full" ? ` (${f.presentation})` : "";
    lines.push(`## ${f.path}${tag}`, ``, "```", f.content, "```", ``);
  }

  return lines.join("\n");
}
