export type PackReason =
  | "agent-rules"
  | "readme"
  | "keyword-match"
  | "phrase-match"
  | "path-match"
  | "recent-change"
  | "since-change"
  | "branch-diff"
  | "pickaxe"
  | "import-neighbor"
  | "test-pair"
  | "entrypoint"
  | "secret-redacted";

export interface FileSignal {
  reason: PackReason;
  points: number;
  weighted: number;
  applied: boolean;
}

export interface ScoredFile {
  path: string;
  score: number;
  reasons: PackReason[];
  tokens: number;
}

export interface TaskParseSummary {
  paths: string[];
  filenames: string[];
  symbols: string[];
  quoted: string[];
  keywords: string[];
  warnings: string[];
}

export interface GitPackMeta {
  branch: string | null;
  base: string | null;
  since: string | null;
  mode: "default" | "changed" | "delta";
}

export interface PackSessionMeta {
  manifestPath: string;
  previousHead: string | null;
  currentHead: string | null;
  reusedFileBodies: number;
}

export interface WorkspaceMeta {
  packRoot: string;
  gitRoot: string | null;
  scopePrefix: string;
  gitAvailable: boolean;
}

export type PackOmitReason =
  | "budget"
  | "blocked-secret"
  | "not-packable"
  | "read-error"
  | "not-ranked";

export interface OmittedReceipt {
  path: string;
  score: number;
  reasons: PackReason[];
  signals: FileSignal[];
  omit: PackOmitReason;
  detail?: string;
}

export interface ContextPack {
  $schema?: string;
  schema_version: string;
  version: 1;
  output_profile?: "cursor" | "claude" | "copilot";
  root: string;
  task: string;
  budgetTokens: number;
  tokenModel?: string;
  budgetReserved?: number;
  usedTokens: number;
  generatedAt: string;
  git?: GitPackMeta;
  session?: PackSessionMeta;
  workspace?: WorkspaceMeta;
  taskParse?: TaskParseSummary;
  blockedSecrets?: Array<{ path: string; kinds: string[] }>;
  omitted?: OmittedReceipt[];
  files: Array<{
    path: string;
    reasons: PackReason[];
    signals: FileSignal[];
    score: number;
    presentation: "full" | "slice" | "signature";
    tokens: number;
    content: string;
  }>;
}
