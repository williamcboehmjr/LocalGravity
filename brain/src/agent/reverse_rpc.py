"""
Reverse-RPC Edge Dispatcher with Local Central Brain Fallback:
If an edge client with an active reverse-RPC handler is connected, dispatches to it;
otherwise, executes locally directly on the Central Brain host machine (PowerShell on Windows).
"""

import asyncio
import logging
import os
import subprocess
import uuid
from typing import Any, Callable, Dict, Optional, Awaitable
from ..core.websocket_manager import get_ws_manager
from ..protocol.events import ExecRequestMessage, ExecRequestPayload

logger = logging.getLogger("LocalGravity.ReverseRPC")


class EdgeExecutor:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.ws_manager = get_ws_manager()

    async def execute_command(
        self,
        command: str,
        cwd: Optional[str] = None,
        timeout_ms: int = 60000,
        stream_callback: Optional[Callable[[str, str], Awaitable[None]]] = None,
    ) -> Dict[str, Any]:
        """
        Executes a shell command.
        1. Checks if client supports remote edge execution.
        2. Falls back to executing locally on the host machine using PowerShell.
        """
        session = self.ws_manager.get_session(self.session_id)
        # If client explicitly registered edge executor capability (e.g. Tauri or Desktop agent)
        if session and getattr(session, "supports_edge_exec", False):
            request_id = str(uuid.uuid4())
            loop = asyncio.get_running_loop()
            future: asyncio.Future = loop.create_future()

            self.ws_manager.register_rpc_call(
                self.session_id, request_id, future, stream_callback
            )

            msg = ExecRequestMessage(
                id=request_id,
                payload=ExecRequestPayload(
                    action="shell",
                    command=command,
                    cwd=cwd,
                    timeout_ms=timeout_ms,
                ),
            )
            await self.ws_manager.send_message(self.session_id, msg)

            try:
                result = await asyncio.wait_for(future, timeout=timeout_ms / 1000.0)
                return result
            except asyncio.TimeoutError:
                logger.error(f"Command execution timed out after {timeout_ms}ms: {command}")
                return {"exit_code": -1, "error": f"Execution timed out after {timeout_ms}ms"}

        # Host Direct Execution Fallback (Instant, native, full access)
        logger.info(f"Executing command directly on host: {command} (cwd={cwd})")
        return await self._execute_locally(command, cwd=cwd, timeout_ms=timeout_ms)

    async def _execute_locally(
        self, command: str, cwd: Optional[str] = None, timeout_ms: int = 60000
    ) -> Dict[str, Any]:
        actual_cwd = cwd if cwd and os.path.exists(cwd) else os.getcwd()
        try:
            if os.name == "nt":
                # Run via powershell.exe -NoProfile
                proc = await asyncio.create_subprocess_exec(
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    command,
                    cwd=actual_cwd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            else:
                proc = await asyncio.create_subprocess_shell(
                    command,
                    cwd=actual_cwd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_ms / 1000.0
            )

            stdout_str = stdout_bytes.decode("utf-8", errors="replace")
            stderr_str = stderr_bytes.decode("utf-8", errors="replace")

            return {
                "exit_code": proc.returncode,
                "stdout": stdout_str,
                "stderr": stderr_str,
            }
        except asyncio.TimeoutError:
            logger.error(f"Local command execution timed out: {command}")
            return {"exit_code": -1, "error": f"Execution timed out after {timeout_ms}ms"}
        except Exception as e:
            logger.error(f"Local command execution failed: {e}")
            return {"exit_code": -1, "error": str(e)}

    async def read_file(self, path: str) -> Dict[str, Any]:
        """Reads file directly from host filesystem."""
        try:
            resolved_path = os.path.abspath(path)
            if not os.path.exists(resolved_path):
                return {"error": f"File not found: {resolved_path}"}
            with open(resolved_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return {"status": "success", "path": resolved_path, "content": content}
        except Exception as e:
            return {"error": f"Failed to read file {path}: {str(e)}"}

    async def write_file(self, path: str, content: str) -> Dict[str, Any]:
        """Writes file directly to host filesystem."""
        try:
            resolved_path = os.path.abspath(path)
            os.makedirs(os.path.dirname(resolved_path), exist_ok=True)
            with open(resolved_path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"status": "success", "path": resolved_path, "bytes_written": len(content)}
        except Exception as e:
            return {"error": f"Failed to write file {path}: {str(e)}"}
