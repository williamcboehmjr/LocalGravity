---
name: git_tools
description: Git version control skill. Summarize current git staging state for review before committing.
---

# Git Tools Skill

Use this skill when you need to inspect the git staging state before committing or reviewing pending changes.

## Available Functions

### `summarize_git_status(staged_files: str, unstaged_files: str)`
Parses comma-separated lists of staged and unstaged filenames and returns a summary of the current staging state.

Returns:
- `staged_count` / `unstaged_count`: number of staged and unstaged files
- `staged` / `unstaged`: the parsed file lists
- `ready_for_commit`: `true` when at least one file is staged

Example:
```python
summarize_git_status(staged_files="brain/src/main.py, client/src/App.tsx", unstaged_files="README.md")
```
