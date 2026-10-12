import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parsePackRequest } from "../core/pack-request.js";
import { buildPack } from "../pack.js";
import {
  parseGithubEvent,
  resolveCiPackMode,
  type ParsedGithubEvent,
} from "./github-event.js";
import { renderPackOutput, resolveOutputProfile } from "../profiles.js";
import { runSecretCheck } from "../secrets.js";
import type { ContextPack } from "../types.js";

export interface TaskpinCiOptions {
  root: string;
  taskOverride?: string;
  budgetTokens: number;
  mode?: string;
  baseOverride?: string;
  eventPath?: string;
  eventName?: string;
  outputDir: string;
  profile?: string;
  redactSecrets: boolean;
  tokenModel?: string;
  skipScan?: boolean;
  scanOnly?: boolean;
}

export interface TaskpinCiResult {
  ok: boolean;
  scanFindings: number;
  event: ParsedGithubEvent;
  task: string;
  packMode: "default" | "changed";
  markdownPath: string;
  jsonPath: string;
  commentPath: string;
  summaryPath: string;
  pack: ContextPack | null;
}

const COMMENT_MAX = 62000;

async function readEventPayload(eventPath: string): Promise<{
  payload: unknown;
  eventName?: string;
}> {
  const raw = await fs.readFile(eventPath, "utf8");
  const payload = JSON.parse(raw) as unknown;
  const eventName = process.env.GITHUB_EVENT_NAME;
  return { payload, eventName };
}

async function appendGithubOutput(key: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = crypto.randomUUID();
  await fs.appendFile(
    file,
    `${key}<<${delimiter}\n${value}\n${delimiter}\n`,
    "utf8",
  );
}

function buildCommentBody(
  event: ParsedGithubEvent,
  task: string,
  pack: ContextPack,
  markdown: string,
): string {
  const header: string[] = [
    "<!-- taskpin-context-pack -->",
    "### taskpin context pack",
    "",
  ];
  if (event.htmlUrl) {
    header.push(`Source: ${event.htmlUrl}`);
  }
  if (event.number !== undefined) {
    header.push(`#${event.number}${event.title ? ` — ${event.title}` : ""}`);
  }
  header.push(
    "",
    `**Task:** ${task.replace(/\n/g, " ").slice(0, 500)}`,
    `**Files:** ${pack.files.length} (~${pack.usedTokens} tokens)`,
    "",
    "<details>",
    "<summary>Context pack (markdown)</summary>",
    "",
  );
  const footer = ["", "</details>", ""];
  let body = [...header, markdown, ...footer].join("\n");
  if (body.length <= COMMENT_MAX) return body;

  const fileList = pack.files
    .map((f) => `- \`${f.path}\` (${f.reasons.join(", ")})`)
    .join("\n");
  const trimmed = markdown.slice(0, COMMENT_MAX - header.join("\n").length - 800);
  body = [
    ...header,
    trimmed,
    "\n\n…pack truncated for GitHub comment size…\n\n",
    "**Included files:**\n",
    fileList,
    ...footer,
  ].join("\n");
  if (body.length > COMMENT_MAX) {
    body = body.slice(0, COMMENT_MAX - 20) + "\n…</details>\n";
  }
  return body;
}

function buildSummaryMarkdown(
  event: ParsedGithubEvent,
  task: string,
  pack: ContextPack,
  packMode: "default" | "changed",
  scanFindings: number,
): string {
  const lines = [
    "# taskpin CI summary",
    "",
    `- **Event:** ${event.kind}`,
    `- **Pack mode:** ${packMode}`,
    `- **Task:** ${task.split("\n")[0]}`,
    `- **Files packed:** ${pack.files.length}`,
    `- **Tokens (est.):** ${pack.usedTokens}`,
    `- **Secret scan findings:** ${scanFindings}`,
    "",
    "## Files",
    "",
  ];
  for (const f of pack.files) {
    lines.push(`- \`${f.path}\` — ${f.reasons.join(", ")}`);
  }
  if (pack.omitted?.length) {
    lines.push("", "## Top omitted", "");
    for (const o of pack.omitted.slice(0, 15)) {
      lines.push(`- \`${o.path}\` — ${o.omit}`);
    }
  }
  return lines.join("\n");
}

