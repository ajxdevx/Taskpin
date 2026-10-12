import path from "node:path";
import { resolvePackRoot } from "./workspace.js";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export function isPathInside(root: string, target: string): boolean {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (base === resolved) return true;
  const rel = path.relative(base, resolved);
  if (!rel || rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function resolveSandboxedPackRoot(
  sandboxRoot: string,
  requestRoot?: string,
  scope?: string,
): string {
  const sandbox = path.resolve(sandboxRoot);
  const base = requestRoot ? path.resolve(requestRoot) : sandbox;
  if (!isPathInside(sandbox, base)) {
    throw new SandboxError(
      `root must stay inside sandbox ${sandbox}`,
    );
  }
  const pack = resolvePackRoot(base, scope);
  if (!isPathInside(sandbox, pack)) {
    throw new SandboxError(
      `scope must stay inside sandbox ${sandbox}`,
    );
  }
  return pack;
}
