import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RipgrepSource = "path" | "bundled";

export interface RipgrepExecutable {
  path: string;
  source: RipgrepSource;
}

export async function resolveRipgrep(): Promise<RipgrepExecutable | null> {
  try {
    await execFileAsync("rg", ["--version"], { encoding: "utf8" });
    return { path: "rg", source: "path" };
  } catch {
    try {
      const mod = await import("@vscode/ripgrep");
      const bundled = mod.rgPath as string | undefined;
      if (bundled) {
        await execFileAsync(bundled, ["--version"], { encoding: "utf8" });
        return { path: bundled, source: "bundled" };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function runRipgrep(
  rg: RipgrepExecutable,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync(rg.path, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}
