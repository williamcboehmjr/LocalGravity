"""
Dynamic Skills Loader & Hot-Reload Engine for LocalGravity.

Single-source-of-truth policy (prevents drift + redundancy between SKILL.md and skill.py):
  - A folder containing a `skill.py` is treated as a *tool skill*: its function
    signatures are the source of truth. That folder's `SKILL.md` is ignored by the
    loader (it may still exist purely as human-readable documentation).
  - A folder with only a `SKILL.md` is a *docs-only skill* (e.g. self-knowledge).
  - Functions whose names collide with the built-in standard tools are skipped so
    they are never double-listed in the system prompt.
"""

import ast
import logging
from pathlib import Path
from typing import Any, Dict, FrozenSet, List, Optional

logger = logging.getLogger("LocalGravity.SkillsLoader")


class SkillMetadata:
    def __init__(self, name: str, description: str, parameters: Dict[str, Any], path: Path):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.path = path


class SkillsRegistry:
    def __init__(self, skills_dir: str = "../../skills"):
        p = Path(skills_dir)
        if not p.is_absolute():
            candidate = Path(__file__).resolve().parent.parent.parent.parent / "skills"
            if candidate.exists():
                self.skills_dir = candidate.resolve()
            else:
                self.skills_dir = p.resolve()
        else:
            self.skills_dir = p.resolve()
        self.skills: Dict[str, SkillMetadata] = {}
        self.reload_skills()

    def reload_skills(self):
        """Scans the skills directory and extracts tool signatures."""
        self.skills.clear()
        if not self.skills_dir.exists():
            try:
                self.skills_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
            return

        # Built-in standard tool names, used to avoid duplicating them in the prompt.
        try:
            from ..agent.tools_schema import STANDARD_TOOLS_SCHEMA
            standard_names: FrozenSet[str] = frozenset(
                t["function"]["name"] for t in STANDARD_TOOLS_SCHEMA
            )
        except Exception:
            standard_names = frozenset()

        # 1. Load from skill.py files (source of truth for executable tool skills).
        folders_with_skill_py: set = set()
        for skill_file in self.skills_dir.glob("**/skill.py"):
            folders_with_skill_py.add(skill_file.parent)
            try:
                self._load_skill_file(skill_file, standard_names)
            except Exception as e:
                logger.warning(f"Failed to parse skill at {skill_file}: {e}")

        # 2. Load from SKILL.md files, but SKIP any folder that already has a skill.py
        #    (single source of truth -> no double-listing, no drift between the two files).
        for skill_md in self.skills_dir.glob("**/SKILL.md"):
            if skill_md.parent in folders_with_skill_py:
                continue
            try:
                self._load_skill_md(skill_md)
            except Exception as e:
                logger.warning(f"Failed to parse skill markdown at {skill_md}: {e}")

        logger.info(f"Loaded {len(self.skills)} dynamic skills from {self.skills_dir}")

    def _load_skill_md(self, path: Path):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        name = path.parent.name
        description = "Custom LocalGravity skill."

        # Parse YAML frontmatter if present
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                frontmatter = parts[1]
                for line in frontmatter.strip().split("\n"):
                    if line.startswith("name:"):
                        name = line.split(":", 1)[1].strip()
                    elif line.startswith("description:"):
                        description = line.split(":", 1)[1].strip()

        skill = SkillMetadata(
            name=name,
            description=description,
            parameters={"type": "object", "properties": {}, "required": []},
            path=path,
        )
        self.skills[name] = skill

    def _load_skill_file(self, path: Path, standard_names: FrozenSet[str] = frozenset()):
        with open(path, "r", encoding="utf-8") as f:
            code = f.read()

        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
                # Skip functions that are already built-in standard tools (no duplication).
                if node.name in standard_names:
                    continue

                doc = ast.get_docstring(node) or "No description provided."
                params: Dict[str, Any] = {"type": "object", "properties": {}, "required": []}

                for arg in node.args.args:
                    arg_name = arg.arg
                    params["properties"][arg_name] = {"type": "string", "description": f"Argument {arg_name}"}
                    params["required"].append(arg_name)

                skill = SkillMetadata(
                    name=node.name,
                    description=doc.strip().split("\n")[0],
                    parameters=params,
                    path=path,
                )
                self.skills[node.name] = skill

    def get_progressive_disclosure_summary(self) -> str:
        """Returns brief signatures for progressive disclosure in system prompt."""
        if not self.skills:
            return "No custom skills currently installed in ./skills/."

        lines = ["Available Custom Skills (loaded from ./skills/):"]
        for name, meta in self.skills.items():
            args_list = ", ".join(meta.parameters.get("required", []))
            args_str = f"({args_list})" if args_list else ""
            lines.append(f"- {name}{args_str}: {meta.description}")
        return "\n".join(lines)
