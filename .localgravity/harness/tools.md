# Harness² Component 4: Tool Guidance (tools.md)
## Workstation-Wide Operations
- **`list_directory`**: Can list any folder on the machine (e.g. `Downloads`, `Desktop`, `C:/Users/Sue/Downloads`, `C:/`, or workspace root `"."`).
- **`read_file`**: Reads any file on the system using relative or absolute paths.
- **`write_file` / `apply_diff`**: Edits files with automated rollback checkpoints.
- **`search_codebase`**: Searches code or text files across any specified root path.
- **`run_terminal`**: Runs PowerShell (Windows) or Zsh (macOS) commands anywhere on the computer.

## Critical Engineering Execution Protocols
1. **Never Invent API Signatures**: When refactoring or importing from other files (such as database or manager classes), ALWAYS read their type definitions and exported signatures first (e.g. via `read_file`) before writing code that calls them. Never assume methods exist without checking.
2. **Mandatory Build Verification**: After modifying source files (especially TypeScript or Rust), ALWAYS execute a compile check via `run_terminal` (`npm run build` or `cargo check`). If compilation fails, immediately inspect errors and repair them before declaring completion.
3. **Cross-Platform Directory Creation**: On Windows, PowerShell `mkdir -p dir1 dir2` fails with positional argument errors. Use `New-Item -ItemType Directory -Force -Path dir1, dir2` or create paths via Node/`write_file`.
4. **Preserve Working Implementations**: Before refactoring or splitting a core service, inspect how incoming WebSocket events and HTTP endpoints bind to it so no existing runtime capabilities are broken.
5. **Immediate Tool Execution**: When planning changes, execute the required tool calls (e.g. `read_file`, `write_file`, `run_terminal`) directly. Never output extensive internal monologue in place of executing actions.
6. **Strict Prohibition on Simulated Actions**: You MUST NEVER simulate, roleplay, or describe tool execution in text (such as writing "Reading lines...", "Now editing file...", "Now running build...", "Build passed"). If you plan an action, you MUST emit the real tool call. Any unexecuted action claim is an immediate protocol failure.

