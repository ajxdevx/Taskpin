import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface InitOptions {
  root: string;
  force?: boolean;
  agents?: boolean;
  cursorRule?: boolean;
  cursorHook?: boolean;
}

export interface InitResult {
  root: string;
  written: string[];
  skipped: string[];
}

const MARKER_START = "<!-- taskpin:start -->";
const MARKER_END = "<!-- taskpin:end -->";

function packageIntegrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "docs", "integrations");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyTemplate(
  srcName: string,
  destAbs: string,
  force: boolean,
  written: string[],
  skipped: string[],
): Promise<void> {
  const src = path.join(packageIntegrationsDir(), srcName);
  if (await exists(destAbs) && !force) {
    skipped.push(destAbs);
    return;
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.copyFile(src, destAbs);
  written.push(destAbs);
}

async function mergeAgentsSnippet(
  root: string,
  force: boolean,
  written: string[],
  skipped: string[],
): Promise<void> {
  const snippetPath = path.join(packageIntegrationsDir(), "AGENTS.snippet.md");
  const snippet = await fs.readFile(snippetPath, "utf8");
  const agentsPath = path.join(root, "AGENTS.md");

  if (await exists(agentsPath)) {
    const current = await fs.readFile(agentsPath, "utf8");
    const hasBlock =
      current.includes(MARKER_START) && current.includes(MARKER_END);
    if (hasBlock && !force) {
      skipped.push(agentsPath);
      return;
    }
    let next = current;
    if (hasBlock) {
      const re = new RegExp(
        `${MARKER_START}[\\s\\S]*?${MARKER_END}`,
        "m",
      );
      next = current.replace(re, snippet.trim());
    } else {
      next = `${current.trimEnd()}\n\n${snippet.trim()}\n`;
    }
    await fs.writeFile(agentsPath, next, "utf8");
    written.push(agentsPath);
    return;
  }

  await fs.writeFile(agentsPath, `${snippet.trim()}\n`, "utf8");
  written.push(agentsPath);
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const root = path.resolve(options.root);
  const force = options.force === true;
  const agents = options.agents !== false;
  const cursorRule = options.cursorRule !== false;
  const cursorHook = options.cursorHook !== false;

  const written: string[] = [];
  const skipped: string[] = [];

  if (agents) {
    await mergeAgentsSnippet(root, force, written, skipped);
  }

  if (cursorRule) {
    await copyTemplate(
      "cursor-rule-taskpin.mdc",
      path.join(root, ".cursor", "rules", "taskpin.mdc"),
      force,
      written,
      skipped,
    );
  }

  if (cursorHook) {
    await copyTemplate(
      "taskpin-pack.mjs",
      path.join(root, ".cursor", "hooks", "taskpin-pack.mjs"),
      force,
      written,
      skipped,
    );
    await copyTemplate(
      "hooks.json",
      path.join(root, ".cursor", "hooks.json"),
      force,
      written,
      skipped,
    );
  }

  return { root, written, skipped };
}
