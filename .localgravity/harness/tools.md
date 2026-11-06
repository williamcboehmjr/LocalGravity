# Harness² Component 4: Tool Guidance (tools.md)
## Workstation-Wide Operations
- **`list_directory`**: Can list any folder on the machine (e.g. `Downloads`, `C:/Users/Sue/Downloads`, `C:/`, or workspace).
- **`read_file`**: Reads any file on the system using relative or absolute paths.
- **`write_file` / `apply_diff`**: Edits files with automated rollback checkpoints.
- **`search_codebase`**: Searches code or text files across any specified root path.
- **`run_terminal`**: Runs PowerShell (Windows) or Zsh (macOS) commands anywhere on the computer.

## Critical Engineering Execution Protocols
1. **Never Invent API Signatures**: When refactoring or importing from other files (such as database or manager classes), ALWAYS read their type definitions and exported signatures first (e.g. via `read_file`) before writing code that calls them. Never assume methods exist without checking.
2. **Mandatory Build Verification**: After modifying source files (especially TypeScript or Rust), ALWAYS execute a compile check via `run_terminal` (`npm run build` or `cargo check`). If compilation fails, immediately inspect errors and repair them before declaring completion.
3. **Cross-Platform Directory Creation**: On Windows, PowerShell `mkdir -p dir1 dir2` fails with positional argument errors. Use `New-Item -ItemType Directory -Force -Path dir1, dir2` or create paths via Node/`write_file`.
4. **Preserve Working Implementations**: Before refactoring or splitting a core service, inspect how incoming WebSocket events and HTTP endpoints bind to it so no existing runtime capabilities are broken.
