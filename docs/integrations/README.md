# taskpin integrations

Templates for **coding agents and editors**. Nothing here is required — taskpin works as a standalone CLI on any project.

## Install into a repo

```bash
taskpin init --root /path/to/your/repo
```

| File | Installed to | Who it helps |
| --- | --- | --- |
| `AGENTS.snippet.md` | Merged into `AGENTS.md` | **Any agent** that reads `AGENTS.md` (Claude Code, Copilot, Cursor, etc.) |
| `cursor-rule-taskpin.mdc` | `.cursor/rules/taskpin.mdc` | **Cursor** only (optional; use `--no-rule` to skip) |
| `hooks.json` + `taskpin-pack.mjs` | `.cursor/hooks/` | **Cursor** prompt hook (optional; use `--no-hook` to skip) |
| `mcp.cursor.snippet.json` | Merge into `.cursor/mcp.json` | **Cursor** MCP wiring (copy the `command`/`args` pattern for other MCP hosts) |

Set `TASKPIN_CLI` if `taskpin` is not on `PATH`. The Cursor hook skips packing when the user message is very short.

## MCP without Cursor

Run `taskpin mcp --root <project>` and register that server in **any** MCP-capable client. See the root [README MCP section](https://github.com/ajxdevx/Taskpin#mcp-and-agent-integrations).
