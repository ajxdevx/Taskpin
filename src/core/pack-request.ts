import { z } from "zod";
import type { PackSessionManifest } from "../manifest.js";
import type { ResolvedInvocation } from "../config.js";

export const PackModeSchema = z.enum(["default", "changed", "delta"]);

export const PackRequestSchema = z.object({
  root: z.string().min(1),
  task: z.string().min(1),
  budgetTokens: z.number().int().min(500),
  redactSecrets: z.boolean().default(true),
  mode: PackModeSchema.default("default"),
  base: z.string().optional(),
  since: z.string().optional(),
  model: z.string().optional(),
  useIndex: z.boolean().default(false),
  indexPath: z.string().optional(),
  manifestPath: z.string().optional(),
  refresh: z.boolean().default(false),
  saveManifest: z.boolean().default(false),
});

export type PackRequest = z.infer<typeof PackRequestSchema>;

export type PackPlanOptions = z.input<typeof PackRequestSchema> & {
  readBodies?: boolean;
  sessionManifest?: PackSessionManifest | null;
};

export type PackBuildOptions = z.input<typeof PackRequestSchema> & {
  sessionManifest?: PackSessionManifest | null;
};

export function parsePackRequest(input: unknown): PackRequest {
  return PackRequestSchema.parse(input);
}

export function packRequestFromInvocation(
  inv: ResolvedInvocation,
  task: string,
  mode: z.infer<typeof PackModeSchema>,
): PackRequest {
  return parsePackRequest({
    root: inv.root,
    task,
    budgetTokens: inv.budgetTokens,
    redactSecrets: inv.redactSecrets,
    mode,
    base: inv.base,
    since: inv.since,
    model: inv.tokenModel,
    useIndex: inv.useIndex,
    indexPath: inv.indexPath,
    manifestPath: inv.manifestPath,
    refresh: inv.refresh,
    saveManifest: inv.saveManifest,
  });
}

export function toPlanOptions(
  req: PackRequest,
  extra?: {
    readBodies?: boolean;
    sessionManifest?: PackSessionManifest | null;
  },
): PackPlanOptions {
  return {
    ...req,
    readBodies: extra?.readBodies,
    sessionManifest: extra?.sessionManifest ?? null,
  };
}

export function mcpToPackRequest(
  root: string,
  input: {
    task: string;
    budget?: number;
    model?: string;
  },
): PackRequest {
  return parsePackRequest({
    root,
    task: input.task,
    budgetTokens: input.budget ?? 8000,
    model: input.model,
    useIndex: true,
  });
}
