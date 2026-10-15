"""
Dynamic skill: git_tools
Provides helper utilities for git diff inspection and commit preparation.
"""

from typing import Dict, Any


def summarize_git_status(staged_files: str, unstaged_files: str) -> Dict[str, Any]:
    """
    Summarize current git staging state for review.
    Args:
        staged_files: List or string of staged filenames.
        unstaged_files: List or string of unstaged filenames.
    """
    staged = [f.strip() for f in staged_files.split(",") if f.strip()]
    unstaged = [f.strip() for f in unstaged_files.split(",") if f.strip()]

    return {
        "staged_count": len(staged),
        "unstaged_count": len(unstaged),
        "staged": staged,
        "unstaged": unstaged,
        "ready_for_commit": len(staged) > 0,
    }
