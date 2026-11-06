# Changelog: LocalGravity 2.0 (Unified Windows & macOS)

All notable changes across LocalGravity Windows, macOS, and Web Remote Companion.

---

## [v2.0.4] - 2026-11-06 (Self-Catching Continuation, Collapsible Activity Window & Slash Commands)

### 🔄 Self-Catching Autonomous Continuation & Protected Current-Step Tool Reads
* **Self-Catching Premature Stop Detector (`detectPrematureStop`):** Automatically catches when any model (4B, 9B, or 27B) pauses after stating an intention to act (e.g., *"Let me read..."*, *"I'll inspect..."*, trailing colons, or empty post-think output) without emitting a tool call, injecting a continuation directive and keeping the execution loop going automatically.
* **Protected Current-Step Tool Outputs in `pruneChatMessages`:** Current-step tool outputs (up to 18k–24k chars / ~650 lines per `read_file`) are now strictly protected from context-pruning. Only older historical steps (2+ turns ago) are compacted first when approaching context limits, eliminating the chunk-size testing loop.
* **Raised Step Ceilings:** Increased default `MAX_TOOL_STEPS` from 12 to 32 (and up to 50 in `/goal` mode, 45 in `/teamwork` mode).

### 🧠 Goal-Directed Deep Thinking Across All 3 Models (4B, 9B, 27B)
* **Goal-Oriented `<think>` Calibration:** Tuned `deep` thinking budget (`1,200` tokens on Step 1 strategy & architecture; rapid tactical execution on follow-up tool steps) so 27B Deep Think reasons deeply with a clear goal in mind without ruminating for 5,000+ tokens on routine file reads.
* **Dual XML & JSON `<tool_call>` Parser:** Added fallback parsing and tag stripping for both XML `<function=...>` and JSON `<tool_call>{"name":...}</tool_call>` formats inside `tabbyEngine.ts`.

### 📦 Antigravity Collapsible Running Activity Box & Overview Subagents
* **Auto-Collapsing `AgentActivityBox` in Main Thread:** Groups tool calls (with clean shortened paths like `Analyzed server/src/index.ts (L1–200)`) and intermediate step notes into a compact scrolling window while working, then **automatically collapses** into a single summary bar (`✓ Completed N actions (X files analyzed...)`) once finished.
* **Clean Final Response Separation (`STEP_NOTE_COMMITTED`):** Intermediate tool-step preambles are routed to the collapsible activity box and Overview drawer rather than cluttering the final Markdown answer.
* **Overview `Task Subagents & Logs` Monitor:** Live subagent status cards (`Autonomous Engineer`, `Goal Executor`, `System Architect`, `Principal Verifier`) with step counters and scrolling logs inside the right-hand Overview card.

### ⚡ Antigravity `/` Slash Commands
* **Interactive Slash Command Menu (`PromptBar.tsx` & `server/src/index.ts`):** Type `/` (or click the `/` toolbar icon) to trigger `/goal`, `/plan`, `/boost`, `/grill-me`, `/teamwork`, `/browser`, `/learn`, `/compact`, `/schedule`, and `/clear`.

---

## [v2.0.3] - 2026-11-06 (Context Window Protection & Full Local Filesystem Access)

### 🛡️ Unbounded Tool Output Truncation & Sliding Context Window Pruning
* **Head/Tail Truncation (`truncateSafeOutput`):** Enforced strict boundaries on tool outputs (`run_terminal` capped at 16k chars, `read_file` at 24k chars, `list_directory` at 150 items). Preserves 70% prefix and 30% suffix with an explicit omission notice, preventing recursive shell sweeps (`Get-ChildItem -Recurse`) from flooding memory.
* **Strict Context Window Budgeting (`pruneChatMessages`):** Implemented multi-stage context pruning respecting model context limits (55,000 char budget for 27B High tier, 75,000 for Low/Med tiers). Preserves OpenAI-compatible `assistant.tool_calls` and `tool` message pairing while preventing TabbyAPI HTTP 400 `context_length_exceeded` errors.
* **Jinja ChatML Template Normalization:** Eliminated Jinja `TemplateError: System message must be at the beginning.` by enforcing in `pruneChatMessages` that only index 0 carries `role: 'system'`, merging any late-arriving system directives into the root system message, and directly updating the initial prompt on step exhaustion.
* **Transparent Upstream Error Reporting:** When TabbyAPI returns an HTTP error code, `tabbyEngine.ts` parses the exact JSON error payload (`errJson.error?.message`) and streams it to the user instead of displaying a false "unable to reach TabbyAPI" notice.

### 🔓 Loosened Guardrails & Comprehensive Workstation Access
* **Full Filesystem Permissions Directive:** Replaced restrictive workspace boundaries with complete system access instructions. Central Brain can inspect, read, search, and manage files anywhere on the machine (`Downloads`, `Desktop`, `Documents`, root drives).
* **Multi-Step Agentic Completion:** Mandated that after gathering tool outputs, the model continues through synthesis to provide complete analyses, refactoring suggestions, and file changes directly to the user.

### 🪟 Windows Desktop Installer & Overview UX
* **New Windows MSI Package:** Rebuilt and published `LocalGravity_2.0.0_x64.msi` directly to Desktop, packaging the latest Tauri edge client with updated frontend assets.
* **Default Overview Drawer:** `README.md` is now collapsed into the Overview tab by default rather than expanding automatically across the right drawer.
* **Session Lifecycle Operations:** Fixed conversation deletion and thread clearing over WebSocket sync.

