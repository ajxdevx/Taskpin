import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  mcpGetContextPack,
  mcpGetDeltaContext,
  mcpRoute,
  type McpToolContext,
} from "./mcp-tools.js";

const commonShape = {
  task: z.string().describe("Task description for ranking/packing"),
  root: z
    .string()
    .optional()
    .describe("Project root (must be inside server sandbox)"),
  scope: z
    .string()
    .optional()
    .describe("Monorepo subpath under root, e.g. apps/web"),
  budget: z.number().int().min(500).optional().describe("Token budget"),
  model: z.string().optional().describe("Token model: claude, gpt, chars4, …"),
  profile: z
    .string()
    .optional()
    .describe("Output profile: default, cursor, claude, copilot"),
  format: z
    .enum(["json", "markdown"])
    .optional()
    .describe("Pack output format"),
};

export function createTaskpinMcpServer(sandboxRoot: string): McpServer {
  const ctx: McpToolContext = { sandboxRoot };
  const server = new McpServer({
    name: "taskpin",
    version: "0.1.0",
  });

  server.registerTool(
    "route",
    {
      description:
        "Rank files for a task with scores and signals (no file bodies).",
      inputSchema: {
        ...commonShape,
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (input) => mcpRoute(ctx, input),
  );

  server.registerTool(
    "get_context_pack",
    {
      description:
        "Build a full context pack for the task (JSON or markdown).",
      inputSchema: commonShape,
    },
    async (input) => mcpGetContextPack(ctx, input),
  );

  server.registerTool(
    "get_delta_context",
    {
      description:
        "Refresh a pack from .taskpin/manifest.json (delta session). Requires prior --save-manifest.",
      inputSchema: {
        ...commonShape,
        manifestPath: z.string().optional(),
      },
    },
    async (input) => mcpGetDeltaContext(ctx, input),
  );

  return server;
}

export async function runMcpServer(sandboxRoot: string): Promise<void> {
  const server = createTaskpinMcpServer(sandboxRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
