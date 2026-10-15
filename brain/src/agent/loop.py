"""
Autonomous Agent Loop for LocalGravity Central Brain.
"""

import asyncio
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional
from ..protocol.events import (
    ModelTier,
    ThinkingBudget,
    PlatformType,
    ThoughtStreamMessage,
    ThoughtStreamPayload,
    TokenStreamMessage,
    TokenStreamPayload,
    ArtifactSyncMessage,
    ArtifactSyncPayload,
    ToolEventMessage,
    ToolEventPayload,
)
from ..core.websocket_manager import get_ws_manager
from ..models.manager import TieredModelManager
from ..models.ollama_client import OllamaClient
from ..models.thinking_guard import DynamicThinkingGuard, ThoughtStreamParser
from ..models.context_guard import ContextGuard
from .reverse_rpc import EdgeExecutor
from .prompt_builder import PromptBuilder
from .search_engine import get_search_engine
from .tools_schema import STANDARD_TOOLS_SCHEMA

logger = logging.getLogger("LocalGravity.AgentLoop")


class AgentSession:
    def __init__(
        self,
        session_id: str,
        workspace_path: str,
        platform: PlatformType,
        model_manager: TieredModelManager,
        ollama_client: OllamaClient,
        prompt_builder: PromptBuilder,
    ):
        self.session_id = session_id
        self.workspace_path = workspace_path
        self.platform = platform
        self.model_manager = model_manager
        self.ollama_client = ollama_client
        self.prompt_builder = prompt_builder
        self.edge_executor = EdgeExecutor(session_id)
        self.ws_manager = get_ws_manager()
        self.conversation_history: List[Dict[str, Any]] = []

    def _get_active_tools_schema(self) -> List[Dict[str, Any]]:
        tools = list(STANDARD_TOOLS_SCHEMA)
        for name, meta in self.prompt_builder.skills_registry.skills.items():
            if meta.path.name == "skill.py":
                if not any(t["function"]["name"] == name for t in tools):
                    tools.append({
                        "type": "function",
                        "function": {
                            "name": meta.name,
                            "description": meta.description,
                            "parameters": meta.parameters,
                        },
                    })
        return tools

    async def run_turn(
        self,
        user_prompt: str,
        tier: ModelTier,
        thinking_budget: ThinkingBudget,
        images: Optional[List[str]] = None,
    ):
        """
        Executes a complete agentic reasoning and execution cycle.
        """
        try:
            # 1. Switch / lease target model in VRAM
            active_model = await self.model_manager.switch_tier(tier)

            # 2. Build system instructions
            system_prompt = self.prompt_builder.build_system_prompt(
                platform=self.platform,
                workspace_path=self.workspace_path,
                thinking_budget=thinking_budget,
            )

            # 3. Append user message
            user_msg: Dict[str, Any] = {"role": "user", "content": user_prompt}
            if images:
                # Strip data:image/...;base64, prefix for Ollama compatibility
                cleaned_images = []
                for img in images:
                    if isinstance(img, str) and "," in img and img.startswith("data:"):
                        cleaned_images.append(img.split(",", 1)[1])
                    elif isinstance(img, str):
                        cleaned_images.append(img)
                user_msg["images"] = cleaned_images

            if not self.conversation_history:
                self.conversation_history.append({"role": "system", "content": system_prompt})
            else:
                self.conversation_history[0] = {"role": "system", "content": system_prompt}

            self.conversation_history.append(user_msg)

            # 4. Prune context with ContextGuard (reserve 4K tokens for generation headroom)
            self.conversation_history = ContextGuard.prune_conversation(
                self.conversation_history, max_context_tokens=12000
            )

            # 5. Agent Iteration Loop (Max 8 tool turns per user prompt)
            turn_iterations = 0
            max_iterations = 8
            executed_tool_signatures: set = set()

            while turn_iterations < max_iterations:
                turn_iterations += 1
                logger.info(f"Agent turn iteration {turn_iterations} with model {active_model}...")

                # Ensure conversation strictly respects working context budget on every iteration
                self.conversation_history = ContextGuard.prune_conversation(
                    self.conversation_history, max_context_tokens=12000
                )

                token_limit = DynamicThinkingGuard.get_token_limit(thinking_budget)
                thought_parser = ThoughtStreamParser(max_thinking_tokens=token_limit)

                accumulated_response = ""
                full_thought_text = ""
                thought_start_time = time.perf_counter()
                is_thinking_active = False
                hit_length_limit = False

                # Stream generation from Ollama with tools schema
                accumulated_tool_calls: List[Dict[str, Any]] = []

                try:
                    async for chunk in self.ollama_client.chat_stream(
                        model=active_model,
                        messages=self.conversation_history,
                        tools=self._get_active_tools_schema(),
                        options={
                            "num_ctx": 16384,
                            "temperature": 0.3,
                        },
                    ):
                        if chunk.get("done") and chunk.get("done_reason") == "length":
                            hit_length_limit = True

                        msg = chunk.get("message", {})
                        raw_thinking = msg.get("thinking", "")
                        raw_content = msg.get("content", "")
                        raw_tool_calls = msg.get("tool_calls", [])

                        if raw_tool_calls:
                            accumulated_tool_calls.extend(raw_tool_calls)

                        # 1. Native Ollama Thinking Stream
                        if raw_thinking:
                            is_thinking_active = True
                            full_thought_text += raw_thinking
                            elapsed = int((time.perf_counter() - thought_start_time) * 1000)
                            token_count = len(full_thought_text.split())
                            await self.ws_manager.send_message(
                                self.session_id,
                                ThoughtStreamMessage(
                                    payload=ThoughtStreamPayload(
                                        session_id=self.session_id,
                                        chunk=raw_thinking,
                                        elapsed_ms=elapsed,
                                        token_count=token_count,
                                        is_finished=False,
                                    )
                                ),
                            )

                        # 2. Main Content Stream
                        if raw_content:
                            if is_thinking_active:
                                is_thinking_active = False
                                elapsed = int((time.perf_counter() - thought_start_time) * 1000)
                                await self.ws_manager.send_message(
                                    self.session_id,
                                    ThoughtStreamMessage(
                                        payload=ThoughtStreamPayload(
                                            session_id=self.session_id,
                                            chunk="",
                                            elapsed_ms=elapsed,
                                            token_count=len(full_thought_text.split()),
                                            is_finished=True,
                                        )
                                    ),
                                )

                            # Also pass through thought_parser in case model puts <thought> inside content
                            thought_chunk, content_chunk, thought_finished = thought_parser.process_chunk(raw_content)
                            if thought_chunk:
                                full_thought_text += thought_chunk
                                await self.ws_manager.send_message(
                                    self.session_id,
                                    ThoughtStreamMessage(
                                        payload=ThoughtStreamPayload(
                                            session_id=self.session_id,
                                            chunk=thought_chunk,
                                            elapsed_ms=thought_parser.get_elapsed_ms(),
                                            token_count=thought_parser.thought_tokens_count,
                                            is_finished=thought_finished,
                                        )
                                    ),
                                )

                            if content_chunk:
                                accumulated_response += content_chunk
                                await self.ws_manager.send_message(
                                    self.session_id,
                                    TokenStreamMessage(
                                        payload=TokenStreamPayload(
                                            session_id=self.session_id,
                                            chunk=content_chunk,
                                            is_finished=False,
                                        )
                                    ),
                                )
                except asyncio.CancelledError:
                    logger.info(f"Agent turn stream cancelled for session {self.session_id}")
                    raise
                except Exception as stream_err:
                    logger.error(f"Error during Ollama generation: {stream_err}")
                    err_msg = f"\n\n**Local Model Error:** {str(stream_err)}"
                    accumulated_response += err_msg
                    await self.ws_manager.send_message(
                        self.session_id,
                        TokenStreamMessage(
                            payload=TokenStreamPayload(
                                session_id=self.session_id,
                                chunk=err_msg,
                                is_finished=True,
                            )
                        ),
                    )
                    break

                # Signal completion of thought if still open
                if is_thinking_active:
                    elapsed = int((time.perf_counter() - thought_start_time) * 1000)
                    await self.ws_manager.send_message(
                        self.session_id,
                        ThoughtStreamMessage(
                            payload=ThoughtStreamPayload(
                                session_id=self.session_id,
                                chunk="",
                                elapsed_ms=elapsed,
                                token_count=len(full_thought_text.split()),
                                is_finished=True,
                            )
                        ),
                    )

                # Record assistant turn in history
                assistant_record: Dict[str, Any] = {"role": "assistant", "content": accumulated_response}
                if accumulated_tool_calls:
                    assistant_record["tool_calls"] = accumulated_tool_calls
                self.conversation_history.append(assistant_record)

                # 6. Check if Context Limit was Hit mid-generation (Auto-Continuation with Trimmed Context)
                if hit_length_limit and turn_iterations < max_iterations:
                    logger.warning(
                        f"Session {self.session_id}: Context length limit encountered (done_reason=length). "
                        "Compacting conversation context and auto-continuing generation seamlessly..."
                    )
                    self.conversation_history = ContextGuard.prune_conversation(
                        self.conversation_history,
                        max_context_tokens=8000,
                        aggressive=True,
                    )
                    self.conversation_history.append({
                        "role": "user",
                        "content": "Please continue directly from your last unfinished word/sentence and complete your answer without repeating earlier text.",
                    })
                    continue

                # 7. Check for Tool Invocations (Structured or Regex Fallback)
                tool_calls_to_run: List[Dict[str, Any]] = []
                if accumulated_tool_calls:
                    for tc in accumulated_tool_calls:
                        fn = tc.get("function", {})
                        t_name = fn.get("name")
                        t_args = fn.get("arguments", {})
                        if isinstance(t_args, str):
                            try:
                                t_args = json.loads(t_args)
                            except Exception:
                                t_args = {}
                        if t_name:
                            tool_calls_to_run.append({"name": t_name, "args": t_args})
                else:
                    regex_tool = self._detect_tool_call(accumulated_response)
                    if regex_tool:
                        tool_calls_to_run.append(regex_tool)

                if not tool_calls_to_run:
                    # If the model executed tools but produced no final text answer, prompt for completion
                    if not accumulated_response.strip() and turn_iterations < max_iterations:
                        logger.info("Model executed tools but produced no final text answer. Prompting for synthesis...")
                        self.conversation_history.append({
                            "role": "user",
                            "content": "Now present your complete, detailed answer and solutions based on the tool results above. Do not output empty content.",
                        })
                        continue

                    # No more tools called; final answer reached
                    logger.info("No tool call detected in response. Turn concluded.")
                    await self.ws_manager.send_message(
                        self.session_id,
                        TokenStreamMessage(
                            payload=TokenStreamPayload(
                                session_id=self.session_id,
                                chunk="",
                                is_finished=True,
                            )
                        ),
                    )
                    break

                # Execute tool invocations
                for tool_call in tool_calls_to_run:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    logger.info(f"Executing tool {tool_name} with args: {tool_args}")

                    # Anti-Spin Guard: Detect repeated tool execution with identical arguments
                    try:
                        tool_sig = f"{tool_name}:{json.dumps(tool_args, sort_keys=True)}"
                    except Exception:
                        tool_sig = f"{tool_name}:{str(tool_args)}"

                    if tool_sig in executed_tool_signatures:
                        logger.warning(f"Detected repeated tool call: {tool_sig}. Skipping and advising model.")
                        content_for_llm = (
                            f"ADVISORY: You already executed {tool_name} with args {tool_args} earlier in this turn. "
                            "Do not execute identical commands repeatedly. Proceed immediately to take action or present your final answer."
                        )
                    else:
                        executed_tool_signatures.add(tool_sig)
                        tool_result = await self._execute_tool(tool_name, tool_args)

                        # Feed tool execution result back into conversation history
                        content_for_llm = (
                            tool_result.get("markdown")
                            if isinstance(tool_result, dict) and "markdown" in tool_result
                            else json.dumps(tool_result)
                        )

                    self.conversation_history.append({
                        "role": "tool",
                        "name": tool_name,
                        "content": content_for_llm,
                    })
        except asyncio.CancelledError:
            logger.info(f"Agent session {self.session_id} turn task cancelled.")
            await self.ws_manager.send_message(
                self.session_id,
                TokenStreamMessage(
                    payload=TokenStreamPayload(
                        session_id=self.session_id,
                        chunk="",
                        is_finished=True,
                    )
                ),
            )
            raise

    def _detect_tool_call(self, text: str) -> Optional[Dict[str, Any]]:
        """Parses tool calls formatted as function call, XML-style tag, or JSON blocks."""
        # 1. Check for parallel_web_search (tag or function syntax with multiple queries)
        psearch_match = re.search(r'(?:<|\b)parallel_web_search(?:[\s\(]+(?:queries\s*=\s*)?|\s+queries\s*=\s*)\[([\s\S]*?)\]', text)
        if psearch_match:
            raw_list = psearch_match.group(1)
            queries = [q.strip("\"' \t\n\r[]") for q in re.findall(r'["\']([^"\']+)["\']', raw_list)]
            queries = [q for q in queries if len(q) > 1]
            if queries:
                return {"name": "parallel_web_search", "args": {"queries": queries}}

        # 2. Check for single web search
        s_match = re.search(r'(?:<|\b)(?:search_web|parallel_web_search)[\s\(]+(?:query\s*=\s*|queries\s*=\s*)?["\']([^"\']+)["\']', text)
        if s_match:
            return {"name": "parallel_web_search", "args": {"queries": [s_match.group(1)]}}

        # 3. Check for fetch_web_pages (tag or function syntax with multiple URLs)
        fetch_multi = re.search(r'(?:<|\b)fetch_web_pages(?:[\s\(]+(?:urls\s*=\s*)?|\s+urls\s*=\s*)\[([\s\S]*?)\]', text)
        if fetch_multi:
            raw_urls = fetch_multi.group(1)
            urls = [u.strip("\"' \t\n\r[]") for u in re.findall(r'["\']([^"\']+)["\']', raw_urls)]
            urls = [u for u in urls if u.startswith("http")]
            if urls:
                return {"name": "fetch_web_pages", "args": {"urls": urls}}

        # 4. Check for single fetch_page
        fetch_single = re.search(r'(?:<|\b)(?:fetch_page|fetch_web_pages)[\s\(]+(?:url\s*=\s*|urls\s*=\s*)?["\']([^"\']+)["\']', text)
        if fetch_single:
            return {"name": "fetch_web_pages", "args": {"urls": [fetch_single.group(1)]}}

        # 5. Check for run_command
        cmd_match = re.search(r'(?:<|\b)run_command[\s\(]+(?:command\s*=\s*)?["\']([^"\']+)["\']', text)
        if cmd_match:
            return {"name": "run_command", "args": {"command": cmd_match.group(1)}}

        # 6. Check for read_file
        read_match = re.search(r'(?:<|\b)read_file[\s\(]+(?:path\s*=\s*)?["\']([^"\']+)["\']', text)
        if read_match:
            return {"name": "read_file", "args": {"path": read_match.group(1)}}

        # 7. Check for write_file
        write_match = re.search(r'write_file\s*\(\s*["\']([^"\']+)["\']\s*,\s*["\']([\s\S]+?)["\']\s*\)', text)
        if write_match:
            return {"name": "write_file", "args": {"path": write_match.group(1), "content": write_match.group(2)}}

        # 8. Check for update_task_list
        task_match = re.search(r'update_task_list\s*\(\s*["\']([\s\S]+?)["\']\s*\)', text)
        if task_match:
            return {"name": "update_task_list", "args": {"content": task_match.group(1)}}

        # 9. Fallback JSON tool call parser
        json_match = re.search(r'\{[\s\r\n]*"(?:name|tool)"\s*:\s*"([^"]+)"[\s\S]*?\}', text)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                name = parsed.get("name") or parsed.get("tool")
                args = parsed.get("args") or parsed.get("arguments") or parsed.get("parameters") or {}
                if name:
                    return {"name": name, "args": args}
            except Exception:
                pass

        return None

    async def _execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches action via Central Brain local execution or Reverse-RPC to Edge Client."""
        # A. PARALLEL WEB SEARCH (Central Brain local, 0-API, sub-second)
        if name in ("parallel_web_search", "search_web"):
            queries = args.get("queries") or [args.get("query", "")]
            if isinstance(queries, str):
                queries = [queries]
            queries = [q for q in queries if q.strip()]

            display_cmd = f"parallel_web_search({queries})"
            logger.info(f"Executing web search fan-out for: {queries}")

            # Notify UI
            await self.ws_manager.send_message(
                self.session_id,
                ToolEventMessage(
                    payload=ToolEventPayload(
                        session_id=self.session_id,
                        tool_name="parallel_web_search",
                        command=display_cmd,
                        status="running",
                    )
                ),
            )

            engine = get_search_engine()
            results = await engine.search_parallel(queries)
            formatted = engine.format_search_markdown(results)

            # Update UI with completion
            await self.ws_manager.send_message(
                self.session_id,
                ToolEventMessage(
                    payload=ToolEventPayload(
                        session_id=self.session_id,
                        tool_name="parallel_web_search",
                        command=display_cmd,
                        output=formatted[:1500],
                        status="success",
                    )
                ),
            )

            return {
                "status": "success",
                "count": len(results),
                "queries": queries,
                "markdown": formatted,
            }

        # B. CONCURRENT WEB PAGE FETCH (Central Brain local, HTML-to-Markdown)
        elif name in ("fetch_web_pages", "fetch_page"):
            urls = args.get("urls") or [args.get("url", "")]
            if isinstance(urls, str):
                urls = [urls]
            urls = [u for u in urls if u.strip()]

            display_cmd = f"fetch_web_pages({len(urls)} URLs)"
            logger.info(f"Executing concurrent web page fetch for: {urls}")

            await self.ws_manager.send_message(
                self.session_id,
                ToolEventMessage(
                    payload=ToolEventPayload(
                        session_id=self.session_id,
                        tool_name="fetch_web_pages",
                        command=display_cmd,
                        status="running",
                    )
                ),
            )

            engine = get_search_engine()
            results = await engine.fetch_pages_parallel(urls)
            formatted = engine.format_pages_markdown(results)

            await self.ws_manager.send_message(
                self.session_id,
                ToolEventMessage(
                    payload=ToolEventPayload(
                        session_id=self.session_id,
                        tool_name="fetch_web_pages",
                        command=display_cmd,
                        output=formatted[:1500],
                        status="success",
                    )
                ),
            )

            return {
                "status": "success",
                "count": len(results),
                "urls": urls,
                "markdown": formatted,
            }

        # C. REVERSE-RPC: SHELL COMMAND
        elif name == "run_command":
            command = args.get("command", "")
            await self.ws_manager.send_message(
                self.session_id,
                ToolEventMessage(
                    payload=ToolEventPayload(
                        session_id=self.session_id,
                        tool_name="run_command",
                        command=command,
                        status="running",
                    )
                ),
            )
            res = await self.edge_executor.execute_command(command, cwd=self.workspace_path)
            status = "success" if res.get("exit_code", 0) == 0 else "error"
            output = res.get("stdout") or res.get("stderr") or res.get("error") or ""

            await self.ws_manager.send_message(
                self.session_id,
                ToolEventMessage(
                    payload=ToolEventPayload(
                        session_id=self.session_id,
                        tool_name="run_command",
                        command=command,
                        output=str(output)[:1500],
                        status=status,
                    )
                ),
            )
            return res

        # D. REVERSE-RPC: READ FILE
        elif name == "read_file":
            path = args.get("path", "")
            return await self.edge_executor.read_file(path)

        # E. REVERSE-RPC: WRITE FILE
        elif name == "write_file":
            path = args.get("path", "")
            content = args.get("content", "")
            return await self.edge_executor.write_file(path, content)

        # F. ARTIFACT SYNC: UPDATE TASK LIST
        elif name == "update_task_list":
            content = args.get("content", "")
            await self.ws_manager.send_message(
                self.session_id,
                ArtifactSyncMessage(
                    payload=ArtifactSyncPayload(
                        session_id=self.session_id,
                        artifact_name="task.md",
                        content=content,
                        version=1,
                    )
                ),
            )
            return {"status": "success", "message": "task.md updated and synced"}

        # G. DYNAMIC SKILL EXECUTION FROM skills/<folder>/skill.py
        skill_meta = self.prompt_builder.skills_registry.skills.get(name)
        if skill_meta and skill_meta.path.name == "skill.py":
            try:
                import importlib.util
                import inspect
                display_cmd = f"{name}({args})"
                logger.info(f"Executing dynamic skill: {display_cmd}")
                await self.ws_manager.send_message(
                    self.session_id,
                    ToolEventMessage(
                        payload=ToolEventPayload(
                            session_id=self.session_id,
                            tool_name=name,
                            command=display_cmd,
                            status="running",
                        )
                    ),
                )
                spec = importlib.util.spec_from_file_location(f"dynamic_skill_{name}", skill_meta.path)
                if spec and spec.loader:
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    fn = getattr(mod, name, None)
                    if callable(fn):
                        if inspect.iscoroutinefunction(fn):
                            result = await fn(**args)
                        else:
                            result = await asyncio.to_thread(fn, **args)

                        formatted_out = json.dumps(result, indent=2) if isinstance(result, (dict, list)) else str(result)
                        await self.ws_manager.send_message(
                            self.session_id,
                            ToolEventMessage(
                                payload=ToolEventPayload(
                                    session_id=self.session_id,
                                    tool_name=name,
                                    command=display_cmd,
                                    output=formatted_out[:1500],
                                    status="success",
                                )
                            ),
                        )
                        return result if isinstance(result, dict) else {"result": result}
            except Exception as e:
                logger.error(f"Dynamic skill execution error for {name}: {e}")
                err_str = f"Error executing dynamic skill {name}: {e}"
                await self.ws_manager.send_message(
                    self.session_id,
                    ToolEventMessage(
                        payload=ToolEventPayload(
                            session_id=self.session_id,
                            tool_name=name,
                            command=f"{name}({args})",
                            output=err_str,
                            status="error",
                        )
                    ),
                )
                return {"error": err_str}

        return {"error": f"Unknown tool: {name}"}
