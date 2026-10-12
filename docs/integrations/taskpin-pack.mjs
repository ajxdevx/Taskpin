#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function pickTask(input) {
  const candidates = [
    input.prompt,
    input.text,
    input.user_message,
    input.message,
    input.content,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      return c.trim().split("\n")[0].slice(0, 4000);
    }
  }
  return "";
}

function resolveProjectRoot() {
  if (process.env.CURSOR_PROJECT_DIR) {
    return path.resolve(process.env.CURSOR_PROJECT_DIR);
  }
  return process.cwd();
}

function resolveTaskpinCommand(root) {
  const envCli = process.env.TASKPIN_CLI?.trim();
  if (envCli) return { cmd: envCli, prefixArgs: [] };

  const localCli = path.join(
    root,
    "node_modules",
    "taskpin",
    "dist",
    "cli.js",
  );
  if (fs.existsSync(localCli)) {
    return { cmd: process.execPath, prefixArgs: [localCli] };
  }

  return { cmd: "taskpin", prefixArgs: [] };
}

function runPack(root, task, outFile) {
  const { cmd, prefixArgs } = resolveTaskpinCommand(root);
  const args = [
    ...prefixArgs,
    "pack",
    "--root",
    root,
    "--task",
    task,
    "--budget",
    process.env.TASKPIN_BUDGET ?? "12000",
    "--profile",
    process.env.TASKPIN_PROFILE ?? "cursor",
    "--out",
    outFile,
  ];
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return result.status === 0;
}

const input = readStdin();
const task = pickTask(input);
const allow = { permission: "allow" };

if (!task || task.length < 6) {
  process.stdout.write(`${JSON.stringify(allow)}\n`);
  process.exit(0);
}

const root = resolveProjectRoot();
const outDir = path.join(root, ".taskpin");
const outFile = path.join(outDir, "hook-pack.md");
fs.mkdirSync(outDir, { recursive: true });

const ok = runPack(root, task, outFile);
const rel = path.relative(root, outFile).replace(/\\/g, "/");
const response = ok
  ? {
      permission: "allow",
      agent_message: `taskpin wrote a context pack for this task at ${rel}. Read it before broad repo search.`,
    }
  : allow;

process.stdout.write(`${JSON.stringify(response)}\n`);
process.exit(0);
