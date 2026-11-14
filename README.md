# LocalGravity

An independent, **local-first** agentic coding workspace built to bring an Antigravity-style workflow to your own hardware — with optional cloud APIs when you want them.

> **Disclaimer / Trademarks:** LocalGravity is an independent hobby project inspired by modern agentic coding workflows. It is **not** affiliated with, endorsed by, or connected to Google LLC or Google Antigravity. All product names, logos, and trademarks belong to their respective owners.

---

## Why I Built This

I wanted an Antigravity-style coding experience—clean thinking/working traces, file review diffs, multi-agent swarms, terminal/editor integration, and mobile/desktop companion access—that runs **local-first** on my own workstation GPU, while still letting me flip over to cloud APIs (like Google AI Studio) whenever I want extra speed or reasoning power.

It splits the app into two halves:
1. **Central Brain (`server/`)** — A TypeScript + Fastify daemon with SQLite persistence that handles model routing, orchestrators, `/swarm` coordination, MCP tools, and session history.
2. **Edge Client (`client/`)** — A Tauri v2 + React + Monaco + xterm.js app that connects over HTTP/WebSocket and runs file edits and shell commands natively on your machine (Windows, macOS, Linux, Android/ChromeOS, or any browser).

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/workspace-desktop.png" alt="LocalGravity Desktop Workspace" width="820" />
</p>

<p align="center">
  <img src="docs/screenshots/settings-modal.png" alt="LocalGravity Minimalist Settings" width="820" />
</p>

---

## What Works Today

- **Local GPU & Cloud API Switching**: Run locally with Strata / ExLlamaV3 (with automatic VRAM wake/offload) or switch to Google AI Studio (`Gemini 4 Argon`, `Carbon`, `Hydrogen`, `Flash 3.8`, plus dual orchestrators).
- **Clean Thinking & Working Trace**: Borderless tool rows with file-type badges, inline `+X / -Y` diff stats, collapsible `Thought for Xs` / `Worked for Xs` summaries, and interleaved `Working → Prose → Working` output.
- **Slash Commands & Workflows**: `/plan`, `/goal`, `/swarm`, `/boost`, `/compact`, `/vision`, custom skills, and MCP tool integrations.
- **Cross-Platform Builds**:
  - **Windows**: `x64` and native `ARM64` `.msi` installers
  - **macOS**: Universal `.dmg` (Apple Silicon + Intel)
  - **Linux**: `.AppImage`, `.deb`, and `.rpm`
  - **Android & ChromeOS**: Signed `.apk` with resizable desktop/Chromebook window support
  - **Web Companion**: Built-in WebUI served straight from Central Brain (`http://<host>:3390`)

---

## Coming Soon & Ideas I'm Toying With

- **More Local & Custom API Backends**: Adding first-class support for **Ollama**, **llama.cpp** server, **TabbyAPI**, and general **OpenAI-compatible routing** so you can point LocalGravity at whatever local or hosted endpoint you prefer.
- **`/megaswarm` (Experimental Idea)**: A mode where you can pull in a large swarm of different cloud and local APIs—**Grok, ChatGPT / OpenAI, Google Gemini, Claude**, and others—all working in unison on the same problem. The idea is to throw serious combined brainpower, horsepower, and speed at a hard project right from the start, or when you hit a wall on a nasty bug.

---

## Contributing, Feature Requests & PRs

This is a **side hobby project**, so please keep expectations realistic:
- **Feature Requests**: Feel free to open an issue with ideas! I'm happy to read them, though I can't promise timelines or that everything will get built.
- **Forks & Pull Requests**: You're very welcome to fork the repo and open a PR. Before anything gets merged into `main`, PRs go through AI-assisted review and safety checks (along with human review) to make sure changes make sense, stay safe, and don't break existing workflows.

---

## Quick Start (From Source)

### 1. Start Central Brain
```bash
cd server
npm install
npm run build
npm start
```
Health check: `http://127.0.0.1:3390/api/health`

### 2. Start the Client (Web or Desktop)
```bash
cd client
npm install
npm run dev        # WebUI at http://localhost:5173
# or
npm run tauri dev  # Native desktop shell
```

Prebuilt installers for Windows, macOS, Linux, and Android are posted on the [Releases](https://github.com/williamcboehmjr/LocalGravity/releases) page.

---

## Credits & Open-Source Licenses

LocalGravity stands on the shoulders of a ton of great open-source work:

- **Desktop & Mobile Shell**: [Tauri](https://tauri.app/) (MIT / Apache-2.0) and [Rust](https://www.rust-lang.org/) (`tokio`, `tokio-tungstenite`, `serde`, `futures-util`)
- **Frontend UI**: [React](https://react.dev/) (MIT), [Vite](https://vite.dev/) (MIT), [Tailwind CSS](https://tailwindcss.com/) (MIT), [Zustand](https://github.com/pmndrs/zustand) (MIT), [Lucide Icons](https://lucide.dev/) (ISC)
- **Editor, Terminal & Markdown**: [Monaco Editor](https://microsoft.github.io/monaco-editor/) (MIT), [xterm.js](https://xtermjs.org/) (MIT), [react-markdown](https://github.com/remarkjs/react-markdown) & [remark-gfm](https://github.com/remarkjs/remark-gfm) (MIT)
- **Server & Persistence**: [Fastify](https://fastify.dev/) (MIT), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (MIT), [ws](https://github.com/websockets/ws) (MIT), [pdf-parse](https://www.npmjs.com/package/pdf-parse) (MIT), [yaml](https://github.com/eemeli/yaml) (ISC)
- **Local Inference & Tools**: [llama.cpp](https://github.com/ggml-org/llama.cpp) / [ExLlamaV3](https://github.com/turboderp-org/exllamav3) / Strata local inference ecosystem, [Playwright](https://playwright.dev/) (Apache-2.0), and the Model Context Protocol (MCP)

---

## License

Licensed under the [MIT License](LICENSE).
