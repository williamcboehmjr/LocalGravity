# Harness² Component 3: Workspace Memory (memory.md)
- Workspace initialized with 8-component Harness² structure (`.localgravity/harness/`).
- Cross-turn procedural learnings are automatically composed into `EXPERIENCE.md` via the Propose-Probe-Compose loop.

## Architectural Map & Real DB Interfaces
- **Database (`server/src/db/database.ts`)**:
  - Class name: `LocalGravityDB`
  - Real Methods:
    - `listProjects()`, `getProject(id)`, `ensureDefaultProject(repoRoot)`
    - `listThreads(projectId)`, `getThread(id)`, `createThread(...)`, `updateThread(...)`, `deleteThread(id)`
    - `listMessages(threadId)`, `createMessage(...)`, `appendTokenDelta(...)`, `appendThoughtDelta(...)`, `resetStreamingMessageContent(...)`, `finalizeStreamingMessage(...)`
    - `createToolExecution(...)`, `updateToolExecution(...)`
    - `createFileCheckpoint(...)`, `listCheckpoints(threadId)`, `revertFileCheckpoint(...)`
  - **Does NOT Have**: `getAllThreads`, `getWorkspace`, `createWorkspace`, `getThreadCheckpoints` (use the exact methods above).

- **Tabby Engine (`server/src/tabby/tabbyEngine.ts`)**:
  - Class name: `TabbyEngine`
  - Public Methods: `streamChatCompletion(...)`, `getTelemetry()`, `switchModelTier(...)`, `checkConnection()`.
  - Properties like `activeTier`, `tokensPerSec`, `sysramCache` are accessed via `getTelemetry()`.

## User Output Formatting Preferences (standing)
- **Narrower margins**: keep prose tight — short paragraphs, no wide walls of text.
- **Bullets over paragraphs**: break findings/changes into bullet lists, not dense prose.
- **Formatting tricks**: use bold for key terms, tables for comparisons, code blocks for snippets.
- **Broken down**: split answers into small labeled sections (What / Why / Next) rather than one long block.
- **Scannable first**: lead with the outcome, then details. User should get the gist in 5 seconds.

## Who I Am (User Profile — inferred identity & taste)
*Keep this current; it's how I decide what to offer without being asked.*
- **Name / handle**: williamcboehmjr (GitHub). Builds and runs his own local AI stack (LocalGravity, TabbyAPI EXL2/EXL3).
- **Timezone**: **America/Los_Angeles (Pacific)** — use for all date/time answers. Confirm via `time` MCP when it matters.
- **Skill level / role**: power user + developer; comfortable in terminals, git, TS refactors. Treat as peer, not beginner.
- **Decisions he's made → what he likes**:
  - Prefers **autonomy + real execution** over explanations (wants tools run, results shown).
  - Wants me to **bias toward web/live search** for anything time-sensitive or versioned rather than trust training cutoff.
  - Likes installing capability when there's a real gap (added GitHub/Context7/Playwright/time) — favors *doing* over discussing.
  - Cares about **security hygiene**: secrets stay in keyring, never on disk/chat. Keep it that way.
- **Communication taste** (standing): scannable first — bullets/tables/bold, short sections (What/Why/Next), lead with the outcome. Tight margins, no walls of prose.
- **Pet peeves to avoid**:
  - Don't over-anchor on one topic (e.g. refactors) and drag it into unrelated turns — follow his lead.
  - Never fabricate/assert work without verifiable tool output; he notices and calls it out.

## MCP Servers Now Active (permanent reference)
- **playwright** *(replaced puppeteer)* · **github** (keyring-backed via launcher) · **context7** · **time** — plus pre-existing comfy-mcp, fetch/local-fetch, memory, sqlite, filesystem(roots widened).
- Full real-tool-name map + invocation quirks in `skills/mcp-servers.md`. After config edits, servers attach only on AGY restart / `/mcp reload` then *next* message.