export async function runTaskpinCi(
  options: TaskpinCiOptions,
): Promise<TaskpinCiResult> {
  const absRoot = path.resolve(options.root);
  const outDir = path.resolve(absRoot, options.outputDir);
  await fs.mkdir(outDir, { recursive: true });

  let scanFindings = 0;
  if (!options.skipScan) {
    const findings = await runSecretCheck(absRoot);
    scanFindings = findings.length;
    if (findings.length > 0) {
      for (const f of findings) {
        console.error(`${f.path}:${f.line}  ${f.kind}`);
      }
      console.error(
        `\nSecret scan failed: ${findings.length} suspected secret(s). Fix or exclude before packing.`,
      );
      await appendGithubOutput("scan-findings", String(findings.length));
      const err = new Error("Secret scan failed") as Error & { code?: string };
      err.code = "SECRET_SCAN";
      throw err;
    }
    console.error("Secret scan: clean.");
  }

  if (options.scanOnly) {
    const stub: ParsedGithubEvent = {
      kind: "unknown",
      task: "",
      packMode: "default",
    };
    return {
      ok: true,
      scanFindings,
      event: stub,
      task: "",
      packMode: "default",
      markdownPath: path.join(outDir, "taskpin-context.md"),
      jsonPath: path.join(outDir, "taskpin-context.json"),
      commentPath: path.join(outDir, "taskpin-comment.md"),
      summaryPath: path.join(outDir, "taskpin-summary.md"),
      pack: null,
    };
  }

  let payload: unknown = {};
  let eventName = options.eventName ?? process.env.GITHUB_EVENT_NAME;
  const eventPath =
    options.eventPath ??
    process.env.GITHUB_EVENT_PATH ??
    process.env.TASKPIN_EVENT_PATH;
  if (eventPath) {
    try {
      const loaded = await readEventPayload(eventPath);
      payload = loaded.payload;
      eventName = options.eventName ?? loaded.eventName;
    } catch (err) {
      console.error(
        `Warning: could not read GitHub event at ${eventPath}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const event = parseGithubEvent(payload, eventName);
  const packMode = resolveCiPackMode(options.mode, event);
  const task =
    (options.taskOverride && options.taskOverride.trim()) || event.task;
  const base = options.baseOverride?.trim() || event.base;

  const profile = resolveOutputProfile(options.profile ?? "default");
  const pack = await buildPack(
    parsePackRequest({
      root: absRoot,
      task,
      budgetTokens: options.budgetTokens,
      redactSecrets: options.redactSecrets,
      mode: packMode === "changed" ? "changed" : "default",
      base,
      model: options.tokenModel,
    }),
  );

  const markdown = renderPackOutput(pack, "markdown", profile);
  const json = renderPackOutput(pack, "json", profile);
  const markdownPath = path.join(outDir, "taskpin-context.md");
  const jsonPath = path.join(outDir, "taskpin-context.json");
  const commentPath = path.join(outDir, "taskpin-comment.md");
  const summaryPath = path.join(outDir, "taskpin-summary.md");

  await fs.writeFile(markdownPath, markdown, "utf8");
  await fs.writeFile(jsonPath, json, "utf8");
  await fs.writeFile(
    commentPath,
    buildCommentBody(event, task, pack, markdown),
    "utf8",
  );
  await fs.writeFile(
    summaryPath,
    buildSummaryMarkdown(event, task, pack, packMode, scanFindings),
    "utf8",
  );

  await appendGithubOutput("markdown-path", markdownPath);
  await appendGithubOutput("json-path", jsonPath);
  await appendGithubOutput("comment-path", commentPath);
  await appendGithubOutput("summary-path", summaryPath);
  await appendGithubOutput("pack-files", String(pack.files.length));
  await appendGithubOutput("pack-tokens", String(pack.usedTokens));
  await appendGithubOutput("scan-findings", String(scanFindings));

  console.error(
    `Wrote context pack (${pack.files.length} files, ~${pack.usedTokens} tokens) → ${outDir}`,
  );

  return {
    ok: true,
    scanFindings,
    event,
    task,
    packMode,
    markdownPath,
    jsonPath,
    commentPath,
    summaryPath,
    pack,
  };
}
