import fs from "node:fs/promises";
import type { ResolvedInvocation, TaskpinCommand } from "../../config.js";
import {
  packRequestFromInvocation,
  type PackRequest,
} from "../../core/pack-request.js";
import { explainPath, explainToMarkdown } from "../../explain.js";
import { buildPack } from "../../pack.js";
import { renderPackOutput, resolveOutputProfile } from "../../profiles.js";
import { buildRoute, routeToMarkdown } from "../../route.js";
import { printHelp } from "../help.js";

function resolvePackMode(command: TaskpinCommand): PackRequest["mode"] {
  if (command === "changed") return "changed";
  if (command === "delta") return "delta";
  return "default";
}

export async function handlePackPipeline(
  command: TaskpinCommand,
  inv: ResolvedInvocation,
  task: string,
): Promise<void> {
  const budgetTokens = inv.budgetTokens;
  if (!Number.isFinite(budgetTokens) || budgetTokens < 500) {
    console.error("Error: --budget must be a number >= 500");
    process.exit(1);
  }

  const profile = resolveOutputProfile(inv.profile);
  const format = inv.format;
  const redactSecrets = inv.redactSecrets;

  if (!redactSecrets) {
    console.error(
      "Warning: --no-redact may include live tokens in the pack output.",
    );
  }

  const packReq = packRequestFromInvocation(
    inv,
    task,
    resolvePackMode(command),
  );

  if (command === "route") {
    const report = await buildRoute({
      ...packReq,
      limit: 35,
    });
    const output =
      format === "json"
        ? JSON.stringify(report, null, 2)
        : routeToMarkdown(report);
    if (inv.outFile) {
      await fs.writeFile(inv.outFile, output, "utf8");
      console.error(`Wrote route (${report.rows.length} rows) → ${inv.outFile}`);
    } else {
      process.stdout.write(output);
    }
    return;
  }

  if (command === "explain") {
    if (!inv.explainTarget) {
      console.error("Error: explain requires a path (taskpin explain <path>)\n");
      printHelp();
      process.exit(1);
    }
    const result = await explainPath({
      ...packReq,
      target: inv.explainTarget,
    });
    const output =
      format === "json"
        ? JSON.stringify(result, null, 2)
        : explainToMarkdown(result, task);
    if (inv.outFile) {
      await fs.writeFile(inv.outFile, output, "utf8");
      console.error(`Wrote explain for ${result.path} → ${inv.outFile}`);
    } else {
      process.stdout.write(output);
    }
    return;
  }

  const pack = await buildPack(packReq);

  if (pack.taskParse?.warnings.length) {
    for (const w of pack.taskParse.warnings) {
      console.error(`Warning: ${w}`);
    }
  }

  if (format !== "json" && format !== "markdown") {
    console.error(`Error: unknown format "${format}"`);
    process.exit(1);
  }

  const output = renderPackOutput(pack, format, profile);

  if (inv.outFile) {
    await fs.writeFile(inv.outFile, output, "utf8");
    console.error(
      `Wrote ${pack.files.length} files (~${pack.usedTokens} tokens) → ${inv.outFile}`,
    );
  } else {
    process.stdout.write(output);
  }
}
