"""
WebSocket connection and Reverse-RPC coordinator for LocalGravity.
"""

import asyncio
import json
import logging
from typing import Dict, Any, Optional, Callable, Awaitable
from fastapi import WebSocket
from ..protocol.events import BaseMessage

logger = logging.getLogger("LocalGravity.WSManager")


class ConnectionSession:
    def __init__(self, session_id: str, websocket: WebSocket):
        self.session_id = session_id
        self.websocket = websocket
        self.workspace_path: str = ""
        self.platform: str = "windows"
        self.active_rpc_futures: Dict[str, asyncio.Future] = {}
        self.stream_callbacks: Dict[str, Callable[[str, str], Awaitable[None]]] = {}


class WebSocketManager:
    def __init__(self):
        self.sessions: Dict[str, ConnectionSession] = {}

    async def connect(self, session_id: str, websocket: WebSocket) -> ConnectionSession:
        await websocket.accept()
        session = ConnectionSession(session_id, websocket)
        self.sessions[session_id] = session
        logger.info(f"Client connected for session: {session_id}")
        return session

    def disconnect(self, session_id: str, websocket: Optional[WebSocket] = None):
        session = self.sessions.get(session_id)
        if session:
            if websocket is None or session.websocket == websocket:
                del self.sessions[session_id]
                logger.info(f"Client disconnected for session: {session_id}")
            else:
                logger.info(f"Ignoring disconnect for replaced socket on session: {session_id}")

    def get_session(self, session_id: str) -> Optional[ConnectionSession]:
        return self.sessions.get(session_id)

    async def send_message(self, session_id: str, message: BaseMessage):
        session = self.get_session(session_id)
        if not session:
            logger.warning(f"Attempted to send message to inactive session: {session_id}")
            return
        try:
            payload_str = message.model_dump_json()
            await session.websocket.send_text(payload_str)
        except Exception as e:
            logger.error(f"Failed to send WS message to {session_id}: {e}")

    async def broadcast(self, message: BaseMessage):
        payload_str = message.model_dump_json()
        for session_id, session in list(self.sessions.items()):
            try:
                await session.websocket.send_text(payload_str)
            except Exception as e:
                logger.warning(f"Broadcast failed to {session_id}: {e}")

    # Reverse-RPC Execution Handling
    def register_rpc_call(
        self,
        session_id: str,
        request_id: str,
        future: asyncio.Future,
        stream_callback: Optional[Callable[[str, str], Awaitable[None]]] = None,
    ):
        session = self.get_session(session_id)
        if session:
            session.active_rpc_futures[request_id] = future
            if stream_callback:
                session.stream_callbacks[request_id] = stream_callback

    async def handle_exec_stream(self, session_id: str, request_id: str, stream: str, chunk: str):
        session = self.get_session(session_id)
        if session and request_id in session.stream_callbacks:
            callback = session.stream_callbacks[request_id]
            await callback(stream, chunk)

    def handle_exec_result(self, session_id: str, request_id: str, result_data: Dict[str, Any]):
        session = self.get_session(session_id)
        if session:
            future = session.active_rpc_futures.pop(request_id, None)
            session.stream_callbacks.pop(request_id, None)
            if future and not future.done():
                future.set_result(result_data)


_WS_MANAGER = WebSocketManager()


def get_ws_manager() -> WebSocketManager:
    return _WS_MANAGER
