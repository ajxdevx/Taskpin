export function printHelp(): void {
  console.log(`
taskpin — pin the files your agent needs

Usage:
  taskpin <command> [options]

Commands:
  pack      Build a context pack (default when using --task)
  route     Rank files and signals (no file bodies)
  changed   Pack branch diff vs base (task optional)
  delta     Refresh pack from .taskpin/manifest.json (save updated manifest)
  explain   Why a path was packed or omitted
  stats     Token tree for packable files
  doctor    Check node, ripgrep, git, and project root
  check     Scan for suspected secrets (exit 1 if any)
  schema    Print JSON Schema for pack output
  index     Build .taskpin/file-index.json for faster path matching
  stale     Show files changed since last index
  mcp       Start MCP server (stdio) for any MCP-capable agent host
  ci        GitHub Action / CI: secret scan first, then pack PR or issue context
  init      Install AGENTS.md snippet; optional Cursor rule/hook (--no-rule, --no-hook)

Legacy (still supported):
  taskpin --task "..." [options]
  taskpin --doctor | --stats | --check | --route | --changed ...

Options (CLI overrides ${".taskpin.json"}):
  --root <path>     Project or repo root (default: cwd)
  --scope <path>    Monorepo subpath under --root (e.g. apps/web)
  --task <text>     Task description
  --budget <n>      Token budget (default: 8000)
  --model <name>    Token estimator: claude | gpt | gemini | ollama | chars4
  --profile <name>  default | cursor | claude | copilot
  --format <fmt>    markdown | json
  --base <ref>      Git base for changed mode
  --since <ref>     Git ref for files changed since (commit SHA or branch)
  --manifest <path> Session manifest (default: .taskpin/manifest.json)
  --save-manifest   Write session manifest after pack
  --refresh         Reuse unchanged file bodies from manifest
  --use-index       Use .taskpin/file-index.json for path matching when fresh
  --index <path>    File index path (default: .taskpin/file-index.json)
  --out <file>      Write to file instead of stdout
  --min-tokens <n>  stats: hide dirs below N tokens
  --no-redact       Pack without redacting inline secrets
  -h, --help        Show help

Examples:
  taskpin pack --task "fix hero mood bug" --budget 12000
  taskpin route --task "auth middleware"
  taskpin changed --base main
  taskpin explain src/pack.ts --task "budget optimizer"
  taskpin doctor --root .
`);
}
