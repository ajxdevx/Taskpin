#!/usr/bin/env node
import { runCli } from "./cli/run.js";

runCli().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
