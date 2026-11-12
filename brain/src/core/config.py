"""
Configuration loader for LocalGravity Central Brain (Decoupled Headless TabbyAPI + Harness²).
Strictly forbids ports 5000 and 5001.
"""

from pathlib import Path
from typing import Dict, List, Optional
import yaml
from pydantic import BaseModel, Field

FORBIDDEN_PORTS = {5000, 5001}


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 3390
    forbidden_ports: List[int] = Field(default_factory=lambda: [5000, 5001])
    cors_origins: List[str] = Field(default_factory=lambda: ["*"])


class TabbyApiConfig(BaseModel):
    base_url: str = "http://127.0.0.1:3450"
    timeout_seconds: float = 180.0
    cache_mode: str = "Q4"
    autosplit_reserve: List[int] = Field(default_factory=lambda: [256])
    draft_mode: str = "ngram"
    hybrid_draft_tokens: int = 4
    sysram_prewarm: bool = True


class ModelsConfig(BaseModel):
    tiers: Dict[str, str] = Field(
        default_factory=lambda: {
            "low": "Qwen3.5-4B-EXL3-4.5bpw",
            "medium": "Qwen3.5-9B-EXL3-4.0bpw",
            "high": "Qwen-3.8-27B-VL-EXL3-3.5bpw",
        }
    )


class ThinkingConfig(BaseModel):
    budgets: Dict[str, int] = Field(
        default_factory=lambda: {
            "off": 0,
            "fast": 250,
            "deep": 8192,
        }
    )


class SkillsConfig(BaseModel):
    directory: str = "../skills"
    watch_reload: bool = True


class TelemetryConfig(BaseModel):
    poll_interval_seconds: float = 2.0


class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    tabby_api: TabbyApiConfig = Field(default_factory=TabbyApiConfig)
    models: ModelsConfig = Field(default_factory=ModelsConfig)
    thinking: ThinkingConfig = Field(default_factory=ThinkingConfig)
    skills: SkillsConfig = Field(default_factory=SkillsConfig)
    telemetry: TelemetryConfig = Field(default_factory=TelemetryConfig)


_CONFIG_INSTANCE: Optional[AppConfig] = None


def load_config(config_path: Optional[str] = None) -> AppConfig:
    global _CONFIG_INSTANCE
    if _CONFIG_INSTANCE is not None:
        return _CONFIG_INSTANCE

    path = (
        Path(config_path)
        if config_path
        else Path(__file__).resolve().parent.parent.parent / "config.yaml"
    )

    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
            _CONFIG_INSTANCE = AppConfig(**data)
    else:
        _CONFIG_INSTANCE = AppConfig()

    if _CONFIG_INSTANCE.server.port in FORBIDDEN_PORTS:
        raise ValueError(
            f"Port {_CONFIG_INSTANCE.server.port} is strictly forbidden (5000/5001 reserved)."
        )

    return _CONFIG_INSTANCE
