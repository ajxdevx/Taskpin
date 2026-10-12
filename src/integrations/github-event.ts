export type CiPackMode = "default" | "changed";

export type GithubEventKind =
  | "pull_request"
  | "issues"
  | "issue"
  | "workflow_dispatch"
  | "unknown";

export interface ParsedGithubEvent {
  kind: GithubEventKind;
  task: string;
  packMode: CiPackMode;
  base?: string;
  title?: string;
  number?: number;
  htmlUrl?: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function pickStringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v.trim() : "";
}

function composeTask(title: string, body: string, fallback: string): string {
  const parts: string[] = [];
  if (title) parts.push(title);
  if (body) parts.push(body);
  const joined = parts.join("\n\n").trim();
  if (!joined) return fallback;
  const max = 6000;
  if (joined.length <= max) return joined;
  return `${joined.slice(0, max - 1)}…`;
}

function parsePullRequest(payload: Record<string, unknown>): ParsedGithubEvent {
  const pr = asRecord(payload.pull_request) ?? {};
  const title = pickStringField(pr, "title");
  const body = pickStringField(pr, "body");
  const base = asRecord(pr.base);
  const baseRef = base ? pickStringField(base, "ref") : "";
  const number = typeof pr.number === "number" ? pr.number : undefined;
  const htmlUrl = pickStringField(pr, "html_url");
  return {
    kind: "pull_request",
    task: composeTask(title, body, "review pull request changes"),
    packMode: "changed",
    base: baseRef || undefined,
    title: title || undefined,
    number,
    htmlUrl: htmlUrl || undefined,
  };
}

function parseIssuePayload(
  payload: Record<string, unknown>,
  kind: "issues" | "issue",
): ParsedGithubEvent {
  const issue = asRecord(payload.issue) ?? payload;
  const title = pickStringField(issue, "title");
  const body = pickStringField(issue, "body");
  const number = typeof issue.number === "number" ? issue.number : undefined;
  const htmlUrl = pickStringField(issue, "html_url");
  return {
    kind,
    task: composeTask(title, body, "work on this issue"),
    packMode: "default",
    title: title || undefined,
    number,
    htmlUrl: htmlUrl || undefined,
  };
}

function parseWorkflowDispatch(
  payload: Record<string, unknown>,
): ParsedGithubEvent {
  const inputs = asRecord(payload.inputs) ?? {};
  const task = pickStringField(inputs, "task");
  const modeRaw = pickStringField(inputs, "mode").toLowerCase();
  const packMode: CiPackMode = modeRaw === "changed" ? "changed" : "default";
  const base = pickStringField(inputs, "base") || undefined;
  return {
    kind: "workflow_dispatch",
    task: task || "manual context pack",
    packMode,
    base,
  };
}

export function parseGithubEvent(
  payload: unknown,
  eventName?: string,
): ParsedGithubEvent {
  const name = (eventName ?? "").trim().toLowerCase();
  const root = asRecord(payload);
  if (!root) {
    return {
      kind: "unknown",
      task: "context pack for repository",
      packMode: "default",
    };
  }

  if (name === "pull_request" || root.pull_request) {
    return parsePullRequest(root);
  }
  if (name === "issues" || (name === "issue" && root.issue)) {
    return parseIssuePayload(root, "issues");
  }
  if (name === "issue") {
    return parseIssuePayload(root, "issue");
  }
  if (name === "workflow_dispatch") {
    return parseWorkflowDispatch(root);
  }

  const action = pickStringField(root, "action");
  if (root.issue && (name === "issue_comment" || action === "created")) {
    return parseIssuePayload(root, "issue");
  }

  return {
    kind: "unknown",
    task: "context pack for repository",
    packMode: "default",
  };
}

export function resolveCiPackMode(
  modeFlag: string | undefined,
  event: ParsedGithubEvent,
): CiPackMode {
  const m = (modeFlag ?? "auto").trim().toLowerCase();
  if (m === "pack" || m === "default") return "default";
  if (m === "changed" || m === "pr") return "changed";
  return event.packMode;
}
