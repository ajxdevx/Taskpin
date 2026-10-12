import {
  mcpToPackRequest,
  parsePackRequest,
} from "./core/pack-request.js";
import { buildPack } from "./pack.js";
import { renderPackOutput, resolveOutputProfile } from "./profiles.js";
import { buildRoute } from "./route.js";
import { SandboxError, resolveSandboxedPackRoot } from "./sandbox.js";
import type { ContextPack } from "./types.js";

export interface McpToolContext {
  sandboxRoot: string;
}

export interface McpCommonInput {
  task: string;
  root?: string;
  scope?: string;
  budget?: number;
  model?: string;
  profile?: string;
  format?: "json" | "markdown";
}

function packRoot(ctx: McpToolContext, input: McpCommonInput): string {
  return resolveSandboxedPackRoot(ctx.sandboxRoot, input.root, input.scope);
}

function toolText(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function mcpRoute(
  ctx: McpToolContext,
  input: McpCommonInput & { limit?: number },
) {
  try {
    const root = packRoot(ctx, input);
    const report = await buildRoute({
      root,
      task: input.task,
      budgetTokens: input.budget ?? 8000,
      model: input.model,
      limit: input.limit ?? 35,
    });
    return toolText(report);
  } catch (err) {
    if (err instanceof SandboxError) return toolError(err.message);
    throw err;
  }
}

export async function mcpGetContextPack(
  ctx: McpToolContext,
  input: McpCommonInput,
) {
  try {
    const root = packRoot(ctx, input);
    const profile = resolveOutputProfile(input.profile);
    const format = input.format ?? "json";
    const pack = await buildPack(
      mcpToPackRequest(root, {
        task: input.task,
        budget: input.budget,
        model: input.model,
      }),
    );
    if (format === "markdown") {
      return toolText(renderPackOutput(pack, "markdown", profile));
    }
    return toolText(pack);
  } catch (err) {
    if (err instanceof SandboxError) return toolError(err.message);
    throw err;
  }
}

export async function mcpGetDeltaContext(
  ctx: McpToolContext,
  input: McpCommonInput & { manifestPath?: string },
) {
  try {
    const root = packRoot(ctx, input);
    const profile = resolveOutputProfile(input.profile);
    const format = input.format ?? "json";
    let pack: ContextPack;
    try {
      pack = await buildPack(
        parsePackRequest({
          ...mcpToPackRequest(root, input),
          mode: "delta",
          refresh: true,
          saveManifest: true,
          manifestPath: input.manifestPath,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(msg);
    }
    if (format === "markdown") {
      return toolText(renderPackOutput(pack, "markdown", profile));
    }
    return toolText(pack);
  } catch (err) {
    if (err instanceof SandboxError) return toolError(err.message);
    throw err;
  }
}
