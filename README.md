# LocalGravity (LocalGravity Local-First Clone)

A production-grade, local-first clone of **LocalGravity** featuring a distributed **"Central Brain, Edge Executor"** topology, zero-latency tiered model manager, and exact 3-pane UI parity.

---

## Architecture Overview

LocalGravity splits AI reasoning from edge execution:
1. **Central Brain (Windows Workstation):**
   * High-performance Python FastAPI engine running on port `3390`.
   * Directly interfaces with local Ollama (`http://localhost:11434`).
   * Manages GPU VRAM eviction (`keep_alive: 0`) and sub-second model swapping using host DDR4 RAM / RAMDisk caching.
   * Dispatches Reverse-RPC execution commands over encrypted WebSockets (`ws://<host>:3390/ws/agent/{session_id}`).
2. **Edge Client (Multi-Platform Native Shell):**
   * Multi-platform Tauri v2 + React 19 / TypeScript / Vite / Tailwind CSS / Monaco editor application.
   * Commands (`run_command`, `read_file`, `write_file`) are executed **natively on the edge machine** (`powershell.exe` on Windows, `/bin/zsh` on macOS).
   * Live `stdout`/`stderr` chunks stream continuously back to the Central Brain and expand inside real-time LocalGravity Thought Accordions.

---

## 3-Tier Multimodal Model Suite

All three models natively support **Vision + Tools + Thinking**:

| Mode | Ollama Tag | Architecture & Params | VRAM Footprint | Best Role |
| :--- | :--- | :--- | :--- | :--- |
| **`[ Low ]`** | `qwen3.5:4b` | `qwen35` (4.7B, Q4_K_M) | **~3.4 GB** | Sub-second screenshot triage, fast OCR, and quick tool commands (90+ tok/s). |
| **`[ Medium ]`** | `qwen3.5:9b` | `qwen35` (9.7B, Q4_K_M) | **~6.6 GB** | Core development workhorse, code refactoring, diff generation, and UI grounding (60+ tok/s). |
| **`[ High ]`** | `qwen3.8-27b-vl:latest` | `qwen35` (26.9B, IQ3_S) | **~11.0 GB** | 27B deep architectural reasoning, multi-file planning, and complex visual analysis (30+ tok/s). |

---

## Dynamic Thinking Budget Controller

LocalGravity decouples model weight size from thinking depth right from the prompt bar:
* **`[ Off ]`**: 0 ms delay. Direct tool calls or answers without scratchpad.
* **`[ Fast ]`**: ~250 tokens / 2s quick verification sanity check.
* **`[ Deep ]`**: Full chain-of-thought deliberation inside real-time LocalGravity Thought Accordions with stopwatch and token counts.

---

## Quickstart

### 1. Launch Central Brain
```powershell
cd brain
.venv\Scripts\activate
uvicorn src.main:app --host 0.0.0.0 --port 3390 --reload
```
Check health: `http://localhost:3390/health`

### 2. Launch Client
```powershell
cd client
npm run dev
```
Open `http://localhost:5173` in your browser, or run desktop native shell:
```powershell
npm run tauri dev
```
