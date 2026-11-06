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
