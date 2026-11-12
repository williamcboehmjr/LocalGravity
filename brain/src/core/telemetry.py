"""
Hardware telemetry collector for Host DDR4 RAM and NVIDIA GPU VRAM.
"""

import logging
import psutil
from typing import Dict, Any, Optional

logger = logging.getLogger("LocalGravity.Telemetry")

_NVML_INITIALIZED = False

try:
    import pynvml
    pynvml.nvmlInit()
    _NVML_INITIALIZED = True
    logger.info("NVIDIA NVML successfully initialized for GPU VRAM telemetry.")
except Exception as e:
    logger.warning(f"NVIDIA NVML could not be initialized (GPU metrics fallback): {e}")


def get_telemetry_snapshot() -> Dict[str, Any]:
    """
    Returns current snapshot of host RAM, CPU, and GPU VRAM.
    """
    # 1. Host DDR4 RAM
    vm = psutil.virtual_memory()
    host_ram_used_gb = round((vm.total - vm.available) / (1024 ** 3), 2)
    host_ram_total_gb = round(vm.total / (1024 ** 3), 2)
    host_ram_percent = round(vm.percent, 1)

    # 2. Host CPU
    cpu_percent = psutil.cpu_percent(interval=None)

    # 3. NVIDIA GPU VRAM & Utilization
    vram_used_gb = 0.0
    vram_total_gb = 16.0
    vram_percent = 0.0
    gpu_utilization_percent = 0.0

    if _NVML_INITIALIZED:
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util_info = pynvml.nvmlDeviceGetUtilizationRates(handle)

            vram_used_gb = round(mem_info.used / (1024 ** 3), 2)
            vram_total_gb = round(mem_info.total / (1024 ** 3), 2)
            vram_percent = round((mem_info.used / mem_info.total) * 100.0, 1)
            gpu_utilization_percent = float(util_info.gpu)
        except Exception as e:
            logger.debug(f"Error querying NVML telemetry: {e}")

    return {
        "vram_used_gb": vram_used_gb,
        "vram_total_gb": vram_total_gb,
        "vram_percent": vram_percent,
        "gpu_utilization_percent": gpu_utilization_percent,
        "host_ram_used_gb": host_ram_used_gb,
        "host_ram_total_gb": host_ram_total_gb,
        "host_ram_percent": host_ram_percent,
        "cpu_utilization_percent": cpu_percent,
    }
