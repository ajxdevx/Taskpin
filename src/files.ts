export const TEXT_EXT =
  /\.(tsx?|jsx?|mjs|cjs|astro|vue|svelte|py|go|rs|java|kt|rb|php|md|mdc|json|yaml|yml|css|scss|html)$/i;

export function isAgentRulePath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/");
  return n.startsWith(".cursor/rules/");
}

export function isTextCandidate(rel: string): boolean {
  return TEXT_EXT.test(rel) || isAgentRulePath(rel);
}
