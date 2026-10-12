import fs from "node:fs/promises";
import path from "node:path";
import { createDiscoveryContext } from "./discovery.js";
import {
  createTokenEstimator,
  resolveTokenModel,
  type TokenModel,
} from "./tokens.js";
import { runPool } from "./pool.js";
import { walkPackableFiles } from "./walk.js";

interface TreeNode {
  name: string;
  tokens: number;
  files: number;
  children: Map<string, TreeNode>;
}

function ensureChild(parent: TreeNode, name: string): TreeNode {
  let child = parent.children.get(name);
  if (!child) {
    child = { name, tokens: 0, files: 0, children: new Map() };
    parent.children.set(name, child);
  }
  return child;
}

function addFileTokens(root: TreeNode, relPath: string, tokens: number): void {
  const parts = relPath.replace(/\\/g, "/").split("/").filter(Boolean);
  let node = root;
  for (const part of parts) {
    node = ensureChild(node, part);
  }
  node.tokens += tokens;
  node.files += 1;
}

function renderTree(
  node: TreeNode,
  prefix: string,
  minTokens: number,
  lines: string[],
): void {
  const entries = [...node.children.values()].sort(
    (a, b) => b.tokens - a.tokens,
  );
  for (const child of entries) {
    if (child.tokens < minTokens && child.children.size === 0) continue;
    const label =
      child.children.size > 0
        ? `${child.name}/`
        : child.name;
    lines.push(
      `${prefix}${label}  ${child.tokens.toLocaleString()} tokens  (${child.files} files)`,
    );
    if (child.children.size > 0) {
      renderTree(child, `${prefix}  `, minTokens, lines);
    }
  }
}

export interface StatsReport {
  model: TokenModel;
  totalTokens: number;
  totalFiles: number;
  lines: string[];
}

export async function runStats(
  root: string,
  options?: { model?: string; minTokens?: number },
): Promise<StatsReport> {
  const absRoot = path.resolve(root);
  const model = resolveTokenModel(options?.model);
  const estimate = createTokenEstimator(model);
  const minTokens = options?.minTokens ?? 200;
  const discovery = await createDiscoveryContext(absRoot);
  const task = "stats";
  const files = await walkPackableFiles(discovery, task);

  const tree: TreeNode = {
    name: ".",
    tokens: 0,
    files: 0,
    children: new Map(),
  };

  const tokenRows = await runPool(files, 16, async (rel) => {
    const abs = path.join(absRoot, rel);
    try {
      const text = await fs.readFile(abs, "utf8");
      return { rel, tokens: estimate(text) };
    } catch {
      return null;
    }
  });

  let totalTokens = 0;
  for (const row of tokenRows) {
    if (!row) continue;
    totalTokens += row.tokens;
    addFileTokens(tree, row.rel, row.tokens);
  }

  const lines = [
    `Token tree (${model}, ~${CHARS_PER_TOKEN_LABEL[model]} chars/token)`,
    `Root: ${absRoot}`,
    `Total: ${totalTokens.toLocaleString()} tokens across ${files.length} files`,
    "",
  ];
  renderTree(tree, "", minTokens, lines);

  return {
    model,
    totalTokens,
    totalFiles: files.length,
    lines,
  };
}

const CHARS_PER_TOKEN_LABEL: Record<TokenModel, string> = {
  chars4: "4",
  claude: "3.7",
  gpt: "4",
  gemini: "4",
  ollama: "4.2",
};
