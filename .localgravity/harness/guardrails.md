# Harness² Component 2: Guardrails (guardrails.md)
## Safety & Port Constraints
1. **Forbidden Ports**: NEVER scan, bind, or probe TCP ports `5000` or `5001` under any circumstances.
2. **Destructive Command Prevention**: Block unconfirmed recursive deletions (`rm -rf /`, `Remove-Item -Recurse` outside workspace root) and force-pushes (`git push --force`).
3. **Checkpoint Requirement**: Always snapshot existing files before `write_file` or `apply_diff`.
