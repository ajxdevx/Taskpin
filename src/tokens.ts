export type TokenModel =
  | "chars4"
  | "claude"
  | "gpt"
  | "gemini"
  | "ollama";

export type TokenEstimator = (text: string) => number;

const CHARS_PER_TOKEN: Record<TokenModel, number> = {
  chars4: 4,
  claude: 3.7,
  gpt: 4,
  gemini: 4,
  ollama: 4.2,
};

const MODEL_ALIASES: Record<string, TokenModel> = {
  chars4: "chars4",
  default: "chars4",
  claude: "claude",
  "claude-3": "claude",
  "claude-3.5": "claude",
  "claude-4": "claude",
  anthropic: "claude",
  gpt: "gpt",
  "gpt-4": "gpt",
  "gpt-4o": "gpt",
  openai: "gpt",
  gemini: "gemini",
  "gemini-pro": "gemini",
  ollama: "ollama",
};

export function resolveTokenModel(name?: string): TokenModel {
  if (!name || !name.trim()) return "chars4";
  const key = name.trim().toLowerCase();
  return MODEL_ALIASES[key] ?? "chars4";
}

export function createTokenEstimator(model: TokenModel): TokenEstimator {
  const divisor = CHARS_PER_TOKEN[model];
  return (text: string) => Math.ceil(text.length / divisor);
}

const defaultEstimator = createTokenEstimator("chars4");

export function estimateTokens(text: string): number {
  return defaultEstimator(text);
}

export function allocatePackBudget(budgetTokens: number): {
  contentBudget: number;
  reserved: number;
} {
  const reserved = Math.max(
    180,
    Math.min(1200, Math.ceil(budgetTokens * 0.12)),
  );
  const contentBudget = Math.max(300, budgetTokens - reserved);
  return { contentBudget, reserved };
}
