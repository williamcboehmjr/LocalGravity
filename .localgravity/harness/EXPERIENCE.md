# Harness² Component 3B: Composed Procedural Experience (EXPERIENCE.md)
<!-- Auto-populated by the Recursive Propose-Probe-Compose Loop when tool errors are resolved -->
- **[Baseline]**: Prefer cross-platform path resolution and check file existence before applying diffs or shell pipelines.

### [PPC Composed Fix • 2026-11-06T07:37:46.498Z]
- **Failed Tool**: `run_terminal` (`bad-flag-cmd --fail`)
- **Initial Failure Telemetry**: `Error: unrecognized flag --fail`
- **Harness Adjustment**: Updated `tools.md`
- **[PPC Auto-Tool Rule 2026-11-06T07:37:46.498Z]**: Tool `run_terminal` (`bad-flag-cmd --fail`) encountered error `Error: unrecognized flag --fail`. Fallback to safe cross-platform invocation.
- **Probe Verification**: Exit code `0` (Probe fallback succeeded)

