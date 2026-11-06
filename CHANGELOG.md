# Changelog: LocalGravity 2.0 (Unified Windows & macOS)

All notable changes across LocalGravity Windows, macOS, and Web Remote Companion.

---

## [v2.0.1] - 2026-11-06 (Multi-Platform Parity & TabbyAPI Qwen 3.5 Suite)

### 🪟 Windows Release & Loopback Fix
* **IPv4 Loopback Lock (`127.0.0.1`):** Resolved the issue where Windows WebView2 resolved `localhost` to `[::1]:3390` (IPv6), causing TCP drops. All client discovery endpoints now bind cleanly to `127.0.0.1:3390`.
* **Graceful Offline Detection:** Prompt submissions now verify active WebSocket connectivity. If offline, the client alerts the user with an actionable "Connect in Settings" card rather than spinning indefinitely.
* **New Windows Installer:** Packaged standard Microsoft Windows Installer (`LocalGravity_2.0.0_x64.msi`) containing the complete updated bundle.

### 🧠 TabbyAPI EXL3 Engine & Model Suite
* **Native TabbyAPI Wiring:** LocalGravity Central Brain connects directly to the workstation's active TabbyAPI instance at `http://127.0.0.1:5001` with API key and admin key authentication.
* **3-Tier Qwen 3.5/3.8 EXL3 Suite:**
  * **[ Low 4B ]:** `UnstableLlama/Qwen3.5-4B-exl3-4.00bpw` (Hybrid Mamba linear-attention, full vision, 262k context, 4.0bpw EXL3).
  * **[ Med 9B ]:** `Ppeerapon/Qwen3.5-9B-EXL3-4.0bpw` (Upgraded dense architecture succeeding Qwen3-8B, 4.0bpw EXL3, vision enabled).
  * **[ High 27B ]:** `Qwen3.8-27B-EXL3-11.5GB` (Deep architectural planning, running in VRAM with Q4 KV cache).
* **Automated SysRAM Hot-Swap:** Inactive tiers pre-warmed in DDR4 System RAM, streaming into VRAM via TabbyAPI `/v1/model/load` over PCIe in ~1s.

### 🍏 macOS Alignment & Unified UI
* **Merged macOS Overhaul:** Fully synchronized with macOS commits (`3a7ce1f` and `dbc5481`):
  * Decoupled WebSocket state effect from thread/project switching, eliminating state blinking.
  * Antigravity 2.0 typography, dark palette tokens, and streamlined PromptBar.
  * PC Brain Connection settings with live ping/latency diagnostic tester.
  * Multi-platform release assets: `.msi` (Windows) and `.dmg` (macOS arm64).

---

## [v2.0.0] - 2026-11-06 (Initial Decoupled Client & Harness² Framework)
* Strict client/brain decoupling: Edge clients manage independent project folders under `%APPDATA%\LocalGravity` (Windows) and `~/Library/Application Support/LocalGravity` (macOS).
* Google Harness² 8-component architecture (`.localgravity/harness/`) with automated recursive Propose-Probe-Compose self-healing loop.
* Contained foreground brain launcher (`runlocalgravitybrain.bat`) with dynamic port discovery and 10-minute idle VRAM auto-unload.
