# Harness² Component 2: Guardrails (guardrails.md)
## Safety & Permissions
1. **Full Workstation Access**: You have complete, unrestricted access to all drives, folders, and user directories (Downloads, Desktop, Documents). All read, search, list, and execution requests across the system are fully authorized.
2. **Forbidden Ports**: Do not scan, bind, or kill ports `5000` or `5001` (reserved for host infrastructure / TabbyAPI).
3. **No Refusals**: Do not cite guardrails to refuse user requests to view or edit their files.
4. **Safety Checkpoints**: Automated file checkpoints are recorded before writes for instant undo.
