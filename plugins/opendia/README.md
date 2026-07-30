# OpenDia — Grok Build plugin

Install OpenDia as a **Grok Build** (or Claude Code–compatible) plugin. It wires the local OpenDia MCP server into the harness and ships skills so the model uses your **real browser session** correctly.

## Prerequisites

1. **Browser extension** loaded (Chrome / Firefox / Chromium) from [releases](https://github.com/aeonfun/opendia/releases).
2. **Node.js 16+** so `npx opendia` can run.
3. Extension shows **connected** (green) to the MCP server (`ws://localhost:5555` by default).

The plugin starts the MCP process over **stdio**. The extension still talks to the server over the local WebSocket; `npx opendia` opens both.

## Install (Grok Build)

### One-shot install from this repo

```bash
# After this PR merges into aeonfun/opendia:
grok plugin marketplace add aeonfun/opendia
grok plugin install opendia --trust

# Or install the plugin folder directly (works from a fork/branch too):
grok plugin install aeonfun/opendia#plugins/opendia --trust
```

Plugins stay off until enabled. Confirm with:

```bash
grok plugin list
grok mcp list
grok mcp doctor opendia
```

In the TUI: `/plugins` → enable **opendia**, ensure it is **trusted** (required for MCP).

### Manual harness config (no plugin)

Add to `~/.grok/config.toml` (or project `.grok/config.toml`):

```toml
[mcp_servers.opendia]
command = "npx"
args = ["-y", "opendia"]
enabled = true
# First cold start may download the npm package
startup_timeout_sec = 60
```

Restart Grok Build or reload MCP (`/mcps`).

## What you get

| Component | Path | Purpose |
|-----------|------|---------|
| MCP server | `.mcp.json` / `plugin.json` | Spawns `npx -y opendia` (stdio + local WS/SSE) |
| Skill | `skills/opendia/SKILL.md` | When/how to drive the browser through OpenDia |
| Skill | `skills/opendia-harness/SKILL.md` | Setup, ports, extension connect, troubleshooting |

## Tool surface

Once the extension is connected, tools include (names as registered by the server; Grok exposes them as `opendia__<tool>`):

| Tool | Role |
|------|------|
| `page_analyze` | Discover interactive elements / page structure |
| `page_extract_content` | Clean text extraction |
| `page_navigate` / `page_wait_for` / `page_scroll` | Navigation & timing |
| `element_click` / `element_fill` / `element_get_state` | Interaction |
| `tab_create` / `tab_close` / `tab_list` / `tab_switch` | Tabs |
| `get_bookmarks` / `add_bookmark` / `get_history` | Browser data |
| `get_selected_text` / `get_page_links` | Selection & links |
| `page_style` | Visual themes / accessibility styling |

Cold `tools/list` may return fallback schemas until the extension registers; OpenDia emits `notifications/tools/list_changed` when that happens.

## Grok Build vs cloud browser MCPs

| | OpenDia | Cloud/CDP browsers (e.g. Hyperbrowser) |
|--|---------|----------------------------------------|
| Session | Your real profile (cookies, wallets, extensions) | Ephemeral / remote |
| Privacy | Local-first | Leaves the machine |
| Best for | Social posts, logged-in admin UIs, wallet dApps, local app testing | Headless scrape, CI, disposable profiles |

Prefer OpenDia when the task needs **accounts you already have open**. Prefer a cloud browser when you need isolation or no local extension.

## Claude Code / Cursor

Same MCP command works:

```json
{
  "mcpServers": {
    "opendia": {
      "command": "npx",
      "args": ["-y", "opendia"]
    }
  }
}
```

Claude Code can also use this marketplace via `.claude-plugin/marketplace.json` at the repo root.

## Security

OpenDia holds broad browser permissions and can act as you on every site. Only enable it in harnesses you trust. Tunnel / non-loopback HTTP requires a bearer token — see root [SECURITY.md](../../.github/SECURITY.md).

## License

MIT — same as the OpenDia repository.
