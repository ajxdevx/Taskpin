<!-- taskpin:start -->
## taskpin (context packs)

Before large edits, build a **task-scoped** context pack so you read the right files under a token budget:

```bash
taskpin pack --task "<short task from the user>" --budget 12000 --profile default
```

Use `--profile claude`, `copilot`, or `cursor` if the user’s editor expects that shape. Or use **MCP** (`route`, `get_context_pack`, `get_delta_context`) when a taskpin MCP server is configured for this workspace.

- Prefer **`taskpin route`** when you only need ranked paths and reasons (no file bodies).
- Run **`taskpin check`** before committing; packs **redact** inline secrets and **block** private keys.
- Monorepos: `taskpin pack --root . --scope <package> --task "..."`.

Optional: `taskpin init` can install editor-specific helpers (e.g. Cursor rule/hook). The AGENTS snippet works for all agents.
<!-- taskpin:end -->
