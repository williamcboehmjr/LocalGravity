# Harness² Component 4: Tool Guidance (tools.md)
## Local MCP, Ripgrep & PTY Execution Rules
- **`run_terminal`**: Uses `powershell.exe -NoProfile` on Windows and `/bin/zsh -c` on macOS. Avoid platform-locked flags when portable alternatives exist.
- **`search_codebase`**: Use specific symbol or regex patterns to minimize context bloat.
- **`write_file` / `apply_diff`**: Automatically creates a reversible snapshot in `file_checkpoints`.
- **MCP Servers**: Loaded dynamically from client AppData `mcp_config.json`.

- **[PPC Auto-Tool Rule 2026-11-06T07:37:46.498Z]**: Tool `run_terminal` (`bad-flag-cmd --fail`) encountered error `Error: unrecognized flag --fail`. Fallback to safe cross-platform invocation.
