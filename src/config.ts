import fs from "node:fs/promises";
import path from "node:path";
import { resolvePackRoot } from "./workspace.js";

export const TASKPIN_CONFIG_NAME = ".taskpin.json";

export interface TaskpinConfig {
  root?: string;
  scope?: string;
  task?: string;
  budget?: number;
  model?: string;
  profile?: string;
  format?: "markdown" | "json" | string;
  base?: string;
  out?: string;
  redactSecrets?: boolean;
  minTokens?: number;
  since?: string;
  manifest?: string;
  saveManifest?: boolean;
  useIndex?: boolean;
  index?: string;
}

export interface LoadedConfig {
  config: TaskpinConfig;
  configPath: string | null;
}

export async function loadTaskpinConfig(
  searchRoot: string,
): Promise<LoadedConfig> {
  const configPath = path.join(path.resolve(searchRoot), TASKPIN_CONFIG_NAME);
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as TaskpinConfig;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { config: {}, configPath };
    }
    return { config: parsed, configPath };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { config: {}, configPath: null };
    }
    throw new Error(
      `Invalid ${TASKPIN_CONFIG_NAME} at ${configPath}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export function resolveRoot(
  cliRoot: string | undefined,
  configRoot: string | undefined,
  cwd: string,
): string {
  const pick = cliRoot ?? configRoot;
  return path.resolve(pick ?? cwd);
}

export type CliArgs = Record<string, string | boolean>;

function pickString(
  args: CliArgs,
  key: string,
  configVal: string | undefined,
): string | undefined {
  const v = args[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return configVal?.trim() || undefined;
}

function pickInt(
  args: CliArgs,
  key: string,
  configVal: number | undefined,
  defaultVal: number,
): number {
  const v = args[key];
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  if (typeof configVal === "number" && Number.isFinite(configVal)) {
    return configVal;
  }
  return defaultVal;
}

export type TaskpinCommand =
  | "pack"
  | "route"
  | "changed"
  | "delta"
  | "stats"
  | "doctor"
  | "check"
  | "explain"
  | "schema"
  | "index"
  | "stale"
  | "mcp"
  | "ci"
  | "init";

export const TASKPIN_COMMANDS: TaskpinCommand[] = [
  "pack",
  "route",
  "changed",
  "delta",
  "stats",
  "doctor",
  "check",
  "explain",
  "schema",
  "index",
  "stale",
  "mcp",
  "ci",
  "init",
];

export interface ResolvedInvocation {
  command: TaskpinCommand;
  root: string;
  configPath: string | null;
  task?: string;
  budgetTokens: number;
  format: string;
  profile?: string;
  base?: string;
  outFile: string | null;
  redactSecrets: boolean;
  tokenModel?: string;
  minTokens: number;
  explainTarget: string;
  since?: string;
  manifestPath?: string;
  refresh: boolean;
  saveManifest: boolean;
  useIndex: boolean;
  indexPath?: string;
}

export function inferCommandFromFlags(args: CliArgs): TaskpinCommand | null {
  if (args["print-schema"] === true) return "schema";
  if (args.doctor === true) return "doctor";
  if (args.stats === true) return "stats";
  if (args.check === true) return "check";
  if (args.route === true) return "route";
  if (args.changed === true) return "changed";
  if (typeof args.explain === "string" && args.explain.trim()) return "explain";
  if (args.delta === true || args.refresh === true) return "delta";
  if (typeof args.task === "string" && args.task.trim()) return "pack";
  return null;
}

export function resolveInvocation(
  command: TaskpinCommand,
  args: CliArgs,
  config: TaskpinConfig,
  configPath: string | null,
  cwd: string,
): ResolvedInvocation {
  const baseRoot = resolveRoot(
    typeof args.root === "string" ? args.root : undefined,
    config.root,
    cwd,
  );
  const scope = pickString(args, "scope", config.scope);
  const root = resolvePackRoot(baseRoot, scope);

  return {
    command,
    root,
    configPath,
    task: pickString(args, "task", config.task),
    budgetTokens: pickInt(args, "budget", config.budget, 8000),
    format: pickString(args, "format", config.format) ?? "markdown",
    profile: pickString(args, "profile", config.profile),
    base: pickString(args, "base", config.base),
    outFile: pickString(args, "out", config.out) ?? null,
    redactSecrets:
      args["no-redact"] === true
        ? false
        : config.redactSecrets !== undefined
          ? config.redactSecrets
          : true,
    tokenModel: pickString(args, "model", config.model),
    minTokens: pickInt(
      args,
      "min-tokens",
      config.minTokens,
      200,
    ),
    explainTarget:
      typeof args.explain === "string" ? args.explain.trim() : "",
    since: pickString(args, "since", config.since),
    manifestPath: pickString(args, "manifest", config.manifest),
    refresh: args.refresh === true || command === "delta",
    saveManifest:
      args["save-manifest"] === true ||
      config.saveManifest === true ||
      command === "delta",
    useIndex: args["use-index"] === true || config.useIndex === true,
    indexPath: pickString(args, "index", config.index),
  };
}
