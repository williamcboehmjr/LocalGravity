<div align="center">

# LocalGravity

**An independent, local-first agentic coding workspace — built for your own GPU first, with cloud APIs when you want them.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/williamcboehmjr/LocalGravity?style=flat-square&color=brightgreen)](https://github.com/williamcboehmjr/LocalGravity/releases/latest)
[![Build Status](https://img.shields.io/github/actions/workflow/status/williamcboehmjr/LocalGravity/release.yml?style=flat-square&label=Cross-Platform%20Builds)](https://github.com/williamcboehmjr/LocalGravity/actions)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20ChromeOS-informational?style=flat-square)](#platform-support)

[Why I Built This](#why-i-built-this) · [How It Uses Strata](#how-localgravity-uses-strata-differently) · [Workbench & Agent Features](#workbench--agent-features) · [Architecture](#architecture) · [Roadmap & `/megaswarm`](#whats-coming-next) · [Quick Start](#quick-start-from-source) · [Contributing](#contributing--feature-requests)

</div>

---

> **Trademark & Non-Affiliation Note:** LocalGravity is an independent hobby project inspired by modern agentic IDE workflows. It is **not** affiliated with, endorsed by, or connected to Google LLC or Google Antigravity. All trademarks belong to their respective owners.

<p align="center">
  <img src="docs/screenshots/workspace-desktop.png" alt="LocalGravity Workspace running locally on Strata Qwen 3.8 Flash-Next" width="840" />
</p>

---

## Why I Built This

I wanted an Antigravity-style coding workspace—real-time thinking and working traces, file review checkpoints with inline diffs, multi-agent swarms, an integrated terminal/editor workbench, and mobile/tablet companion access—that runs **local-first on my own workstation GPU**, while still letting me switch over to cloud APIs (like Google AI Studio) whenever I want extra speed or frontier reasoning.

---

## How LocalGravity Uses Strata Differently

Most local LLM clients treat inference like a static chat box where you manually start a backend server and keep weights pinned in VRAM all day. LocalGravity wires **Strata** (`0.1.58`, port `8080`) into an autonomous workstation daemon (`Central Brain`) with a few key differences:

- **Primary Local Model:** `Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS` (Sparse MoE + Vision, 64k context, `DFlash2` speculative decoding config).
- **Why this model:** It balances fast token generation with native multimodal vision and reliable tool-calling inside consumer VRAM limits, making it practical for multi-step coding loops instead of just single-turn Q&A.
- **Wake-on-Demand & Guaranteed `0 MB` VRAM Standby:** Instead of hogging VRAM 24/7, `LlamaMoESidecar` spawns Strata only when a prompt arrives, polls `/health` until ready, and automatically tears down the port `8080` process after idle timeout (or when you click **Sleep GPU**) so your GPU drops straight back to **0 MB VRAM**.
- **Full Agentic Loop Over Strata's Stream:** Rather than plain chat, `Central Brain` wraps Strata's stream in a multi-step tool loop (`run_terminal`, `read_file`, `write_file`, `edit_file`, `apply_diff`, `lsp_diagnostics`, `grep_search`, `find_by_name`, `capture_screen`, MCP tools, `/swarm`, `@repo-map`, and auto-compaction) with **Reverse-RPC execution** and **automatic post-edit syntax checks** on whatever client device you're working from.
- **Live Thinking & Interleaved Working Trace:** Reasoning tokens stream into collapsible `Thought for Xs` accordions alongside borderless tool rows, `+X / -Y` diff badges, and interleaved `Working → Prose → Working` updates.

| Capability | Default Strata Client | LocalGravity + Strata |
| :--- | :--- | :--- |
| **GPU Lifecycle** | Manual start/stop; stays in VRAM | **Wake-on-Demand** + auto-offload to `0 MB` VRAM |
| **Execution** | Single-machine chat | **Reverse-RPC** native file edits & terminal across LAN/devices |
| **Workflow** | Single-turn prompt & reply | Multi-step `/plan`, `/goal`, `/swarm`, `/boost`, `/compact` |
| **Workbench** | Chat view only | **3-Pane IDE + Overview Sidebar** (`Review`, `Files`, `Terminal`, `Extensions`, `Subagents`, `Artifacts`, Revert & Chat Rewind) |
| **Cloud Toggle** | Local only | Local-first **Provider Registry** (`Strata`, `Ollama`, `llama.cpp`, `TabbyAPI`) + opt-in **Google AI Studio** & **Parallel MCP** |

<details>
<summary><strong>Screenshot: Redesigned Minimalist Settings Modal</strong></summary>
<br />
<p align="center">
  <img src="docs/screenshots/settings-modal.png" alt="LocalGravity Minimalist Settings" width="760" />
</p>
</details>

---

## Workbench & Agent Features

Built around a **local-first, cloud-optional** workflow and tuned specifically to help local models hit higher accuracy in fewer turns:

- **Collapsible Overview Sidebar & Extensions Panel:** Opens directly to **Overview** with quick navigation to `Review`, `Files`, `Terminal`, and `Extensions`, collapsed `Subagents` & `Background Tasks` counters, and `Artifacts` (capped at 4 by default with `See more / See less`). The **Extensions** panel manages installed Skills and both `stdio` and **Streamable HTTP / SSE MCP** servers with persistent enable/disable toggles across restarts (including opt-in **Parallel MCP** web research, disabled by default).
- **LSP Diagnostics & Post-Edit Auto-Check:** Built-in `lsp_diagnostics` tool (`diagnostics`, `symbols`, `repo_map`) plus instant syntax and parse validation automatically appended to `write_file`, `edit_file`, and `apply_diff` outputs so the model catches typos and broken syntax immediately.
- **Compact Repo Map & Dynamic `@` Context Mentions:** A ~1,200-token, reference-ranked symbol map (`@repo-map`) plus live `@git-diff` and `@problems` injections give smaller local models full codebase awareness without blowing the context window. Both `/` slash commands and `@` mentions work cleanly mid-sentence at the cursor.
- **Uniform Local-First Provider Registry (`/api/providers`):** Persists provider profiles in `.runtime/providers.json`, defaulting to local **Strata (`:8080`)** with preconfigured profiles for **Ollama (`:11434`)**, **llama.cpp (`:8081`)**, **TabbyAPI (`:5000`)**, custom OpenAI-compatible endpoints, and opt-in **Google AI Studio**.
- **Granular `allow` / `ask` / `deny` Permission Engine (`/api/permissions`):** Ordered glob rules over tool names and shell commands (e.g., auto-allowing read-only inspection and `git status`, hard-blocking destructive root commands) persisted across restarts.
- **1-Click Revert & Full Chat Rewind:** Every edit records a checkpoint in SQLite. From **Review**, choose **Revert** (restore that file only) or **Rewind** (restore files, roll back newer edits, and rewind the chat thread back to that exact turn).
- **Portable Repo Rules & OpenAPI 3.1 (`/api/openapi.json`):** Automatically loads `AGENTS.md`, `CLAUDE.md`, `.clinerules`, `.cursorrules`, and `.goosehints` alongside `.localgravity/harness/`, and exposes an OpenAPI 3.1 schema for external CLI/TUI/automation clients.

---

## Architecture

LocalGravity splits AI orchestration from native machine execution:

```mermaid
flowchart LR
    subgraph Edge["Edge Clients (Tauri v2 / WebUI)"]
        WIN["Windows x64 & ARM64"]
        MAC["macOS Universal"]
        LIN["Linux AppImage / DEB / RPM"]
        MOB["Android & ChromeOS APK"]
    end

    subgraph Brain["Central Brain (TypeScript + Fastify · :3390)"]
        ROUTER["Provider Registry & Orchestrator Router"]
        SWARM["/swarm + Subagents + HTTP/stdio MCP"]
        GUARD["LSP + RepoMap + Allow/Ask/Deny Guard"]
        DB[("SQLite History & Rewind Checkpoints")]
    end

    subgraph Inference["Inference Engines"]
        STRATA["Strata Local GPU (:8080)\nSwift-1.5 Qwen 3.8 Flash-Next\nWake-on-Demand / 0 MB Standby"]
        LOCAL["Local Registry Profiles\nOllama · llama.cpp · TabbyAPI · OpenAI-Compatible"]
        CLOUD["Cloud Optional\nGoogle AI Studio (Argon / Carbon / Hydrogen) · Parallel MCP"]
    end

    Edge <-->|"WebSocket Reverse-RPC + REST"| Brain
    Brain --> STRATA
    Brain --> LOCAL
    Brain -.-> CLOUD
```

---

## Platform Support

| Platform | Package Formats | Notes |
| :--- | :--- | :--- |
| **Windows (`x64` & native `ARM64`)** | `.msi` + `.sig` | Signed Tauri v2 native installers + in-app auto-update |
| **macOS (Apple Silicon + Intel)** | Universal `.dmg` + `.app.tar.gz` | Single Universal binary built on `macos-latest` |
| **Linux (`x64`)** | `.AppImage`, `.deb`, `.rpm` | Covers Ubuntu, Debian, Arch, Fedora, openSUSE, SteamOS |
| **Android & ChromeOS** | Signed `.apk` | Resizable window + non-touch Chromebook manifest support |
| **Web Companion** | Built-in WebUI | Served directly from Central Brain (`http://<host>:3390`) |

---

## What's Coming Next

- **What's Ready vs. Next:** Preconfigured local profiles for **Ollama**, **llama.cpp**, **TabbyAPI**, and custom **OpenAI-compatible** endpoints are now registered in Central Brain's `ProviderRegistry` (`/api/providers`), with full streaming adapter UI routing next.
- **`/megaswarm` (Experimental Idea):** Something I'm toying with—being able to pull together a big swarm of different cloud and local APIs (**Grok, ChatGPT / OpenAI, Google Gemini, Claude**, and more) all working in unison on the same problem. Great for kicking off a hard project on the right foot, or throwing combined brainpower, horsepower, and speed at a tough bug.

---

## Contributing & Feature Requests

This is a **side hobby project**, so I keep things straightforward:
- **Feature Requests:** Open an issue anytime! I read everything and love hearing ideas, though I can't promise timelines or that every request will make it in.
- **Forks & Pull Requests:** You're more than welcome to fork the repo and submit a PR. Incoming PRs go through AI-assisted code review and safety checks (plus human review) to verify changes make sense and stay safe before merging into `main`.

---

## Quick Start (From Source)

### 1. Start Central Brain
```bash
cd server
npm install
npm run build
npm start
```
Verify health: `http://127.0.0.1:3390/api/health`

### 2. Start the Client (Web or Desktop)
```bash
cd client
npm install
npm run dev        # WebUI at http://localhost:5173
# or
npm run tauri dev  # Native desktop shell
```

Prebuilt installers are available on the [Releases](https://github.com/williamcboehmjr/LocalGravity/releases) page.

---

## Credits & Open-Source Licenses

LocalGravity builds on a lot of great open-source software:

- **Desktop & Mobile Runtime:** [Tauri](https://tauri.app/) (MIT / Apache-2.0), [Rust](https://www.rust-lang.org/) (`tokio`, `tokio-tungstenite`, `serde`, `futures-util`)
- **Frontend UI:** [React](https://react.dev/) (MIT), [Vite](https://vite.dev/) (MIT), [Tailwind CSS](https://tailwindcss.com/) (MIT), [Zustand](https://github.com/pmndrs/zustand) (MIT), [Lucide Icons](https://lucide.dev/) (ISC)
- **Editor, Terminal & Markdown:** [Monaco Editor](https://microsoft.github.io/monaco-editor/) (MIT), [xterm.js](https://xtermjs.org/) (MIT), [react-markdown](https://github.com/remarkjs/react-markdown) & [remark-gfm](https://github.com/remarkjs/remark-gfm) (MIT)
- **Backend & Storage:** [Fastify](https://fastify.dev/) (MIT), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (MIT), [ws](https://github.com/websockets/ws) (MIT), [pdf-parse](https://www.npmjs.com/package/pdf-parse) (MIT), [yaml](https://github.com/eemeli/yaml) (ISC)
- **Local Inference & Tools:** Strata local inference runtime, [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT), [ExLlamaV3](https://github.com/turboderp-org/exllamav3), [Playwright](https://playwright.dev/) (Apache-2.0), and the Model Context Protocol (MCP)
- **Open-Source Agentic Inspiration:** Architectural patterns learned from studying [OpenCode](https://github.com/anomalyco/opencode), [Aider](https://github.com/Aider-AI/aider), [Continue.dev](https://github.com/continuedev/continue), [Cline](https://github.com/cline/cline) / [Roo Code](https://github.com/RooVetGit/Roo-Code), and [Block Goose](https://github.com/block/goose) (adapted independently into LocalGravity's TypeScript + Rust + SQLite codebase).

---

## License

MIT License — see [LICENSE](LICENSE) for details.
