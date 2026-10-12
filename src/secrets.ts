import fs from "node:fs/promises";
import path from "node:path";
import { createDiscoveryContext } from "./discovery.js";
import { runPool } from "./pool.js";
import { walkPackableFiles } from "./walk.js";
import type { PackReason } from "./types.js";

export interface SecretFinding {
  path: string;
  line: number;
  kind: string;
}

type SecretRule = {
  kind: string;
  pattern: RegExp;
  blockFile?: boolean;
};

const RULES: SecretRule[] = [
  {
    kind: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    blockFile: true,
  },
  {
    kind: "github-token",
    pattern: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    kind: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    kind: "openai-key",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
  {
    kind: "anthropic-key",
    pattern: /\bsk-ant-[A-Za-z0-9\-_]{10,}\b/,
  },
  {
    kind: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/,
  },
  {
    kind: "stripe-key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    kind: "generic-secret",
    pattern:
      /\b(?:api[_-]?key|secret|password|token|auth)\b\s*[:=]\s*['"]?([^\s'"]{8,})/i,
  },
];

const REDACTED = "[REDACTED]";

function matchKinds(line: string): string[] {
  const kinds: string[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(line)) kinds.push(rule.kind);
  }
  return kinds;
}

function lineHasBlockingSecret(line: string): boolean {
  for (const rule of RULES) {
    if (rule.blockFile && rule.pattern.test(line)) return true;
  }
  return false;
}

export function findSecretFindings(
  content: string,
  relPath: string,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kinds = matchKinds(lines[i]);
    for (const kind of kinds) {
      findings.push({ path: relPath, line: i + 1, kind });
    }
  }
  return findings;
}

export function contentHasBlockingSecret(content: string): boolean {
  if (content.includes("-----BEGIN") && content.includes("PRIVATE KEY-----")) {
    return true;
  }
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (lineHasBlockingSecret(line)) return true;
  }
  return false;
}

export function redactSecrets(content: string): {
  text: string;
  kinds: string[];
} {
  const kinds = new Set<string>();
  let text = content;
  for (const rule of RULES) {
    if (rule.blockFile) continue;
    if (!rule.pattern.test(text)) continue;
    kinds.add(rule.kind);
    text = text.replace(rule.pattern, REDACTED);
  }
  return { text, kinds: [...kinds] };
}

export type SecretProcessOutcome =
  | { action: "clean"; content: string; extraReasons: PackReason[] }
  | { action: "redacted"; content: string; extraReasons: PackReason[] }
  | { action: "blocked"; kinds: string[] };

export function processFileSecrets(
  content: string,
  options: { redact: boolean },
): SecretProcessOutcome {
  if (contentHasBlockingSecret(content)) {
    const findings = findSecretFindings(content, "");
    const kinds = [...new Set(findings.map((f) => f.kind))];
    return { action: "blocked", kinds };
  }

  const findings = findSecretFindings(content, "");
  if (findings.length === 0) {
    return { action: "clean", content, extraReasons: [] };
  }

  if (!options.redact) {
    return { action: "clean", content, extraReasons: [] };
  }

  const { text, kinds } = redactSecrets(content);
  if (kinds.length === 0) {
    return { action: "clean", content, extraReasons: [] };
  }
  return {
    action: "redacted",
    content: text,
    extraReasons: ["secret-redacted"],
  };
}

export async function runSecretCheck(root: string): Promise<SecretFinding[]> {
  const absRoot = path.resolve(root);
  const discovery = await createDiscoveryContext(absRoot);
  const task = "secret check";
  const paths = await walkPackableFiles(discovery, task);
  const chunks = await runPool(paths, 12, async (rel) => {
    const abs = path.join(absRoot, rel);
    try {
      const content = await fs.readFile(abs, "utf8");
      return findSecretFindings(content, rel);
    } catch {
      return [];
    }
  });
  const all: SecretFinding[] = chunks.flat();
  all.sort((a, b) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.kind.localeCompare(b.kind),
  );
  return all;
}
