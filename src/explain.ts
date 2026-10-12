import {
  computePackPlan,
  explainPathFromPlan,
  type PackPlanOptions,
} from "./plan.js";

export async function explainPath(
  options: PackPlanOptions & { target: string },
): Promise<ReturnType<typeof explainPathFromPlan>> {
  const plan = await computePackPlan({ ...options, readBodies: true });
  return explainPathFromPlan(plan, options.target);
}

export function explainToMarkdown(
  result: ReturnType<typeof explainPathFromPlan>,
  task: string,
): string {
  const lines = [
    `# Explain \`${result.path}\``,
    ``,
    `**Task:** ${task}`,
    ``,
  ];

  if (!result.known) {
    lines.push(`No ranking signals for this path (not in search/git/graph results).`);
    return lines.join("\n");
  }

  lines.push(
    `**Packed:** ${result.packed ? "yes" : "no"}`,
    `**Fused score:** ${result.score ?? "—"}`,
  );

  if (result.omit) {
    lines.push(`**Omitted:** ${result.omit}${result.detail ? ` (${result.detail})` : ""}`);
  }

  if (result.diversityPenalty && result.diversityPenalty > 0) {
    lines.push(
      `**Diversity penalty:** −${Math.round(result.diversityPenalty)} (many files in same top-level folder)`,
    );
  }

  if (result.reasons.length > 0) {
    lines.push(``, `**Reason tags:** ${result.reasons.join(", ")}`, ``);
  }

  if (result.signals.length > 0) {
    lines.push(`| Signal | raw | weighted | applied |`, `| --- | ---: | ---: | --- |`);
    for (const s of result.signals) {
      lines.push(
        `| ${s.reason} | ${Math.round(s.points)} | ${Math.round(s.weighted)} | ${s.applied ? "yes" : "no"} |`,
      );
    }
    lines.push(``);
  }

  if (result.suppressedHits.length > 0) {
    lines.push(`**Globally capped (not applied):**`);
    for (const h of result.suppressedHits) {
      lines.push(`- ${h.reason} (${h.points} raw points)`);
    }
    lines.push(``);
  }

  if (result.rawContributions.length > 0 && result.signals.length === 0) {
    lines.push(`**Raw contributions:**`);
    for (const c of result.rawContributions) {
      lines.push(`- ${c.reason}: ${c.points}`);
    }
  }

  return lines.join("\n");
}
