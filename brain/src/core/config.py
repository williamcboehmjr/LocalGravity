"""
Configuration loader for LocalGravity Central Brain.
"""

from pathlib import Path
from typing import Dict, List, Optional
import yaml
from pydantic import BaseModel, Field


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 3390
    cors_origins: List[str] = Field(default_factory=lambda: ["*"])


class OllamaConfig(BaseModel):
    base_url: str = "http://localhost:11434"
    timeout_seconds: float = 180.0
    keep_alive_lease: str = "10m"
    ramdisk_path: Optional[str] = None


class ModelsConfig(BaseModel):
    tiers: Dict[str, str] = Field(
        default_factory=lambda: {
            "low": "qwen3.5:4b",
            "medium": "qwen3.5:9b",
            "high": "qwen3.8-27b-vl:latest",
        }
    )


class ThinkingConfig(BaseModel):
    budgets: Dict[str, int] = Field(
        default_factory=lambda: {
            "off": 0,
            "fast": 256,
            "deep": 2048,
        }
    )


class SkillsConfig(BaseModel):
    directory: str = "../skills"
    watch_reload: bool = True


class TelemetryConfig(BaseModel):
    poll_interval_seconds: float = 2.0


class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    ollama: OllamaConfig = Field(default_factory=OllamaConfig)
    models: ModelsConfig = Field(default_factory=ModelsConfig)
    thinking: ThinkingConfig = Field(default_factory=ThinkingConfig)
    skills: SkillsConfig = Field(default_factory=SkillsConfig)
    telemetry: TelemetryConfig = Field(default_factory=TelemetryConfig)


_CONFIG_INSTANCE: Optional[AppConfig] = None


def load_config(config_path: Optional[str] = None) -> AppConfig:
    global _CONFIG_INSTANCE
    if _CONFIG_INSTANCE is not None:
        return _CONFIG_INSTANCE

    path = Path(config_path) if config_path else Path(__file__).resolve().parent.parent.parent / "config.yaml"

    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
            _CONFIG_INSTANCE = AppConfig(**data)
    else:
        _CONFIG_INSTANCE = AppConfig()

    return _CONFIG_INSTANCE
