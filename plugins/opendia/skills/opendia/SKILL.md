---
name: opendia
description: >
  Drive the user's real browser through OpenDia MCP (logged-in sessions, cookies,
  wallets, bookmarks, history). Use when automating Chrome/Firefox for social posts,
  form fills, multi-tab research, local webapp testing, or any task that needs the
  user's existing browser profile — not a disposable cloud browser.
---

# OpenDia browser automation

OpenDia connects this harness to the **user's installed browser** via a local MCP server and browser extension. Prefer it whenever the work needs real sessions (Twitter/X, LinkedIn, GitHub, wallets, password-manager autofill, cookies).

## Preconditions (check before acting)

1. OpenDia MCP server is connected in this session (`opendia` MCP tools available).
2. Browser extension is **connected** (popup green / "Connected"). If tools time out or return connection errors, stop and tell the user to load the extension and run `npx opendia` if needed.
3. Do **not** fall back to a cloud browser MCP for the same task without asking — that drops the user's session.

## Recommended tool loop

1. **Orient** — `tab_list` to see open tabs; `page_analyze` on the target tab.
2. **Navigate** — `page_navigate` → `page_wait_for` until content is ready.
3. **Act** — `element_click` / `element_fill` using selectors or descriptions from `page_analyze` / `element_get_state`.
4. **Verify** — re-analyze or extract content; never assume a click/submit succeeded.
5. **Browser data** — `get_history`, `get_bookmarks`, `get_selected_text`, `get_page_links` when the user asks about "what I was reading" or selection context.

## Social / anti-detection sites (X, LinkedIn, Facebook)

- Prefer OpenDia's normal interaction tools over raw script injection.
- Go slower: wait for UI after each step; avoid blasting many rapid writes.
- If a post/composer fails, re-analyze the composer UI rather than retrying the same click blindly.

## Development / local testing

Strong fit for Cursor/Grok Build workflows:

- Multi-step signup or checkout flows with screenshots described via extract/analyze.
- Wallet-connected dApps (MetaMask etc. already in the user's browser).
- Validating forms against real validation and cookies.

## Tool map (server names)

Use the MCP tools registered by the `opendia` server (in Grok Build they appear as `opendia__…` / `use_tool` with server `opendia`):

| Area | Tools |
|------|--------|
| Page | `page_analyze`, `page_extract_content`, `page_navigate`, `page_wait_for`, `page_scroll`, `page_style` |
| Elements | `element_click`, `element_fill`, `element_get_state` |
| Tabs | `tab_create`, `tab_close`, `tab_list`, `tab_switch` |
| Data | `get_bookmarks`, `add_bookmark`, `get_history`, `get_selected_text`, `get_page_links` |

## Safety

- Confirm before irreversible actions (send message, place order, transfer funds, delete).
- Never exfiltrate cookies, passwords, or wallet seed material into chat logs or remote services.
- Tunnel mode (`--tunnel`) is a different trust boundary; do not enable it unless the user asked for remote/ChatGPT access.

## If tools are missing or stale

After extension connect, schemas can update via `tools/list_changed`. If the tool list still looks like cold fallbacks, re-list tools or restart the MCP client once the extension is green. See skill `opendia-harness` for ports and install steps.
