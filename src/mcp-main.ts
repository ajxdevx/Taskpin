#!/usr/bin/env node
import path from "node:path";
import { runMcpServer } from "./mcp-server.js";

const sandbox =
  typeof process.env.TASKPIN_ROOT === "string" &&
  process.env.TASKPIN_ROOT.trim()
    ? path.resolve(process.env.TASKPIN_ROOT.trim())
    : process.cwd();

runMcpServer(sandbox).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
