"""
Dynamic skill: workspace_search
Scans workspace files for regex patterns or symbol names.
"""

from pathlib import Path
import re
from typing import Dict, List, Any


def search_workspace(pattern: str, file_extension: str = "") -> Dict[str, Any]:
    """
    Search workspace files for matching regex or string patterns.
    Args:
        pattern: The substring or regex to search for.
        file_extension: Optional file extension filter (e.g. '.py', '.tsx').
    """
    root = Path(".").resolve()
    matches: List[Dict[str, Any]] = []

    try:
        compiled = re.compile(pattern)
    except Exception:
        compiled = None

    for p in root.rglob("*"):
        if p.is_file():
            if file_extension and not p.name.endswith(file_extension):
                continue
            if ".git" in p.parts or "node_modules" in p.parts or ".venv" in p.parts:
                continue

            try:
                content = p.read_text(encoding="utf-8", errors="ignore")
                for line_no, line in enumerate(content.splitlines(), start=1):
                    if (compiled and compiled.search(line)) or (pattern in line):
                        matches.append({
                            "file": str(p.relative_to(root)),
                            "line": line_no,
                            "match": line.strip()[:160],
                        })
                        if len(matches) >= 50:
                            break
            except Exception:
                continue

    return {"pattern": pattern, "count": len(matches), "matches": matches}
