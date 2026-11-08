# Harness² Component 3B: Composed Procedural Experience (EXPERIENCE.md)
<!-- Auto-populated by the Recursive Propose-Probe-Compose Loop when tool errors are resolved -->
- **[Cross-Platform Path Resolution]**: Always resolve paths relative to `workspaceRoot` or verify file existence with `fs.existsSync` before modifying.
- **[Terminal Commands]**: On Windows, PowerShell is used; prefer standard cmdlets (`Get-ChildItem`, `Select-String`, `Test-Path`).
- **[Execution Protocol]**: Act decisively with targeted tool calls; never write long walls of speculative prose.

### [PPC Composed Fix • 2026-11-07T20:10:40.915Z]
- **Failed Tool**: `run_terminal` (`run_terminal({"cwd":"C:/Users/Sue","command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& {$exts=@('.py','.js','.ts','.tsx','.jsx','.ps1','.bat'); $roots=@('C:\\Users\\Sue\\Desktop','C:\\Users\\Sue\\.gemini'); Write-Output '=== TOP DIRS ==='; foreach($r in $roots){Get-ChildItem $r | Where-Object{$_.PSIsContainer}|ForEach-Object{Write-Output $_.FullName}}; Write-Output ''; Write-Output '=== EXT COUNTS ==='; $files=Get-ChildItem $roots -File -Recurse | Where-Object{$exts -contains $_.Extension}; $files|Group-Object Extension|Sort-Object Count -Desc|ForEACH-OBJECT{Write-output ('{0,-6}{1}' -f $_.Name,$_.Count)}; Write-output ('TOTAL='+$files.count); Write-output ''; Write-output '=== LARGEST 25 ==='; $files|Sort-Object Length -Desc|select-object first 25 | ForEach-Object{$sz=[math]::Round($_.Length/1KB); Write-output ('{0,7:N0} KB  {1}' -f $sz,$_.FullName)}}\""})`)
- **Initial Failure Telemetry**: `At line:1 char:147 + ... sers\Sue\.gemini'); Write-Output '=== TOP DIRS ==='; foreach( in ){Ge ... +                                                            `
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-07T20:10:40.915Z]**: Tool `run_terminal` (`run_terminal({"cwd":"C:/Users/Sue","command":"powershell.exe -NoProfile -Executi`) encountered error `At line:1 char:147 + ... sersSue.gemini'); Write-Output '=== TOP DIRS ==='; fore`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for run_terminal with updated tools.md)

### [PPC Composed Fix • 2026-11-08T02:20:13.139Z]
- **Failed Tool**: `run_terminal` (`run_terminal({"command":"cmd /c \"dir server\\src\\ws & echo ---- & find /c \\\"\\\" < server\\src\\index.ts & find /c \\\"\\\" < server\\src\\db\\database.ts & find /c \\\"\\\" < server\\src\\tabby\\tabbyEngine.ts & find /c \\\"\\\" < brain\\src\\agent\\loop.py\"","cwd":"C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity"})`)
- **Initial Failure Telemetry**: `FIND: Parameter format not correct FIND: Parameter format not correct FIND: Parameter format not correct FIND: Parameter format not correct `
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T02:20:13.139Z]**: Tool `run_terminal` (`run_terminal({"command":"cmd /c "dir serversrcws & echo ---- & find /c "" < serv`) encountered error `FIND: Parameter format not correct FIND: Parameter format not correct FIND: Para`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for run_terminal with updated tools.md)

