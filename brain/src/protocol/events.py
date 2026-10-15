"""
Typed Pydantic v2 Event Schemas for LocalGravity Central Brain <-> Edge Executor communication.
"""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field
import uuid


class ModelTier(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ThinkingBudget(str, Enum):
    OFF = "off"
    FAST = "fast"       # ~256 tokens max
    DEEP = "deep"       # ~2048 tokens max


class PlatformType(str, Enum):
    MACOS = "macos"
    WINDOWS = "windows"
    ANDROID = "android"


class BaseMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str


# 1. SESSION_INIT
class SessionInitPayload(BaseModel):
    workspace_path: str
    platform: PlatformType
    client_version: str = "0.1.0"
    hostname: str = "localhost"


class SessionInitMessage(BaseMessage):
    type: Literal["SESSION_INIT"] = "SESSION_INIT"
    payload: SessionInitPayload


# 2. PROMPT_SUBMIT
class PromptSubmitPayload(BaseModel):
    session_id: str
    prompt: str
    tier: ModelTier = ModelTier.LOW
    thinking_budget: ThinkingBudget = ThinkingBudget.FAST
    images: Optional[List[str]] = Field(default=None, description="Base64 encoded images")


class PromptSubmitMessage(BaseMessage):
    type: Literal["PROMPT_SUBMIT"] = "PROMPT_SUBMIT"
    payload: PromptSubmitPayload


# 3. TIER_SWITCH
class TierSwitchPayload(BaseModel):
    session_id: str
    new_tier: ModelTier


class TierSwitchMessage(BaseMessage):
    type: Literal["TIER_SWITCH"] = "TIER_SWITCH"
    payload: TierSwitchPayload


# 4. MODEL_STATE
class ModelStatePayload(BaseModel):
    status: Literal["idle", "swapping", "ready", "generating", "error"]
    active_tier: ModelTier
    active_model: str
    status_text: Optional[str] = None
    vram_used_gb: float = 0.0
    vram_total_gb: float = 16.0
    host_ram_used_gb: float = 0.0
    host_ram_total_gb: float = 128.0


class ModelStateMessage(BaseMessage):
    type: Literal["MODEL_STATE"] = "MODEL_STATE"
    payload: ModelStatePayload


# 5. THOUGHT_STREAM
class ThoughtStreamPayload(BaseModel):
    session_id: str
    chunk: str
    elapsed_ms: int = 0
    token_count: int = 0
    is_finished: bool = False


class ThoughtStreamMessage(BaseMessage):
    type: Literal["THOUGHT_STREAM"] = "THOUGHT_STREAM"
    payload: ThoughtStreamPayload


# 6. TOKEN_STREAM
class TokenStreamPayload(BaseModel):
    session_id: str
    chunk: str
    is_finished: bool = False


class TokenStreamMessage(BaseMessage):
    type: Literal["TOKEN_STREAM"] = "TOKEN_STREAM"
    payload: TokenStreamPayload


# 7. EXEC_REQUEST (Brain -> Edge Client Reverse-RPC)
class ExecRequestPayload(BaseModel):
    action: Literal["shell", "read_file", "write_file", "delete_file", "list_dir"]
    command: Optional[str] = None
    path: Optional[str] = None
    content: Optional[str] = None
    cwd: Optional[str] = None
    timeout_ms: Optional[int] = 60000


class ExecRequestMessage(BaseMessage):
    type: Literal["EXEC_REQUEST"] = "EXEC_REQUEST"
    payload: ExecRequestPayload


# 8. EXEC_STREAM (Edge Client -> Brain stdout/stderr chunks)
class ExecStreamPayload(BaseModel):
    request_id: str
    stream: Literal["stdout", "stderr"]
    chunk: str


class ExecStreamMessage(BaseMessage):
    type: Literal["EXEC_STREAM"] = "EXEC_STREAM"
    payload: ExecStreamPayload


# 9. EXEC_RESULT (Edge Client -> Brain)
class ExecResultPayload(BaseModel):
    request_id: str
    exit_code: int
    duration_ms: int
    error: Optional[str] = None
    data: Optional[Any] = None


class ExecResultMessage(BaseMessage):
    type: Literal["EXEC_RESULT"] = "EXEC_RESULT"
    payload: ExecResultPayload


# 10. ARTIFACT_SYNC (Bidirectional: task.md and implementation_plan.md)
class ArtifactSyncPayload(BaseModel):
    session_id: str
    artifact_name: Literal["task.md", "implementation_plan.md"]
    content: str
    version: int = 1


class ArtifactSyncMessage(BaseMessage):
    type: Literal["ARTIFACT_SYNC"] = "ARTIFACT_SYNC"
    payload: ArtifactSyncPayload


# 11. TELEMETRY
class TelemetryPayload(BaseModel):
    vram_used_gb: float
    vram_total_gb: float
    vram_percent: float
    host_ram_used_gb: float
    host_ram_total_gb: float
    host_ram_percent: float
    gpu_utilization_percent: float
    cpu_utilization_percent: float
    active_tier: ModelTier
    active_model: str


class TelemetryMessage(BaseMessage):
    type: Literal["TELEMETRY"] = "TELEMETRY"
    payload: TelemetryPayload


# 12. TOOL_EVENT (Broadcast tool execution status to UI)
class ToolEventPayload(BaseModel):
    session_id: str
    tool_name: str
    command: str
    output: Optional[str] = None
    status: Literal["running", "success", "error"] = "success"


class ToolEventMessage(BaseMessage):
    type: Literal["TOOL_EVENT"] = "TOOL_EVENT"
    payload: ToolEventPayload


# 13. STOP_GENERATION
class StopGenerationPayload(BaseModel):
    session_id: str


class StopGenerationMessage(BaseMessage):
    type: Literal["STOP_GENERATION"] = "STOP_GENERATION"
    payload: StopGenerationPayload

