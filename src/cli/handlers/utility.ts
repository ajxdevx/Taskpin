import type { ResolvedInvocation } from "../../config.js";
import { runDoctor } from "../../doctor.js";
import {
  buildFileIndex,
  computeStaleReport,
  defaultFileIndexPath,
  formatStaleReport,
  loadFileIndex,
  saveFileIndex,
} from "../../file-index.js";
import { runTaskpinCi } from "../../integrations/ci.js";
import { runInit } from "../../integrations/init.js";
import { runMcpServer } from "../../mcp-server.js";
import { loadPublishedSchema } from "../../schema.js";
import { runSecretCheck } from "../../secrets.js";
import { runStats } from "../../stats.js";
import type { CliArgs } from "../../config.js";

export async function handleMcp(inv: ResolvedInvocation): Promise<void> {
  console.error(`taskpin MCP sandbox: ${inv.root}`);
  await runMcpServer(inv.root);
}

export async function handleInit(
  inv: ResolvedInvocation,
  flagArgs: CliArgs,
): Promise<void> {
  const result = await runInit({
    root: inv.root,
    force: flagArgs.force === true,
    agents: flagArgs["no-agents"] !== true,
    cursorRule: flagArgs["no-rule"] !== true,
    cursorHook: flagArgs["no-hook"] !== true,
  });
  for (const p of result.written) {
    console.error(`Wrote ${p}`);
  }
  for (const p of result.skipped) {
    console.error(`Skipped (exists): ${p}`);
  }
  if (result.written.length === 0 && result.skipped.length > 0) {
    console.error("Nothing changed. Use --force to overwrite.");
  }
}

export async function handleCi(
  inv: ResolvedInvocation,
  flagArgs: CliArgs,
): Promise<void> {
  const outputDir =
    typeof flagArgs["output-dir"] === "string" &&
    flagArgs["output-dir"].trim()
      ? flagArgs["output-dir"].trim()
      : "taskpin-output";
  const mode = typeof flagArgs.mode === "string" ? flagArgs.mode : undefined;
  const eventPath =
    typeof flagArgs["event-path"] === "string"
      ? flagArgs["event-path"]
      : undefined;
  const baseOverride =
    typeof flagArgs.base === "string" ? flagArgs.base : inv.base;
  try {
    await runTaskpinCi({
      root: inv.root,
      taskOverride: inv.task,
      budgetTokens: inv.budgetTokens,
      mode,
      baseOverride,
      eventPath,
      outputDir,
      profile: inv.profile ?? "default",
      redactSecrets: inv.redactSecrets,
      tokenModel: inv.tokenModel,
      skipScan: flagArgs["skip-scan"] === true,
      scanOnly: flagArgs["scan-only"] === true,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === "SECRET_SCAN") process.exit(1);
    throw err;
  }
}

export async function handleSchema(): Promise<void> {
  const schema = await loadPublishedSchema();
  process.stdout.write(schema);
}

export async function handleDoctor(inv: ResolvedInvocation): Promise<void> {
  const report = await runDoctor(inv.root);
  for (const line of report.lines) {
    console.error(line);
  }
  process.exit(report.ok ? 0 : 1);
}

export async function handleStats(inv: ResolvedInvocation): Promise<void> {
  const report = await runStats(inv.root, {
    model: inv.tokenModel,
    minTokens: inv.minTokens,
  });
  process.stdout.write(`${report.lines.join("\n")}\n`);
}

export async function handleIndex(inv: ResolvedInvocation): Promise<void> {
  const indexPath = inv.indexPath ?? defaultFileIndexPath(inv.root);
  const built = await buildFileIndex(inv.root);
  await saveFileIndex(indexPath, built);
  console.error(
    `Wrote file index (${built.fileCount} paths) → ${indexPath}`,
  );
}

export async function handleStale(inv: ResolvedInvocation): Promise<void> {
  const indexPath = inv.indexPath ?? defaultFileIndexPath(inv.root);
  const loaded = await loadFileIndex(indexPath);
  if (!loaded) {
    console.error(`No file index at ${indexPath}. Run: taskpin index`);
    process.exit(1);
  }
  const report = await computeStaleReport(inv.root, loaded);
  const output =
    inv.format === "json"
      ? JSON.stringify(report, null, 2)
      : formatStaleReport(report);
  process.stdout.write(`${output}\n`);
  const dirty =
    report.added.length +
    report.changed.length +
    report.removed.length +
    (report.headDrift ? 1 : 0);
  if (dirty > 0) process.exit(2);
}

export async function handleCheck(inv: ResolvedInvocation): Promise<void> {
  const findings = await runSecretCheck(inv.root);
  if (findings.length === 0) {
    console.error("No suspected secrets found.");
    process.exit(0);
  }
  for (const f of findings) {
    console.error(`${f.path}:${f.line}  ${f.kind}`);
  }
  console.error(`\n${findings.length} suspected secret(s).`);
  process.exit(1);
}