- **[PPC Auto-Tool Rule 2026-11-07T20:10:40.915Z]**: Tool `run_terminal` (`run_terminal({"cwd":"C:/Users/Sue","command":"powershell.exe -NoProfile -Executi`) encountered error `At line:1 char:147 + ... sersSue.gemini'); Write-Output '=== TOP DIRS ==='; fore`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T02:20:13.139Z]**: Tool `run_terminal` (`run_terminal({"command":"cmd /c "dir serversrcws & echo ---- & find /c "" < serv`) encountered error `FIND: Parameter format not correct FIND: Parameter format not correct FIND: Para`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T02:20:27.983Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell -NoProfile -ExecutionPolicy Bypass -File .ru`) encountered error `At line:1 char:77 + ... ofile -ExecutionPolicy Bypass -File .runtime/_audit_tmp.`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T06:40:22.038Z]**: Tool `run_terminal` (`run_terminal({"command":"cd LocalGravity && echo "=== server/src tree ===" && (f`) encountered error `At line:1 char:17 + cd LocalGravity && echo "=== server/src tree ===" && (find  `. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T06:44:55.528Z]**: Tool `apply_diff` (`apply_diff({"path":"server/src/index.ts","replacement":"// queryHostHardwareTele`) encountered error `Target block not found in C:UsersSue.geminiantigravityscratchLocalGravityservers`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T07:44:06.458Z]**: Tool `run_terminal` (`run_terminal({"command":"cd server && npx tsc --noEmit 2>&1 | head -40; echo "EX`) encountered error `At line:1 char:11 + cd server && npx tsc --noEmit 2>&1 | head -40; echo "EXIT=?"`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T08:21:17.469Z]**: Tool `call_mcp_tool` (`call_mcp_tool({"ServerName":"github","ToolName":"get_me","Arguments":{}})`) encountered error `Error: MCP server "github" is not configured in mcp_config.json. Available: comf`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T08:22:41.771Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -File`) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T08:59:10.942Z]**: Tool `call_mcp_tool` (`call_mcp_tool({"ServerName":"context7","ToolName":"resolve-library-id","Argument`) encountered error `Input validation error: Invalid arguments for tool resolve-library-id: libraryNa`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T08:59:52.077Z]**: Tool `mcp_playwright_puppeteer_navigate` (`mcp_playwright_puppeteer_navigate({"url":"https://example.com"})`) encountered error `### Error Tool "puppeteer_navigate" not found`. Fallback to safe cross-platform invocation.

## PowerShell Robustness Rules (the #1 recurring failure — READ BEFORE run_terminal)
The terminal on this box is **PowerShell**, but most of my errors come from writing *bash-isms* into it and over-complex one-liners. Hard rules:
1. **No `&&`.** Chain with `;` or separate lines. (`cd server && npx tsc` → fails.) Use `cd server; npx tsc --noEmit`.
2. **Avoid `-Command "...$()..."` nested-quote soup.** The shell wrapper mangles `$vars`, backticks, and nested quotes (root cause of the char-147 / foreach errors). Prefer: run a *simple* pipeline directly, or write logic to a `.ps1` via `write_file` then execute with `-File`.
3. **No bash tools**: `head`,`tail`,`grep`,`find /c`,`wc`,`echo ===` don't exist. Use cmdlets: `Select-Object -First N`, `Select-String`, `Measure-Object`, `Get-ChildItem`. For line counts use `(Get-Content file).Count`.
4. **Quoting paths**: prefer single quotes `'C:\Users\Sue\...'`; double backslashes or forward slashes inside strings. Avoid embedding raw `"..."` inside an already-quoted `-Command`.
5. **Keep one-liners short.** Long `@(...)`/foreach/format-string blobs in a single line are where I keep failing — split into steps or a script file instead of heroics.
6. **Prefer purpose-built tools** when they exist: use `list_directory`/`search_codebase`/`read_file` over shelling out to PS for listing/grep/read. Shell mainly for builds, installs, git.

## MCP Servers (active) — see skills/mcp-servers.md
- **playwright** (`browser_navigate`, `browser_snapshot`, …), **github**, **context7**, **time** added; puppeteer removed. New servers attach only after AGY restart / `/mcp reload` + next message. Use real tool names via `call_mcp_tool` when the injected schema advertises a stale name.

- **[PPC Auto-Tool Rule 2026-11-08T09:03:47.979Z]**: Tool `mcp_time_invoke` (`mcp_time_invoke({"action":"get_current_time","payload":{"timezone":"America/Los_`) encountered error `MCP Error (-32602): Unknown tool: invoke`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T15:48:11.777Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -Command "Get-ChildItem -Recu`) encountered error `At line:1 char:165 + ... l' | Select-Object Filename,LineNumber,@{n='L';e={.Line`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:03:26.393Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell -NoProfile -ExecutionPolicy Bypass -File "C:`) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:09:35.064Z]**: Tool `mcp_fetch_fetch` (`mcp_fetch_fetch({"url":"https://duckduckgo.com/html/?q=strata+llama.cpp+%22--mmp`) encountered error `Error executing tool fetch: The sites robots.txt (https://duckduckgo.com/robots.`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:12:28.479Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -Comm`) encountered error `At line:1 char:189 + ... ector' } | Select-Object FullName, @{n='MB';e={[math]::`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:13:24.501Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -File`) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:13:46.876Z]**: Tool `mcp_context7_invoke` (`mcp_context7_invoke({"action":"search","payload":{"query":"llama.cpp server mult`) encountered error `MCP Error (-32602): Tool invoke not found`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:14:08.959Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -File`) encountered error `Exit code 1`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:15:28.537Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -Comm`) encountered error `At line:1 char:213 + ... Each-Object { Write-Output ('{0,7} MB  {1}' -f [math]::`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:50:12.400Z]**: Tool `run_terminal` (`run_terminal({"command":"Write-Output "=== PROCESS PATH ==="; Get-CimInstance Wi`) encountered error `Exit code 1`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:51:49.214Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -File`) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-08T16:53:01.576Z]**: Tool `run_terminal` (`run_terminal({"cwd":"C:/Users/Sue","command":"powershell.exe -NoProfile -Executi`) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T15:22:15.111Z]**: Tool `run_terminal` (`run_terminal({"command":"node .runtime/pdf_extract4.js ".runtime/uploads/908b4fa`) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T15:24:53.612Z]**: Tool `run_terminal` (`run_terminal({"command":"env:NODE_OPTIONS=''; & "C:Program Filesnodejsnode.exe" `) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T17:09:16.646Z]**: Tool `run_terminal` (`run_terminal({"command":"cd C:/Users/Sue/.gemini/antigravity/scratch/LocalGravit`) encountered error `At line:1 char:58 + cd C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity && `. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T19:09:47.992Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell -NoProfile -Command 'Select-String -Path ser`) encountered error `At line:1 char:100 + ... iltinTools.ts -Pattern ^s*cases+. | ForEach-Object { {0`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T19:26:45.064Z]**: Tool `run_terminal` (`bad-flag-cmd --fail`) encountered error `Error: unrecognized flag --fail`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T19:28:04.195Z]**: Tool `run_terminal` (`bad-flag-cmd --fail`) encountered error `Error: unrecognized flag --fail`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T19:59:25.987Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell -NoProfile -Command "Select-String -Path 'se`) encountered error `At line:1 char:163 + ... ','import.*handlers' | ForEach-Object { .LineNumber.ToS`. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T19:59:53.069Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell -NoProfile -Command "cd server; npx tsc --no`) encountered error `At line:1 char:51 + cd server; npx tsc --noEmit; Write-Host ('EXIT=' + ) +      `. Fallback to safe cross-platform invocation.

- **[PPC Auto-Tool Rule 2026-11-09T20:29:42.679Z]**: Tool `apply_diff` (`apply_diff({"path":"client/src/App.tsx","replacement":"              <ReconnectB`) encountered error `Target block not found in C:UsersSue.geminiantigravityscratchLocalGravityclients`. Fallback to safe cross-platform invocation.
