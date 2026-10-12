import type { TaskpinCommand } from "../config.js";
import { bootstrapCli } from "./bootstrap.js";
import { printHelp } from "./help.js";
import { resolveTask } from "./parse.js";
import { handlePackPipeline } from "./handlers/pipeline.js";
import {
  handleCheck,
  handleCi,
  handleDoctor,
  handleIndex,
  handleInit,
  handleMcp,
  handleSchema,
  handleStale,
  handleStats,
} from "./handlers/utility.js";

const PIPELINE_COMMANDS: TaskpinCommand[] = [
  "pack",
  "route",
  "changed",
  "delta",
  "explain",
];

export async function runCli(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  let command: TaskpinCommand;
  let flagArgs;
  let inv;

  try {
    const boot = await bootstrapCli(rawArgv);
    command = boot.command;
    flagArgs = boot.flagArgs;
    inv = boot.inv;
  } catch (err) {
    if (err instanceof Error && err.message === "NO_COMMAND") {
      console.error(
        "Error: specify a command (pack, route, changed, …) or --task\n",
      );
      printHelp();
      process.exit(1);
    }
    throw err;
  }

  if (flagArgs.help) {
    printHelp();
    return;
  }

  switch (command) {
    case "mcp":
      await handleMcp(inv);
      return;
    case "init":
      await handleInit(inv, flagArgs);
      return;
    case "ci":
      await handleCi(inv, flagArgs);
      return;
    case "schema":
      await handleSchema();
      return;
    case "doctor":
      await handleDoctor(inv);
      return;
    case "stats":
      await handleStats(inv);
      return;
    case "index":
      await handleIndex(inv);
      return;
    case "stale":
      await handleStale(inv);
      return;
    case "check":
      await handleCheck(inv);
      return;
    default:
      break;
  }

  if (PIPELINE_COMMANDS.includes(command)) {
    const task = resolveTask(command, inv.task);
    if (!task) {
      console.error(`Error: --task is required for ${command}\n`);
      printHelp();
      process.exit(1);
    }
    await handlePackPipeline(command, inv, task);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
