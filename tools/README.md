# tools/

One-off maintenance & diagnostic scripts for LocalGravity. **Not part of the app build** — nothing in `server/src` or `client/src` imports these; they are run manually from here.

| Script | Purpose |
|---|---|
| `auto_pack_and_launch.py` | Pack a quant + launch helper (one-off) |
| `check_hf_header.py` | Inspect HuggingFace safetensors header |
| `check_tensors.py` | Dump/inspect model tensor info |
| `fast_download_iq3s.py` | Fast download helper for iq3_s quants |
| `inspect_layers.py` | Layer-level model inspection |
| `move_and_accelerate.ps1` | Move + accelerate setup (one-off) |
| `patch_iq_pack.mjs` | Patch an IQ pack |
| `test_hard_coding.mjs` | Ad-hoc test harness |
| `test_strata.mjs` | Strata/MoE sidecar smoke test |
| `update_mobile_fonts.mjs` | One-off mobile font update pass |

> Kept out of repo root to avoid clutter. If a script graduates into real tooling, move it under `scripts/` (tracked build/tool scripts live there).
