import { computePackPlan, type PackPlan, type PackPlanOptions } from "./plan.js";

export interface RouteRow {
  path: string;
  score: number;
  reasons: string[];
  packed: boolean;
  signals: Array<{
    reason: string;
    points: number;
    weighted: number;
    applied: boolean;
  }>;
}

export interface RouteReport {
  task: string;
  root: string;
  budgetTokens: number;
  contentBudget: number;
  packedCount: number;
  omittedCount: number;
  rows: RouteRow[];
}

export async function buildRoute(
  options: PackPlanOptions & { limit?: number },
): Promise<RouteReport> {
  const limit = options.limit ?? 35;
  const plan = await computePackPlan({ ...options, readBodies: false });
  const packedSet = new Set(plan.packed.map((f) => f.path));
  const rows: RouteRow[] = plan.ranked.slice(0, limit).map((r) => ({
    path: r.path,
    score: r.score,
    reasons: r.reasons,
    packed: packedSet.has(r.path),
    signals: r.signals,
  }));

  return {
    task: plan.task,
    root: plan.root,
    budgetTokens: plan.budgetTokens,
    contentBudget: plan.contentBudget,
    packedCount: plan.packed.length,
    omittedCount: plan.omitted.length,
    rows,
  };
}

export function routeToMarkdown(report: RouteReport): string {
  const lines = [
    `# Route`,
    ``,
    `**Task:** ${report.task}`,
    `**Budget:** ~${report.budgetTokens} tokens (content ~${report.contentBudget})`,
    `**Root:** \`${report.root}\``,
    `**Would pack:** ${report.packedCount} files · **Omitted:** ${report.omittedCount} receipts`,
    ``,
    `| File | score | pack? | signals (applied) |`,
    `| --- | ---: | --- | --- |`,
  ];

  for (const row of report.rows) {
    const sig = row.signals
      .filter((s) => s.applied)
      .map((s) => `${s.reason}:${Math.round(s.weighted)}`)
      .join(", ");
    lines.push(
      `| \`${row.path}\` | ${row.score} | ${row.packed ? "yes" : "no"} | ${sig || "—"} |`,
    );
  }

  return lines.join("\n");
}

export function routeFromPlan(plan: PackPlan, limit = 35): RouteReport {
  const packedSet = new Set(plan.packed.map((f) => f.path));
  return {
    task: plan.task,
    root: plan.root,
    budgetTokens: plan.budgetTokens,
    contentBudget: plan.contentBudget,
    packedCount: plan.packed.length,
    omittedCount: plan.omitted.length,
    rows: plan.ranked.slice(0, limit).map((r) => ({
      path: r.path,
      score: r.score,
      reasons: r.reasons,
      packed: packedSet.has(r.path),
      signals: r.signals,
    })),
  };
}
