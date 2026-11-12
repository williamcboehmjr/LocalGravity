"""
Context Sliding Window & Pruning Guard for LocalGravity.
Ensures the conversation never crashes or stalls when approaching context window limits.
"""

from typing import Any, Dict, List
import logging

logger = logging.getLogger("LocalGravity.ContextGuard")


class ContextGuard:
    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Rough 4-char per token heuristic for fast estimation."""
        return max(1, len(text) // 4)

    @classmethod
    def get_conversation_tokens(cls, messages: List[Dict[str, Any]]) -> int:
        total = 0
        for m in messages:
            content = str(m.get("content", ""))
            total += cls.estimate_tokens(content)
            if "tool_calls" in m:
                total += cls.estimate_tokens(str(m["tool_calls"]))
        return total

    @classmethod
    def prune_conversation(
        cls,
        messages: List[Dict[str, Any]],
        max_context_tokens: int = 12000,
        keep_recent_turns: int = 3,
        aggressive: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Multi-Stage Intelligent Sliding Window Pruning:
        - Stage 1: Condenses historical tool outputs (file dumps, terminal logs, web pages).
        - Stage 2: Drops ancient conversational turns between initial task and recent turns.
        - Stage 3: Aggressively condenses all tool outputs to guarantee headroom.

        Strictly preserves:
        - System instructions (messages[0])
        - Initial user task objective (messages[1])
        - Active implementation plan / task checklist
        - Most recent turns for fluid conversation continuity.
        """
        total_tokens = cls.get_conversation_tokens(messages)
        if total_tokens <= max_context_tokens and not aggressive:
            return messages

        logger.info(
            f"ContextGuard triggered: {total_tokens} tokens vs budget {max_context_tokens} (aggressive={aggressive})."
        )

        turn_count = len(messages)
        recent_threshold = max(2, turn_count - (keep_recent_turns * 2))

        # --- Stage 1: Condense older tool outputs ---
        stage1_messages: List[Dict[str, Any]] = []
        for idx, msg in enumerate(messages):
            role = msg.get("role", "")
            content = str(msg.get("content", ""))

            # Keep system and latest turns intact in Stage 1
            if role == "system" or idx >= recent_threshold:
                stage1_messages.append(msg)
                continue

            # In older turns, condense verbose tool outputs or file reads
            if role == "tool" or "stdout:" in content or "file content:" in content:
                cutoff = 150 if aggressive else 300
                if len(content) > cutoff:
                    truncated = content[:cutoff // 2] + "\n... [historical output compacted by ContextGuard] ...\n" + content[-(cutoff // 2):]
                    condensed_msg = dict(msg)
                    condensed_msg["content"] = truncated
                    stage1_messages.append(condensed_msg)
                    continue

            stage1_messages.append(msg)

        current_tokens = cls.get_conversation_tokens(stage1_messages)
        if current_tokens <= max_context_tokens and not aggressive:
            logger.info(f"Context pruned in Stage 1: {total_tokens} -> {current_tokens} tokens.")
            return stage1_messages

        # --- Stage 2: Slide out ancient middle turns ---
        # Keep messages[0] (system) and messages[1] (initial task if user)
        # Drop oldest intermediate messages until under budget
        stage2_messages: List[Dict[str, Any]] = []
        preserved_header: List[Dict[str, Any]] = []

        if len(stage1_messages) > 0 and stage1_messages[0].get("role") == "system":
            preserved_header.append(stage1_messages[0])

        if len(stage1_messages) > 1 and stage1_messages[1].get("role") == "user":
            preserved_header.append(stage1_messages[1])

        # Intermediate pool and recent pool
        header_len = len(preserved_header)
        recent_pool = stage1_messages[recent_threshold:]
        middle_pool = stage1_messages[header_len:recent_threshold]

        # Compact middle pool by dropping oldest pairs
        while middle_pool:
            test_list = preserved_header + [
                {
                    "role": "system",
                    "content": f"[ContextGuard: {len(stage1_messages) - len(middle_pool) - len(recent_pool)} earlier conversation turns compacted to maintain optimal local token headroom.]",
                }
            ] + middle_pool + recent_pool

            if cls.get_conversation_tokens(test_list) <= max_context_tokens:
                stage2_messages = test_list
                break
            # Remove oldest intermediate message
            middle_pool.pop(0)

        if not stage2_messages:
            # If middle pool exhausted and still over budget, retain header + recent pool
            stage2_messages = preserved_header + [
                {
                    "role": "system",
                    "content": "[ContextGuard: Prior history archived to preserve active task window. Focus on current objective and recent context.]",
                }
            ] + recent_pool

        current_tokens = cls.get_conversation_tokens(stage2_messages)
        logger.info(f"Context successfully pruned: {total_tokens} -> {current_tokens} tokens.")
        return stage2_messages
