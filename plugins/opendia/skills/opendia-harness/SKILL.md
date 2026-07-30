---
name: opendia-harness
description: >
  Install, configure, and troubleshoot OpenDia for Grok Build (and other MCP
  harnesses). Use when setting up the plugin, config.toml MCP entry, ports,
  extension disconnects, tool timeouts, or tunnel mode.
---

# OpenDia harness setup (Grok Build)

## Install plugin

```bash
grok plugin marketplace add aeonfun/opendia
grok plugin install opendia --trust
```

Or pin a path:

```bash
grok plugin install aeonfun/opendia#plugins/opendia --trust
```

Enable the plugin (`/plugins` or `[plugins].enabled`). **Trust is required** for the MCP server to attach.

## Manual `config.toml`

```toml
[mcp_servers.opendia]
command = "npx"
args = ["-y", "opendia"]
enabled = true
startup_timeout_sec = 60
```

Optional custom ports (must match what the extension expects):

```bash
npx opendia --ws-port=5555 --http-port=5556
```

Default: WebSocket **5555** (extension), HTTP/SSE **5556**, stdio for the AI client.

## Extension checklist

1. Install from [GitHub Releases](https://github.com/aeonfun/opendia/releases) (Chrome zip or Firefox zip).
2. Load unpacked / temporary add-on as documented in the main README.
3. Open the extension popup — must show **Connected** to `ws://localhost:5555` (or your chosen WS port).
4. If disconnected: start or restart `npx opendia`, then reload the extension.

## Doctor commands (Grok Build)

```bash
grok mcp list
grok mcp doctor opendia
grok plugin details opendia
```

## Common failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| MCP tools timeout | Extension not connected | Connect extension; confirm WS port |
| Tools present but actions no-op | Stale socket / server restart | Restart `npx opendia`, reload extension |
| Cold schemas only | Extension not registered yet | Wait for connect + `tools/list_changed`, re-list |
| Port conflict | Another process on 5555/5556 | `npx opendia --port=6000` and point extension at new WS |
| `npx` slow / fails startup | Cold npm download | Raise `startup_timeout_sec`; ensure network for first install |
| Tunnel 401 | Missing bearer token | Pass `Authorization: Bearer <token>` (printed at startup) |

## Modes

- **Local (default)** — stdio + loopback WS/SSE. Correct for Grok Build, Claude Code, Cursor.
- **`--tunnel`** — ngrok public URL for ChatGPT-style remote connectors. Requires token. Not the default for local harnesses.
- **`--http-host=0.0.0.0`** — LAN bind; also requires token. Avoid unless intentional.

## When not to use OpenDia

- Need fully isolated / headless CI browser → use a cloud or CDP-based MCP instead.
- User has not installed the extension → guide install; do not pretend browser control works.

## Related skill

`opendia` — runtime playbook for page analyze → act → verify once the harness is healthy.
