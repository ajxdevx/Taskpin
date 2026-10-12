import type { ScoreContribution } from "../rank.js";
import type { GitSignals } from "../git.js";
import type { runContentSearch } from "../search.js";
import type { parseTask } from "../task.js";
import type { TokenModel } from "../tokens.js";
import type {
  FileSignal,
  OmittedReceipt,
  PackOmitReason,
  PackReason,
} from "../types.js";

export type { PackPlanOptions } from "../core/pack-request.js";

export interface PlannedPackedFile {
  path: string;
  reasons: PackReason[];
  score: number;
  signals: FileSignal[];
  presentation: "full" | "slice" | "signature";
  tokens: number;
  content: string;
}

export interface PackPlan {
  root: string;
  task: string;
  budgetTokens: number;
  tokenModel: TokenModel;
  contentBudget: number;
  budgetReserved: number;
  contributions: ScoreContribution[];
  ranked: Array<{
    path: string;
    score: number;
    reasons: PackReason[];
    signals: FileSignal[];
    diversityPenalty?: number;
  }>;
  suppressed: Array<{ path: string; reason: PackReason; points: number }>;
  packed: PlannedPackedFile[];
  omitted: OmittedReceipt[];
  blockedSecrets: Array<{ path: string; kinds: string[] }>;
  parsed: ReturnType<typeof parseTask>;
  search: Awaited<ReturnType<typeof runContentSearch>>;
  gitSignals: GitSignals;
  mode: "default" | "changed" | "delta";
  warnings: string[];
  reusedFileBodies: number;
  storedBodies: Map<string, { blobSha: string; storedContent: string }>;
  workspace: import("../workspace.js").WorkspaceLayout;
}

export type ExplainPathResult = {
  path: string;
  known: boolean;
  packed: boolean;
  score: number | null;
  reasons: PackReason[];
  signals: FileSignal[];
  omit: PackOmitReason | null;
  detail?: string;
  diversityPenalty?: number;
  rawContributions: ScoreContribution[];
  suppressedHits: Array<{ reason: PackReason; points: number }>;
};