### [PPC Composed Fix • 2026-11-08T02:20:27.983Z]
- **Failed Tool**: `run_terminal` (`run_terminal({"command":"powershell -NoProfile -ExecutionPolicy Bypass -File .runtime/_audit_tmp.ps1 & del .runtime\\_audit_tmp.ps1","cwd":"C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity"})`)
- **Initial Failure Telemetry**: `At line:1 char:77 + ... ofile -ExecutionPolicy Bypass -File .runtime/_audit_tmp.ps1 & del .ru ... +                                                             `
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T02:20:27.983Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell -NoProfile -ExecutionPolicy Bypass -File .ru`) encountered error `At line:1 char:77 + ... ofile -ExecutionPolicy Bypass -File .runtime/_audit_tmp.`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for run_terminal with updated tools.md)

### [PPC Composed Fix • 2026-11-08T06:40:22.038Z]
- **Failed Tool**: `run_terminal` (`run_terminal({"command":"cd LocalGravity && echo \"=== server/src tree ===\" && (find server/src -maxdepth 2 -type f -name \"*.ts\" | sort) ; echo \"=== line counts ===\" && (wc -l server/src/index.ts server/src/db/database.ts server/src/tabby/tabbyEngine.ts 2>/dev/null || Get-Content server/src/index.ts | Measure-Object -Line)","cwd":"C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity"})`)
- **Initial Failure Telemetry**: `At line:1 char:17 + cd LocalGravity && echo "=== server/src tree ===" && (find  server/src ... +                 ~~ The token '&&' is not a valid statement sepa`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T06:40:22.038Z]**: Tool `run_terminal` (`run_terminal({"command":"cd LocalGravity && echo "=== server/src tree ===" && (f`) encountered error `At line:1 char:17 + cd LocalGravity && echo "=== server/src tree ===" && (find  `. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for run_terminal with updated tools.md)

### [PPC Composed Fix • 2026-11-08T06:44:55.528Z]
- **Failed Tool**: `apply_diff` (`apply_diff({"path":"server/src/index.ts","replacement":"// queryHostHardwareTelemetry extracted to ./utils/telemetry.js\nconst __extracted_telemetry_anchor_removed = true;","target":"function queryHostHardwareTelemetry(activeTier: ModelTier): {\n  vramUsedGb: number;\n  vramTotalGb: number;\n  vramPercent: number;\n  hostRamUsedGb: number;\n  hostRamTotalGb: number;\n  hostRamPercent: number;\n  gpuUtilization: number;\n  cpuUtilization: number;\n} {\n  const totalMemGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));\n  const freeMemGb = Number((os.freemem() / 1024 ** 3).toFixed(1));\n  const usedMemGb = Number((totalMemGb - freeMemGb).toFixed(1));\n  const hostRamPercent = Math.round((usedMemGb / Math.max(1, totalMemGb)) * 100);\n\n  let vramTotalGb = 16.0;\n  let vramUsedGb = TIER_SPECS[activeTier].estimatedVramGb;\n  let gpuUtil = 12;\n\n  try {\n    const smi = execSync(\n      'nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits',\n      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 800 }\n    )\n      .toString()\n      .trim()\n      .split('\\n')[0];\n    if (smi) {\n      const [usedMb, totalMb, util] = smi.split(',').map((s) => Number(s.trim()));\n      if (!Number.isNaN(usedMb) && !Number.isNaN(totalMb) && totalMb > 0) {\n        vramUsedGb = Number((usedMb / 1024).toFixed(1));\n        vramTotalGb = Number((totalMb / 1024).toFixed(1));\n        gpuUtil = Number.isNaN(util) ? 12 : util;\n      }\n    }\n  } catch {\n    // Use estimated tier VRAM on systems where nvidia-smi isn't in PATH\n  }\n\n  return {\n    vramUsedGb,\n    vramTotalGb,\n    vramPercent: Math.round((vramUsedGb / Math.max(1, vramTotalGb)) * 100),\n    hostRamUsedGb: usedMemGb,\n    hostRamTotalGb: totalMemGb,\n    hostRamPercent,\n    gpuUtilization: gpuUtil,\n    cpuUtilization: Math.min(100, Math.max(4, Math.round(os.loadavg()[0] * 10) || 14)),\n  };\n}"})`)
- **Initial Failure Telemetry**: `Target block not found in C:\Users\Sue\.gemini\antigravity\scratch\LocalGravity\server\src\index.ts`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T06:44:55.528Z]**: Tool `apply_diff` (`apply_diff({"path":"server/src/index.ts","replacement":"// queryHostHardwareTele`) encountered error `Target block not found in C:UsersSue.geminiantigravityscratchLocalGravityservers`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for apply_diff with updated tools.md)

### [PPC Composed Fix • 2026-11-08T07:44:06.458Z]
- **Failed Tool**: `run_terminal` (`run_terminal({"command":"cd server && npx tsc --noEmit 2>&1 | head -40; echo \"EXIT=$?\""})`)
- **Initial Failure Telemetry**: `At line:1 char:11 + cd server && npx tsc --noEmit 2>&1 | head -40; echo "EXIT=$?" +           ~~ The token '&&' is not a valid statement separator in this versi`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T07:44:06.458Z]**: Tool `run_terminal` (`run_terminal({"command":"cd server && npx tsc --noEmit 2>&1 | head -40; echo "EX`) encountered error `At line:1 char:11 + cd server && npx tsc --noEmit 2>&1 | head -40; echo "EXIT=?"`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for run_terminal with updated tools.md)

