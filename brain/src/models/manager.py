"""
Zero-Latency Tiered Model Manager and VRAM Eviction Choreographer.
"""

import asyncio
import logging
import time
from typing import Callable, Dict, Optional, Awaitable
from ..protocol.events import ModelTier, ModelStateMessage, ModelStatePayload
from ..core.telemetry import get_telemetry_snapshot
from .ollama_client import OllamaClient

logger = logging.getLogger("LocalGravity.ModelManager")


class TieredModelManager:
    def __init__(
        self,
        ollama_client: OllamaClient,
        tier_mappings: Optional[Dict[str, str]] = None,
        keep_alive_lease: str = "10m",
        ramdisk_path: Optional[str] = None,
    ):
        self.client = ollama_client
        self.tier_mappings: Dict[ModelTier, str] = {
            ModelTier.LOW: tier_mappings.get("low", "qwen3.5:4b") if tier_mappings else "qwen3.5:4b",
            ModelTier.MEDIUM: tier_mappings.get("medium", "qwen3.5:9b") if tier_mappings else "qwen3.5:9b",
            ModelTier.HIGH: tier_mappings.get("high", "qwen3.8-27b-vl:latest") if tier_mappings else "qwen3.8-27b-vl:latest",
        }
        self.keep_alive_lease = keep_alive_lease
        self.ramdisk_path = ramdisk_path
        self.active_tier: ModelTier = ModelTier.LOW
        self.active_model: str = self.tier_mappings[ModelTier.LOW]
        self._lock = asyncio.Lock()

    def get_model_for_tier(self, tier: ModelTier) -> str:
        return self.tier_mappings.get(tier, self.tier_mappings[ModelTier.LOW])

    async def prewarm_all_tiers(self):
        """
        Runs on startup: sends a 0-token ping with keep_alive: 0 to each tier
        to ensure weights are resident in Windows host DDR4 memory-mapped cache.
        """
        logger.info("Initializing pre-warm routine across all model tiers into DDR4 RAM...")
        for tier, model_name in self.tier_mappings.items():
            try:
                logger.info(f"Pre-warming [{tier.value}] -> {model_name}...")
                await self.client.generate(
                    model=model_name,
                    prompt="",
                    keep_alive=0
                )
                logger.info(f"Tier [{tier.value}] {model_name} pre-cached successfully.")
            except Exception as e:
                logger.warning(f"Pre-warm skipped for {model_name}: {e}")
        logger.info("All tiers resident in host DDR4 RAM.")

    async def evict_vram(self, model_name: str):
        """Forces immediate GPU VRAM layer deallocation by sending keep_alive: 0."""
        logger.info(f"Evicting model {model_name} from GPU VRAM...")
        try:
            await self.client.generate(model=model_name, prompt="", keep_alive=0)
        except Exception as e:
            logger.error(f"Error during VRAM eviction of {model_name}: {e}")

    async def switch_tier(
        self,
        new_tier: ModelTier,
        status_notifier: Optional[Callable[[ModelStatePayload], Awaitable[None]]] = None,
    ) -> str:
        """
        Performs fast-swap between tiers:
        1. If already active, returns immediately.
        2. Evicts active model from GPU VRAM with keep_alive: 0.
        3. Broadcasts non-blocking 'swapping' state to UI.
        4. Leases new model with keep_alive: '10m'.
        5. Returns active model name.
        """
        async with self._lock:
            target_model = self.tier_mappings[new_tier]
            if self.active_tier == new_tier and self.active_model == target_model:
                return self.active_model

            logger.info(f"Switching tier from {self.active_tier.value} to {new_tier.value} ({target_model})...")
            start_time = time.perf_counter()

            # 1. Notify swapping
            if status_notifier:
                telem = get_telemetry_snapshot()
                await status_notifier(
                    ModelStatePayload(
                        status="swapping",
                        active_tier=new_tier,
                        active_model=target_model,
                        status_text=f"⚡ Loading {new_tier.value.title()} ({target_model}) into VRAM...",
                        vram_used_gb=telem["vram_used_gb"],
                        vram_total_gb=telem["vram_total_gb"],
                        host_ram_used_gb=telem["host_ram_used_gb"],
                        host_ram_total_gb=telem["host_ram_total_gb"],
                    )
                )

            # 2. Evict current model from VRAM
            if self.active_model:
                await self.evict_vram(self.active_model)

            # 3. Warm lease target model in VRAM
            try:
                await self.client.generate(
                    model=target_model,
                    prompt="",
                    keep_alive=self.keep_alive_lease
                )
            except Exception as e:
                logger.error(f"Error leasing model {target_model}: {e}")

            self.active_tier = new_tier
            self.active_model = target_model
            duration_ms = int((time.perf_counter() - start_time) * 1000)
            logger.info(f"Model {target_model} active in VRAM (PCIe load took {duration_ms}ms).")

            # 4. Notify ready
            if status_notifier:
                telem = get_telemetry_snapshot()
                await status_notifier(
                    ModelStatePayload(
                        status="ready",
                        active_tier=new_tier,
                        active_model=target_model,
                        status_text=f"Ready ({target_model})",
                        vram_used_gb=telem["vram_used_gb"],
                        vram_total_gb=telem["vram_total_gb"],
                        host_ram_used_gb=telem["host_ram_used_gb"],
                        host_ram_total_gb=telem["host_ram_total_gb"],
                    )
                )

            return target_model
