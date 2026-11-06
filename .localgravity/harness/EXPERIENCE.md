# Harness² Component 3B: Composed Procedural Experience (EXPERIENCE.md)
<!-- Auto-populated by the Recursive Propose-Probe-Compose Loop when tool errors are resolved -->
- **[Baseline]**: Prefer cross-platform path resolution and check file existence before applying diffs or shell pipelines.

### [PPC Composed Fix • 2026-11-06T07:37:46.498Z]
- **Failed Tool**: `run_terminal` (`bad-flag-cmd --fail`)
- **Initial Failure Telemetry**: `Error: unrecognized flag --fail`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-06T07:37:46.498Z]**: Tool `run_terminal` (`bad-flag-cmd --fail`) encountered error `Error: unrecognized flag --fail`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe fallback succeeded)

### [PPC Composed Fix • 2026-11-06T19:25:26.839Z]
- **Failed Tool**: `run_terminal` (`run_terminal({"command":"cd C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity; mkdir -p server/src/routes server/src/services server/src/ws server/src/config"})`)
- **Initial Failure Telemetry**: `mkdir : A positional parameter cannot be found that accepts argument 'server/src/services'. At line:1 char:59 + ... calGravity; mkdir -p server/src/routes serve`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-06T19:25:26.839Z]**: Tool `run_terminal` (`run_terminal({"command":"cd C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity; mkdir -p server/src/routes server/src/services server/src/ws server/src/config"})`) encountered error `mkdir : A positional parameter cannot be found that accepts argument 'server/src/services'.
At line:1 char:59
+ ... ca`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe succeeded for run_terminal with updated tools.md)

