# taskpin layout (what you actually use)

## After `npm install -g taskpin` or `npx taskpin`

You only get the **published package**:

| Path | Purpose |
| --- | --- |
| `dist/cli.js` | `taskpin` command |
| `dist/mcp-main.js` | `taskpin-mcp` (stdio MCP for any host) |
| `schema/` | JSON pack schema |
| `docs/integrations/` | Templates for `taskpin init` |

No tests, no TypeScript source, no fixtures in the npm tarball.

## This GitHub repo (build from source)

| Path | Purpose |
| --- | --- |
| `src/` | Source (TypeScript) |
| `src/cli/` | Command-line entry and handlers |
| `src/core/pack-request.ts` | Validated pack request (CLI, MCP, CI) |
| `src/plan/` | Ranking and packing pipeline |
| `src/integrations/` | `taskpin ci`, `taskpin init`, GitHub events |
| `schema/` | `context-pack.schema.json` |
| `docs/` | MCP example + agent/editor integration templates |
| `action.yml` | GitHub Action for PR/issue context packs |

**Build:** `npm ci && npm run build` → run `node dist/cli.js` or `npm link`.

**Flow:**

```
taskpin → pack-request (Zod) → plan → discovery / git / search / rank → pack output
```

Maintainers develop in `src/`; end users run **`taskpin`** and optional **`taskpin init`** / **MCP** / **Action** — nothing else required.
