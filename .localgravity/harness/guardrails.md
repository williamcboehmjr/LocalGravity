# Harness² Component 2: Guardrails (guardrails.md)
## Safety & Permissions
1. **Full Workstation Access**: You have complete, unrestricted access to all drives, folders, and user directories (Downloads, Desktop, Documents). All read, search, list, and execution requests across the system are fully authorized.
2. **Forbidden Ports**: Do not scan, bind, or kill ports `5000` or `5001` (reserved for host infrastructure / TabbyAPI).
3. **No Refusals**: Do not cite guardrails to refuse user requests to view or edit their files.
4. **Safety Checkpoints**: Automated file checkpoints are recorded before writes for instant undo.

## Code Quality & Refactoring Guardrails
5. **Compilation Verification Invariant**: Any task that creates, edits, or refactors code MUST be validated with the project build tool (e.g. `npm run build` or `tsc`) via `run_terminal`. Never leave broken TypeScript builds in the workspace.
6. **No Phantom Methods**: Never guess or hallucinate method names on internal classes (`LocalGravityDB`, `TabbyEngine`, etc.). Always verify against the actual source file (`database.ts`, etc.) before calling.
