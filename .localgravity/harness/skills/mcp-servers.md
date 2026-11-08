---
name: mcp-servers
description: Permanent reference for the MCP servers installed on this box — real tool names, invocation quirks, and which server to reach for. Use when calling github / playwright / context7 / time / memory / sqlite / comfy-mcp, or when a per-server schema advertises a stale tool name ("tool not found").
metadata:
  icon: plug
---

# MCP Servers — Ground-Truth Reference (verified live 2026-11-08)

## Critical quirk: injected schemas are often STALE on tool names
AGY injects per-server `mcp_<server>_*` tools, but their advertised names can be **wrong** for the running server (e.g. it advertises `puppeteer_navigate` / `get_me`, but the live servers expose different names). When a direct `mcp_...` call errors "tool not found", route through the universal caller with the **actual** tool name:

```
call_mcp_tool({ ServerName, ToolName: <real name>, Arguments })
```

Below are the REAL verified-working names. Start here to skip dead ends.

---

## time  (no secrets) — clock for date-sensitive answers
- Real tools: `get_current_time` (arg: `timezone`, e.g. `"America/Los_Angeles"`), `convert_time`.
- User is **Pacific / America/Los_Angeles**. Always use it unless told otherwise.

## github  (keyring-backed via ~/.gemini/config/github_mcp_launcher.cmd)
- Token comes from `gh auth token` at launch → never on disk or in chat. Scopes: repo, read:org, gist. Account **williamcboehmjr**.
- Working tools seen live: `search_repositories`, plus standard set (`get_me`, list/get issues, PRs, files, create branches/PRs/comments). Verify exact name via the universal caller if unsure.
- Use for: open/inspect PRs, read issues, diff branches, comment on the LocalGravity repo (private) and others.

## playwright  (replaced puppeteer) — grounded web browsing
- Real tools: `browser_navigate`, `browser_snapshot` (a11y tree), screenshot, click/fill/evaluate equivalents under `browser_*`. Auto-wait + accessibility-tree nav = more reliable than old puppeteer for "look up current info" tasks.

## context7  (no secrets) — live versioned library docs
- Tools: resolve a library → fetch its current-version docs/snippets (e.g. Fastify v5.x, ~1900 snippets). Use mid-task to kill stale-API drift on TS work. Arg name is `libraryName`/similar — pass exactly what the schema wants; an empty/mismatched arg fails validation.

## memory  (no secrets) — knowledge graph
- Tools: create_entities, create_relations, add_observations, read_graph, search_nodes, open_nodes. Use to persist durable facts about the user/project across sessions.

## sqlite / filesystem / comfy-mcp / fetch+local-fetch
- Pre-existing. filesystem roots widened to workspace + Downloads/Desktop/Documents (workspace config).

---

## Activation gotcha (so I don't claim false success)
A `write_file`/edit to `mcp_config.json` is **not** live until AGY reconnects servers: run `/mcp reload` or restart, then the new tools appear in my schema on the **next message**. Until they show up as callable, do NOT smoke-test them — that yields "server not configured". Confirm before asserting a server works.
