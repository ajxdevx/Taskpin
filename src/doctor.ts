import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspace } from "./workspace.js";
import { resolveRipgrep } from "./rg.js";

export interface DoctorReport {
  ok: boolean;
  lines: string[];
}

export async function runDoctor(root: string): Promise<DoctorReport> {
  const lines: string[] = [];
  let ok = true;
  const absRoot = path.resolve(root);

  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor >= 20) {
    lines.push(`ok  node ${process.versions.node}`);
  } else {
    ok = false;
    lines.push(`fail  node ${process.versions.node} (need >= 20)`);
  }

  const rg = await resolveRipgrep();
  if (rg) {
    lines.push(`ok  ripgrep (${rg.source}) ${rg.path}`);
  } else {
    ok = false;
    lines.push(
      "fail  ripgrep not found (install rg or npm install @vscode/ripgrep)",
    );
  }

  const layout = await resolveWorkspace(absRoot);
  if (layout.gitAvailable && layout.gitRoot) {
    lines.push(`ok  git root ${layout.gitRoot}`);
    if (layout.scopePrefix) {
      lines.push(`ok  pack scope ${layout.scopePrefix} → ${layout.packRoot}`);
    }
  } else {
    lines.push(
      "warn  not a git repo (git signals disabled; pack still works)",
    );
  }

  try {
    await fs.access(absRoot);
    const probe = path.join(absRoot, `.taskpin-write-test-${Date.now()}`);
    await fs.writeFile(probe, "", "utf8");
    await fs.unlink(probe);
    lines.push(`ok  root readable/writable ${absRoot}`);
  } catch {
    ok = false;
    lines.push(`fail  cannot read/write root ${absRoot}`);
  }

  return { ok, lines };
}
