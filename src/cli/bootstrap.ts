import path from "node:path";
import {
  inferCommandFromFlags,
  loadTaskpinConfig,
  resolveInvocation,
  type CliArgs,
  type ResolvedInvocation,
  type TaskpinCommand,
} from "../config.js";
import { parseInvocation } from "./parse.js";

export async function bootstrapCli(argv: string[]): Promise<{
  command: TaskpinCommand;
  flagArgs: CliArgs;
  inv: ResolvedInvocation;
}> {
  const { command: explicitCommand, args: flagArgs } = parseInvocation(argv);

  const preliminaryRoot =
    typeof flagArgs.root === "string"
      ? path.resolve(flagArgs.root)
      : process.cwd();

  const command =
    explicitCommand ?? inferCommandFromFlags(flagArgs) ?? null;

  if (!command) {
    throw new Error("NO_COMMAND");
  }

  const bootstrap = await loadTaskpinConfig(preliminaryRoot);
  const rootHint = resolveInvocation(
    command,
    flagArgs,
    bootstrap.config,
    bootstrap.configPath,
    process.cwd(),
  ).root;
  const { config, configPath } = await loadTaskpinConfig(rootHint);
  const inv = resolveInvocation(
    command,
    flagArgs,
    config,
    configPath,
    process.cwd(),
  );

  return { command, flagArgs, inv };
}