### [PPC Composed Fix • 2026-11-08T08:21:17.469Z]
- **Failed Tool**: `call_mcp_tool` (`call_mcp_tool({"ServerName":"github","ToolName":"get_me","Arguments":{}})`)
- **Initial Failure Telemetry**: `Error: MCP server "github" is not configured in mcp_config.json. Available: comfy-mcp, puppeteer, fetch, memory, sqlite, local-fetch, filesystem`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T08:21:17.469Z]**: Tool `call_mcp_tool` (`call_mcp_tool({"ServerName":"github","ToolName":"get_me","Arguments":{}})`) encountered error `Error: MCP server "github" is not configured in mcp_config.json. Available: comf`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for call_mcp_tool with updated tools.md)

### [PPC Composed Fix • 2026-11-08T08:22:41.771Z]
- **Failed Tool**: `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -File _mcpdiag.ps1","cwd":"C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity"})`)
- **Initial Failure Telemetry**: ` [Command timed out after 30000ms]`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T08:22:41.771Z]**: Tool `run_terminal` (`run_terminal({"command":"powershell.exe -NoProfile -ExecutionPolicy Bypass -File`) encountered error ` [Command timed out after 30000ms]`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for run_terminal with updated tools.md)

### [PPC Composed Fix • 2026-11-08T08:59:10.942Z]
- **Failed Tool**: `call_mcp_tool` (`call_mcp_tool({"ServerName":"context7","ToolName":"resolve-library-id","Arguments":{"query":"Fastify"}})`)
- **Initial Failure Telemetry**: `Input validation error: Invalid arguments for tool resolve-library-id: libraryName: Invalid input: expected string, received undefined`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T08:59:10.942Z]**: Tool `call_mcp_tool` (`call_mcp_tool({"ServerName":"context7","ToolName":"resolve-library-id","Argument`) encountered error `Input validation error: Invalid arguments for tool resolve-library-id: libraryNa`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for call_mcp_tool with updated tools.md)

### [PPC Composed Fix • 2026-11-08T08:59:52.077Z]
- **Failed Tool**: `mcp_playwright_puppeteer_navigate` (`mcp_playwright_puppeteer_navigate({"url":"https://example.com"})`)
- **Initial Failure Telemetry**: `### Error Tool "puppeteer_navigate" not found`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T08:59:52.077Z]**: Tool `mcp_playwright_puppeteer_navigate` (`mcp_playwright_puppeteer_navigate({"url":"https://example.com"})`) encountered error `### Error Tool "puppeteer_navigate" not found`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for mcp_playwright_puppeteer_navigate with updated tools.md)

### [PPC Composed Fix • 2026-11-08T09:03:47.979Z]
- **Failed Tool**: `mcp_time_invoke` (`mcp_time_invoke({"action":"get_current_time","payload":{"timezone":"America/Los_Angeles"}})`)
- **Initial Failure Telemetry**: `MCP Error (-32602): Unknown tool: invoke`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-08T09:03:47.979Z]**: Tool `mcp_time_invoke` (`mcp_time_invoke({"action":"get_current_time","payload":{"timezone":"America/Los_`) encountered error `MCP Error (-32602): Unknown tool: invoke`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for mcp_time_invoke with updated tools.md)

### [Repo Health Snapshot • 2026-11-08 ~03:55 PDT — autonomous overnight check]
- **State verified, NOT refactored.** User said "work as long as you like but don't do crazy." No confirmed refactor plan existed in-thread (the old "P0/P1 program" was abandoned topic). So I did read-only verification only.
- **Builds green:** `server` (`tsc`) and `client` (`tsc -b`) both exit 0 via `--noEmit`. The large WIP on branch `main` (27 modified tracked files + new `server/src/agent|skills|utils`, `llamaSidecar.ts`, `modelSpecs.ts`, etc.) compiles clean — no broken TS to fix.
- **dist/ fresh:** server & client newest dist timestamps == newest src timestamps (same minute). Nothing stale; no rebuild needed.
- **Decision logged:** deliberately did NOT invent new refactors or commit the 50-file WIP unattended — that would violate "don't do crazy" + checkpoint discipline. Left working tree untouched for user to review on waking.
- **[PowerShell rule held in practice]**: used pure cmdlets (`Get-ChildItem -Recurse | Sort LastWriteTime`, `Test-Path`) with no bash-isms — zero errors, validating the new tools.md rules.

