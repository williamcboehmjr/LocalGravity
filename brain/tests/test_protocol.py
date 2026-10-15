"""
Unit tests for LocalGravity Protocol and Schemas.
"""

import pytest
from src.protocol.events import (
    ModelTier,
    ThinkingBudget,
    PlatformType,
    SessionInitMessage,
    SessionInitPayload,
    PromptSubmitMessage,
    PromptSubmitPayload,
    ExecRequestMessage,
    ExecRequestPayload,
    TelemetryMessage,
    TelemetryPayload,
)
from src.models.thinking_guard import DynamicThinkingGuard, ThoughtStreamParser
from src.models.context_guard import ContextGuard


def test_protocol_schemas():
    init_msg = SessionInitMessage(
        payload=SessionInitPayload(
            workspace_path="C:/test/workspace",
            platform=PlatformType.WINDOWS,
            client_version="0.1.0",
            hostname="workstation-pc",
        )
    )
    assert init_msg.type == "SESSION_INIT"
    assert init_msg.payload.platform == PlatformType.WINDOWS

    prompt_msg = PromptSubmitMessage(
        payload=PromptSubmitPayload(
            session_id="test-session",
            prompt="Refactor the auth handler",
            tier=ModelTier.HIGH,
            thinking_budget=ThinkingBudget.DEEP,
        )
    )
    assert prompt_msg.payload.tier == ModelTier.HIGH
    assert prompt_msg.payload.thinking_budget == ThinkingBudget.DEEP


def test_thinking_guard_directives():
    off_directive = DynamicThinkingGuard.get_system_prompt_directive(ThinkingBudget.OFF)
    assert "OFF" in off_directive
    assert DynamicThinkingGuard.get_token_limit(ThinkingBudget.OFF) == 0

    fast_directive = DynamicThinkingGuard.get_system_prompt_directive(ThinkingBudget.FAST)
    assert "FAST" in fast_directive
    assert DynamicThinkingGuard.get_token_limit(ThinkingBudget.FAST) == 256

    deep_directive = DynamicThinkingGuard.get_system_prompt_directive(ThinkingBudget.DEEP)
    assert "DEEP" in deep_directive
    assert DynamicThinkingGuard.get_token_limit(ThinkingBudget.DEEP) == 2048


def test_thought_stream_parser():
    parser = ThoughtStreamParser(max_thinking_tokens=100)
    chunk1 = "Hello <thought>Let's inspect the files"
    t1, c1, finished1 = parser.process_chunk(chunk1)
    assert c1 == "Hello "
    assert t1 == "Let's inspect the files"
    assert not finished1

    chunk2 = " and check types</thought>Now here is the solution."
    t2, c2, finished2 = parser.process_chunk(chunk2)
    assert "and check types" in t2
    assert "Now here is the solution." in c2
    assert finished2


def test_context_guard_pruning():
    messages = [
        {"role": "system", "content": "You are Antigravity."},
        {"role": "user", "content": "Initial prompt"},
        {"role": "assistant", "content": "Running command"},
        {"role": "tool", "content": "stdout: " + ("x" * 2000)},  # Long output
        {"role": "user", "content": "Next step"},
        {"role": "assistant", "content": "Final response"},
    ]
    # Prune with a small max token limit
    pruned = ContextGuard.prune_conversation(messages, max_context_tokens=100, keep_recent_turns=1)
    # Ensure system and user are retained and tool output was truncated
    assert len(pruned) == len(messages)
    assert "pruned by ContextGuard" in pruned[3]["content"]
