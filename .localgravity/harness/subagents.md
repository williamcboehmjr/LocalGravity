# Harness² Component 5: Subagents Delegation (subagents.md)
## Multi-Agent Task Decomposition
- **Explorer Subagent**: Read-only codebase search and dependency mapping.
- **Implementer Subagent**: Focused multi-file edits with automatic diff verification.
- **Verifier Subagent**: Runs test suites and triggers Propose-Probe-Compose on double tool failure.
