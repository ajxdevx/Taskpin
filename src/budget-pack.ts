import { extractMatchSlices, extractSignatures } from "./slices.js";
import type { TokenEstimator } from "./tokens.js";
import type { PackReason } from "./types.js";

export type PackPresentation = "full" | "slice" | "signature";

export interface PackVariant {
  presentation: PackPresentation;
  content: string;
  tokens: number;
}

export interface PackedFileCandidate {
  path: string;
  reasons: PackReason[];
  score: number;
  variants: PackVariant[];
}

const HIGH_PRIORITY_SCORE = 55;

function variantOrder(score: number): PackPresentation[] {
  if (score >= HIGH_PRIORITY_SCORE) {
    return ["full", "slice", "signature"];
  }
  return ["full", "slice", "signature"];
}

export function optimizeBudgetFill(
  candidates: PackedFileCandidate[],
  contentBudget: number,
  estimateTokens: TokenEstimator,
  fileHeaderTokens: (path: string) => number,
): Array<{
  path: string;
  reasons: PackReason[];
  score: number;
  presentation: PackPresentation;
  content: string;
  tokens: number;
}> {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const chosen: Array<{
    path: string;
    reasons: PackReason[];
    score: number;
    presentation: PackPresentation;
    content: string;
    tokens: number;
    header: number;
  }> = [];
  let contentUsed = 0;

  for (const item of sorted) {
    const header = fileHeaderTokens(item.path);
    const order = variantOrder(item.score);
    let picked: PackVariant | null = null;

    for (const mode of order) {
      const variant = item.variants.find((v) => v.presentation === mode);
      if (!variant) continue;
      if (contentUsed + variant.tokens <= contentBudget) {
        picked = variant;
        break;
      }
    }

    if (!picked) {
      const slice = item.variants.find((v) => v.presentation === "slice");
      const sig = item.variants.find((v) => v.presentation === "signature");
      const fallback = slice ?? sig;
      if (fallback) {
        const room = contentBudget - contentUsed;
        if (room > 80) {
          const maxChars = Math.max(120, Math.floor(room * 3.8));
          const trimmed =
            fallback.content.slice(0, maxChars) + "\n\n… [trimmed to budget]";
          const tokens = estimateTokens(trimmed);
          if (tokens <= room) {
            picked = {
              presentation: fallback.presentation,
              content: trimmed,
              tokens,
            };
          }
        }
      }
    }

    if (!picked) continue;

    chosen.push({
      path: item.path,
      reasons: item.reasons,
      score: item.score,
      presentation: picked.presentation,
      content: picked.content,
      tokens: picked.tokens,
      header,
    });
    contentUsed += picked.tokens;
  }

  const leftovers = sorted.filter(
    (c) => !chosen.some((x) => x.path === c.path),
  );
  leftovers.sort((a, b) => {
    const da = a.score / Math.max(1, a.variants[0]?.tokens ?? 1);
    const db = b.score / Math.max(1, b.variants[0]?.tokens ?? 1);
    return db - da;
  });

  for (const item of leftovers) {
    const sig = item.variants.find((v) => v.presentation === "signature");
    const slice = item.variants.find((v) => v.presentation === "slice");
    const variant = sig ?? slice;
    if (!variant) continue;
    if (contentUsed + variant.tokens > contentBudget) continue;
    if (chosen.some((x) => x.path === item.path)) continue;
    chosen.push({
      path: item.path,
      reasons: item.reasons,
      score: item.score,
      presentation: variant.presentation,
      content: variant.content,
      tokens: variant.tokens,
      header: fileHeaderTokens(item.path),
    });
    contentUsed += variant.tokens;
  }

  chosen.sort((a, b) => b.score - a.score);
  return chosen.map((c) => ({
    path: c.path,
    reasons: c.reasons,
    score: c.score,
    presentation: c.presentation,
    content: c.content,
    tokens: c.tokens,
  }));
}

export function buildVariants(
  relPath: string,
  rawContent: string,
  matchLines: number[],
  estimateTokens: TokenEstimator,
  fullTokenThreshold = 700,
): PackVariant[] {
  const fullTokens = estimateTokens(rawContent);
  const variants: PackVariant[] = [
    {
      presentation: "full",
      content: rawContent,
      tokens: fullTokens,
    },
  ];

  if (matchLines.length > 0 && fullTokens > 200) {
    const sliced = extractMatchSlices(rawContent, matchLines);
    variants.push({
      presentation: "slice",
      content: sliced,
      tokens: estimateTokens(sliced),
    });
  } else if (fullTokens > fullTokenThreshold) {
    const sliced = rawContent.slice(0, 6000) + "\n\n… [head slice]";
    variants.push({
      presentation: "slice",
      content: sliced,
      tokens: estimateTokens(sliced),
    });
  }

  const sigBody = extractSignatures(rawContent, relPath);
  variants.push({
    presentation: "signature",
    content: sigBody,
    tokens: estimateTokens(sigBody),
  });

  return variants;
}