---

## [v2.0.2] - 2026-11-06 (Real Conversational Inference & Autonomous MCP Suite)

### 💬 Conversational Real-Time Assistant Streaming & Remote Client Fix
* **Eliminated Synthetic Fallback Jargon:** Removed embedded benchmark template fallback (`[Low 4B • Think: FAST] Processed your request...`) completely. The assistant now communicates strictly via real neural network generation from the active TabbyAPI EXL3 engine.
* **Resolved Remote Client VRAM Idle Catch-22:** Fixed an issue where `GET /v1/model` returning 404 (when no model was loaded in VRAM yet) caused `checkConnection()` to assume TabbyAPI was offline, blocking model loading from remote clients (e.g. macOS app). `checkConnection()` now queries `/v1/models` which accurately reports server readiness.
* **Instant Conversational Latency in Fast/Off Modes:** Qwen 3.5 now pre-closes `<think></think>` in Fast and Off modes, eliminating the 60+ second unbounded reasoning loop. Simple greetings like "hello" respond in under 200 milliseconds.
* **Continuous Thought Streaming in Deep Mode:** Unconstrained reasoning in Deep mode now streams all tokens smoothly into the Thought Accordion without prematurely dropping chunks.
* **Fast-Path Model Tier Swapping:** Model tier switching checks `/v1/model` before issuing unload/reload commands, eliminating redundant reloads when the requested tier is already active in VRAM.
* **Port 5001 Binding Separation:** Explicitly separated reserved port 5000 (forbidden to bind) from port 5001 (TabbyAPI host service), ensuring the Central Brain always connects to the workstation's active TabbyAPI engine.

### 🔌 Autonomous 6-MCP Suite Pre-Bundled
* **Pre-bundled Autonomous MCPs:** Added full MCP tool configurations out-of-the-box in `mcp_config.json`:
  * `playwright`: Headless browser automation (`@modelcontextprotocol/server-puppeteer`) for clicking, typing, form-filling, and visual verification.
  * `git`: Git operations (`mcp-server-git`) for safe branch creation, unified diffs, and commits.
  * `memory`: Persistent Knowledge Graph (`@modelcontextprotocol/server-memory`) for cross-session architecture and preference retention.
  * `sqlite`: Database state & migration inspection (`mcp-server-sqlite`).
  * `local-fetch`: Clean markdown scraping (`mcp-server-fetch`).
  * `filesystem`: Sandboxed file tree navigation (`@modelcontextprotocol/server-filesystem`).

---

## [v2.0.1] - 2026-11-06 (Multi-Platform Parity & TabbyAPI Qwen 3.5 Suite)

### 🪟 Windows Release & Loopback Fix
* **IPv4 Loopback Lock (`127.0.0.1`):** Resolved the issue where Windows WebView2 resolved `localhost` to `[::1]:3390` (IPv6), causing TCP drops. All client discovery endpoints now bind cleanly to `127.0.0.1:3390`.
* **Graceful Offline Detection:** Prompt submissions now verify active WebSocket connectivity. If offline, the client alerts the user with an actionable "Connect in Settings" card rather than spinning indefinitely.
* **New Windows Installer:** Packaged standard Microsoft Windows Installer (`LocalGravity_2.0.0_x64.msi`) containing the complete updated bundle.

### 🧠 TabbyAPI EXL3 Engine & Model Suite
* **Native TabbyAPI Wiring:** LocalGravity Central Brain connects directly to the workstation's active TabbyAPI instance at `http://127.0.0.1:5001` with API key and admin key authentication.
* **3-Tier Qwen 3.5/3.8 EXL3 Suite:**
  * **[ Low 4B ]:** `UnstableLlama/Qwen3.5-4B-exl3-4.00bpw` (Hybrid Mamba linear-attention, full vision, 262k context, 4.0bpw EXL3).
  * **[ Med 9B ]:** `Ppeerapon/Qwen3.5-9B-EXL3-4.0bpw` (Upgraded dense architecture succeeding Qwen3-8B, 4.0bpw EXL3, vision enabled).
  * **[ High 27B ]:** `Qwen3.8-27B-EXL3-11.5GB` (Deep architectural planning, running in VRAM with Q4 KV cache).
* **Automated SysRAM Hot-Swap:** Inactive tiers pre-warmed in DDR4 System RAM, streaming into VRAM via TabbyAPI `/v1/model/load` over PCIe in ~1s.

### 🍏 macOS Alignment & Unified UI
* **Merged macOS Overhaul:** Fully synchronized with macOS commits (`3a7ce1f` and `dbc5481`):
  * Decoupled WebSocket state effect from thread/project switching, eliminating state blinking.
  * Antigravity 2.0 typography, dark palette tokens, and streamlined PromptBar.
  * PC Brain Connection settings with live ping/latency diagnostic tester.
  * Multi-platform release assets: `.msi` (Windows) and `.dmg` (macOS arm64).

---

## [v2.0.0] - 2026-11-06 (Initial Decoupled Client & Harness² Framework)
* Strict client/brain decoupling: Edge clients manage independent project folders under `%APPDATA%\LocalGravity` (Windows) and `~/Library/Application Support/LocalGravity` (macOS).
* Google Harness² 8-component architecture (`.localgravity/harness/`) with automated recursive Propose-Probe-Compose self-healing loop.
* Contained foreground brain launcher (`runlocalgravitybrain.bat`) with dynamic port discovery and 10-minute idle VRAM auto-unload.
