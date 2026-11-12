---
name: workspace_search
description: Regex/grep code exploration skill. Scans workspace files for regex patterns or symbol names.
---

# Workspace Search Skill

Use this skill to explore code in the workspace: find symbol names, function definitions, usages, or any regex pattern across files.

## Available Functions

### `search_workspace(pattern: str, file_extension: str = "")`
Recursively scans workspace files for lines matching the pattern (regex or plain substring). Skips `.git`, `node_modules`, and `.venv` directories. Returns up to 50 matches as `{file, line, match}` entries.

Example:
```python
search_workspace(pattern="def ", file_extension=".py")
search_workspace(pattern="useSessionStore")
```
