import {
  TASKPIN_COMMANDS,
  type CliArgs,
  type TaskpinCommand,
} from "../config.js";

export function parseFlagArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

export function parseInvocation(argv: string[]): {
  command: TaskpinCommand | null;
  args: CliArgs;
} {
  const rest = [...argv];
  let command: TaskpinCommand | null = null;

  if (rest[0] && !rest[0].startsWith("-")) {
    const head = rest[0].toLowerCase();
    if (TASKPIN_COMMANDS.includes(head as TaskpinCommand)) {
      command = head as TaskpinCommand;
      rest.shift();
    }
  }

  const args = parseFlagArgs(rest);

  if (command === "explain" && typeof args.explain !== "string") {
    for (const a of rest) {
      if (!a.startsWith("-")) {
        args.explain = a;
        break;
      }
    }
  }

  return { command, args };
}

export function resolveTask(
  command: TaskpinCommand,
  task: string | undefined,
): string | null {
  if (typeof task === "string" && task.trim()) return task.trim();
  if (command === "changed") return "review current branch changes";
  if (command === "pack" || command === "route" || command === "explain") {
    return null;
  }
  if (command === "delta") {
    return null;
  }
  return null;
}
