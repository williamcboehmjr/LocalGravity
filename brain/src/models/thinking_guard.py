"""
Dynamic Thinking Budget Controller and Stream Interceptor.
"""

import time
from typing import Tuple
from ..protocol.events import ThinkingBudget


class DynamicThinkingGuard:
    @staticmethod
    def get_system_prompt_directive(budget: ThinkingBudget) -> str:
        """
        Injects real-time reasoning constraints into the model system context.
        """
        if budget == ThinkingBudget.OFF:
            return (
                "\n[THINKING POLICY: OFF]\n"
                "Do not produce any <thought> or <think> scratchpad tokens. "
                "Proceed directly to executing tool calls or outputting the final answer.\n"
            )
        elif budget == ThinkingBudget.FAST:
            return (
                "\n[THINKING POLICY: FAST (~250 tokens)]\n"
                "Perform a brief 2-3 bullet point sanity check of your plan inside <thought>...</thought> "
                "before taking action. Keep your thinking concise and fast.\n"
            )
        else:  # DEEP
            return (
                "\n[THINKING POLICY: DEEP (COMPREHENSIVE)]\n"
                "Conduct an exhaustive, rigorous chain-of-thought deliberation inside <thought>...</thought>. "
                "Verify file paths, analyze edge cases, review potential side effects, and plan your execution "
                "steps thoroughly before invoking any tools or writing responses.\n"
            )

    @staticmethod
    def get_token_limit(budget: ThinkingBudget) -> int:
        if budget == ThinkingBudget.OFF:
            return 0
        elif budget == ThinkingBudget.FAST:
            return 256
        else:
            return 2048


class ThoughtStreamParser:
    """
    Parses streaming chunks from Ollama, extracting <thought> / <think> tags
    into dedicated thought events, and clean message tokens for the main stream feed.
    """
    def __init__(self, max_thinking_tokens: int = 256):
        self.max_thinking_tokens = max_thinking_tokens
        self.in_thought_block = False
        self.suppress_thought = False
        self.thought_tokens_count = 0
        self.start_time = time.perf_counter()
        self.buffer = ""

    def process_chunk(self, raw_chunk: str) -> Tuple[str, str, bool]:
        """
        Returns:
            (thought_chunk, content_chunk, is_thought_finished)
        """
        thought_chunk = ""
        content_chunk = ""
        is_thought_finished = False

        self.buffer += raw_chunk

        # Check for start of thought tag
        if not self.in_thought_block and ("<thought>" in self.buffer or "<think>" in self.buffer):
            tag = "<thought>" if "<thought>" in self.buffer else "<think>"
            before, after = self.buffer.split(tag, 1)
            content_chunk += before
            self.buffer = after
            self.in_thought_block = True
            self.suppress_thought = False

        # If inside thought block, look for end tag or token limit
        if self.in_thought_block:
            end_tag = None
            if "</thought>" in self.buffer:
                end_tag = "</thought>"
            elif "</think>" in self.buffer:
                end_tag = "</think>"

            if end_tag:
                thought_part, remaining = self.buffer.split(end_tag, 1)
                if not self.suppress_thought:
                    thought_chunk += thought_part
                    self.thought_tokens_count += len(thought_part.split())
                self.in_thought_block = False
                self.suppress_thought = False
                is_thought_finished = True
                content_chunk += remaining
                self.buffer = ""
            else:
                # Still inside thought tag
                if not self.suppress_thought:
                    thought_chunk += self.buffer
                    self.thought_tokens_count += len(self.buffer.split())
                self.buffer = ""

                # If exceeded budget, enter suppress mode until end_tag is seen
                if self.max_thinking_tokens > 0 and self.thought_tokens_count >= self.max_thinking_tokens:
                    self.suppress_thought = True
                    is_thought_finished = True
        else:
            content_chunk += self.buffer
            self.buffer = ""

        return thought_chunk, content_chunk, is_thought_finished

    def get_elapsed_ms(self) -> int:
        return int((time.perf_counter() - self.start_time) * 1000)
