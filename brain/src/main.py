"""
LocalGravity Central Brain - FastAPI Application Entrypoint.
"""

import asyncio
from contextlib import asynccontextmanager
import logging
from pathlib import Path
import socket
from typing import Dict, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import psutil

from .core.config import load_config
from .core.telemetry import get_telemetry_snapshot
from .core.websocket_manager import get_ws_manager
from .models.ollama_client import OllamaClient
from .models.manager import TieredModelManager
from .skills.loader import SkillsRegistry
from .agent.prompt_builder import PromptBuilder
from .agent.loop import AgentSession
from .protocol.events import (
    ModelTier,
    ThinkingBudget,
    PlatformType,
    TelemetryMessage,
    TelemetryPayload,
    ModelStateMessage,
    ModelStatePayload,
    ArtifactSyncMessage,
    ArtifactSyncPayload,
    TokenStreamMessage,
    TokenStreamPayload,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("LocalGravity.Brain")

config = load_config()
ollama_client = OllamaClient(base_url=config.ollama.base_url, timeout=config.ollama.timeout_seconds)
model_manager = TieredModelManager(
    ollama_client=ollama_client,
    tier_mappings=config.models.tiers,
    keep_alive_lease=config.ollama.keep_alive_lease,
    ramdisk_path=config.ollama.ramdisk_path,
)
skills_registry = SkillsRegistry(skills_dir=config.skills.directory)
prompt_builder = PromptBuilder(skills_registry)
ws_manager = get_ws_manager()

active_agent_sessions: Dict[str, AgentSession] = {}
active_turn_tasks: Dict[str, asyncio.Task] = {}


def cancel_active_turn(session_id: str):
    task = active_turn_tasks.pop(session_id, None)
    if task and not task.done():
        logger.info(f"Cancelling active turn task for session {session_id}")
        task.cancel()


def get_lan_ips() -> List[str]:
    """Discovers non-loopback local network IPv4 addresses."""
    ips = []
    try:
        for iface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and not addr.address.startswith("127.") and not addr.address.startswith("169.254."):
                    ips.append(addr.address)
    except Exception:
        pass
    # Sort to prioritize standard private ranges (192.168.x.x, 10.x.x.x)
    ips.sort(key=lambda ip: (not ip.startswith("192.168."), not ip.startswith("10."), ip))
    return ips or ["127.0.0.1"]


async def telemetry_broadcaster_task():
    """Broadcasts system telemetry to connected UI clients periodically."""
    while True:
        try:
            await asyncio.sleep(config.telemetry.poll_interval_seconds)
            if ws_manager.sessions:
                snap = get_telemetry_snapshot()
                msg = TelemetryMessage(
                    payload=TelemetryPayload(
                        vram_used_gb=snap["vram_used_gb"],
                        vram_total_gb=snap["vram_total_gb"],
                        vram_percent=snap["vram_percent"],
                        host_ram_used_gb=snap["host_ram_used_gb"],
                        host_ram_total_gb=snap["host_ram_total_gb"],
                        host_ram_percent=snap["host_ram_percent"],
                        gpu_utilization_percent=snap["gpu_utilization_percent"],
                        cpu_utilization_percent=snap["cpu_utilization_percent"],
                        active_tier=model_manager.active_tier,
                        active_model=model_manager.active_model,
                    )
                )
                await ws_manager.broadcast(msg)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Telemetry broadcast tick error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("LocalGravity Central Brain starting up...")
    # 1. Startup Pre-warm Routine into host DDR4 RAM
    asyncio.create_task(model_manager.prewarm_all_tiers())
    # 2. Start telemetry broadcast
    telemetry_task = asyncio.create_task(telemetry_broadcaster_task())

    yield

    telemetry_task.cancel()
    await ollama_client.close()
    logger.info("LocalGravity Central Brain shutdown complete.")


app = FastAPI(
    title="LocalGravity Brain",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.server.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "LocalGravity Brain",
        "active_tier": model_manager.active_tier.value,
        "active_model": model_manager.active_model,
    }


@app.get("/api/remote/info")
async def get_remote_info():
    """Returns local network address for mobile remote access."""
    lan_ips = get_lan_ips()
    primary_ip = lan_ips[0] if lan_ips else "127.0.0.1"
    port = config.server.port
    return {
        "primary_ip": primary_ip,
        "all_ips": lan_ips,
        "port": port,
        "remote_url": f"http://{primary_ip}:{port}",
        "ws_url": f"ws://{primary_ip}:{port}",
    }


@app.get("/api/telemetry")
async def get_telemetry():
    snap = get_telemetry_snapshot()
    snap["active_tier"] = model_manager.active_tier.value
    snap["active_model"] = model_manager.active_model
    return snap


@app.get("/api/models")
async def list_models():
    models = await ollama_client.list_models()
    return {
        "configured_tiers": model_manager.tier_mappings,
        "active_tier": model_manager.active_tier.value,
        "active_model": model_manager.active_model,
        "installed_models": models,
    }


class TierSwitchRequest(BaseModel):
    tier: ModelTier


@app.post("/api/tier/switch")
async def switch_tier(req: TierSwitchRequest):
    new_model = await model_manager.switch_tier(req.tier)
    return {"status": "success", "tier": req.tier.value, "model": new_model}


@app.websocket("/ws/agent/{session_id}")
async def agent_websocket(websocket: WebSocket, session_id: str):
    session = await ws_manager.connect(session_id, websocket)

    # Broadcast initial model state to client
    telem = get_telemetry_snapshot()
    await ws_manager.send_message(
        session_id,
        ModelStateMessage(
            payload=ModelStatePayload(
                status="ready",
                active_tier=model_manager.active_tier,
                active_model=model_manager.active_model,
                status_text=f"Ready ({model_manager.active_model})",
                vram_used_gb=telem["vram_used_gb"],
                vram_total_gb=telem["vram_total_gb"],
                host_ram_used_gb=telem["host_ram_used_gb"],
                host_ram_total_gb=telem["host_ram_total_gb"],
            )
        ),
    )

    try:
        while True:
            raw_text = await websocket.receive_text()
            import json
            try:
                data = json.loads(raw_text)
            except Exception:
                continue

            msg_type = data.get("type")
            payload = data.get("payload", {})

            # 1. SESSION_INIT
            if msg_type == "SESSION_INIT":
                session.workspace_path = payload.get("workspace_path", "")
                session.platform = payload.get("platform", "windows")
                logger.info(f"Initialized session {session_id} on {session.platform} in {session.workspace_path}")

                active_agent_sessions[session_id] = AgentSession(
                    session_id=session_id,
                    workspace_path=session.workspace_path,
                    platform=PlatformType(session.platform) if session.platform in ["windows", "macos", "android"] else PlatformType.WINDOWS,
                    model_manager=model_manager,
                    ollama_client=ollama_client,
                    prompt_builder=prompt_builder,
                )

            # 2. TIER_SWITCH
            elif msg_type == "TIER_SWITCH":
                cancel_active_turn(session_id)
                raw_tier = payload.get("new_tier", "low")
                tier = ModelTier(raw_tier)

                async def notify_ui(state_payload: ModelStatePayload):
                    await ws_manager.send_message(
                        session_id,
                        ModelStateMessage(payload=state_payload),
                    )

                await model_manager.switch_tier(tier, status_notifier=notify_ui)

            # 3. PROMPT_SUBMIT
            elif msg_type == "PROMPT_SUBMIT":
                cancel_active_turn(session_id)
                await asyncio.sleep(0.05)

                agent = active_agent_sessions.get(session_id)
                if not agent:
                    agent = AgentSession(
                        session_id=session_id,
                        workspace_path=session.workspace_path or "./",
                        platform=PlatformType.WINDOWS,
                        model_manager=model_manager,
                        ollama_client=ollama_client,
                        prompt_builder=prompt_builder,
                    )
                    active_agent_sessions[session_id] = agent

                prompt_text = payload.get("prompt", "")
                tier = ModelTier(payload.get("tier", "low"))
                thinking_budget = ThinkingBudget(payload.get("thinking_budget", "fast"))
                images = payload.get("images")

                turn_task = asyncio.create_task(
                    agent.run_turn(
                        user_prompt=prompt_text,
                        tier=tier,
                        thinking_budget=thinking_budget,
                        images=images,
                    )
                )
                active_turn_tasks[session_id] = turn_task

            # 4. STOP_GENERATION
            elif msg_type == "STOP_GENERATION":
                cancel_active_turn(session_id)
                await ws_manager.send_message(
                    session_id,
                    TokenStreamMessage(
                        payload=TokenStreamPayload(
                            session_id=session_id,
                            chunk="",
                            is_finished=True,
                        )
                    ),
                )

            # 5. EXEC_STREAM
            elif msg_type == "EXEC_STREAM":
                req_id = payload.get("request_id", "")
                stream = payload.get("stream", "stdout")
                chunk = payload.get("chunk", "")
                await ws_manager.handle_exec_stream(session_id, req_id, stream, chunk)

            # 6. EXEC_RESULT
            elif msg_type == "EXEC_RESULT":
                req_id = payload.get("request_id", "")
                ws_manager.handle_exec_result(session_id, req_id, payload)

            # 7. ARTIFACT_SYNC
            elif msg_type == "ARTIFACT_SYNC":
                artifact_name = payload.get("artifact_name", "")
                content = payload.get("content", "")
                logger.info(f"Received ARTIFACT_SYNC for {artifact_name}")
                await ws_manager.broadcast(ArtifactSyncMessage(payload=ArtifactSyncPayload(**payload)))

    except WebSocketDisconnect:
        ws_manager.disconnect(session_id, websocket)
    except Exception as e:
        logger.error(f"WebSocket error in session {session_id}: {e}")
        ws_manager.disconnect(session_id, websocket)


# Mount compiled frontend dist for instant browser / mobile remote access
client_dist = Path(__file__).resolve().parent.parent.parent / "client" / "dist"
if client_dist.exists():
    app.mount("/", StaticFiles(directory=str(client_dist), html=True), name="static")
    logger.info(f"Mounted static client bundle from {client_dist}")
