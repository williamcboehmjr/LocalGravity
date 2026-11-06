---
name: localgravity_architecture
description: Complete architecture guide for LocalGravity 2.0 (Google Antigravity 2.0 Perfect Clone + Harness² Recursive Self-Improving Architecture + TabbyAPI EXL2/EXL3 SysRAM Hot-Swap Engine).
---

# LocalGravity 2.0 Architecture & Harness² Guide

## 1. Identity & Decoupled Topology
- **You are LocalGravity 2.0**, a 100% self-hosted clone of **Google Antigravity 2.0** incorporating Google's **Harness²** 8-component recursive self-improving architecture.
- **Strict Client-Brain Decoupling**:
  - **Central Brain (`server/` & `brain/`)**: Runs headlessly on the Windows workstation via Fastify + TabbyAPI EXL2/EXL3 (`cache_mode: Q4`, `autosplit_reserve: [256]`, `draft_mode: ngram`, `hybrid_draft_tokens: 4`) with a 128 GB System RAM Hot-Swap Cache Warmer.
  - **Native & Web Clients (`client/` & `client/src-tauri/`)**: Connect over WebSocket (`/ws/sync`, `/ws/terminal`, `/ws/agent/:sessionId`) from macOS Tauri, Windows Tauri, or remote LAN/Tailscale browsers.
  - **Client AppData Storage**: Client state (`mcp_config.json`, `projects.json`, `agent.md`) lives in OS-native AppData (`~/Library/Application Support/LocalGravity/` on macOS and `%APPDATA%\LocalGravity\` on Windows).
- **Critical Port Constraint**: Ports `5000` and `5001` are strictly forbidden and NEVER scanned or bound. Dynamic port discovery starts at `3390` (Daemon) and `3450` (TabbyAPI) and writes atomically to `.runtime/ports.json`.

---

## 2. TabbyAPI 3-Tier EXL2/EXL3 Model Suite & 3×3 Thinking Matrix
- **Model Tiers**:
  - `[ Low 4B ]`: **Qwen 3.5 4B (EXL2/EXL3 ~4.5 bpw)** (`vision_offload: false`)
  - `[ Med 9B ]`: **Qwen 3.5 9B (EXL2/EXL3 ~4.0 bpw)** (`vision_offload: false`)
  - `[ High 27B ]`: **Qwen 3.8 27B VL (EXL2/EXL3 ~3.5 bpw)** (`vision_offload: true`)
- **Thinking Budgets (Decoupled 3×3 Matrix)**:
  - `[ Off ]`: Injects closed `<think></think>` prefill for 0ms overhead.
  - `[ Fast ]`: Enforces ~250-token rapid verification check.
  - `[ Deep ]`: Unconstrained chain-of-thought streamed live into the Antigravity Thought Accordion.

---

## 3. Google Harness² 8-Component Workspace Structure (`.localgravity/harness/`)
1. `system.md`: Core role and operational constraints.
2. `guardrails.md`: Safety rules, port blocks (`5000`/`5001`), and destructive command preventions.
3. `memory.md` & `EXPERIENCE.md`: Persistent cross-turn experiences and workspace learnings.
4. `tools.md`: Instructions for local MCP tools, ripgrep, and `node-pty` / PowerShell / Zsh commands.
5. `subagents.md`: Delegation rules for complex refactoring tasks.
6. `skills/`: Dynamic procedural scripts loaded on demand.
7. `scripts/`: Local helper automation.
8. `plugins/`: Middleware that shapes behavior inside the tool loop.

### Recursive Propose-Probe-Compose (PPC) Loop
When a tool or task fails twice (`failureCount >= 2`):
1. **Propose**: Generates a localized candidate adjustment to `tools.md` or `guardrails.md`.
2. **Probe**: Reruns the execution step with the adjusted harness.
3. **Compose**: Compares stdout/stderr telemetry against the failed run and commits verified procedural fixes into `EXPERIENCE.md` without modifying model weights.
