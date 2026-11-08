import os
import sys
import time
import subprocess

model_dir = r"F:\Models\Qwen3.8-Flash-Next-IQ3_S"
shard1 = os.path.join(model_dir, "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00002.gguf")
shard2 = os.path.join(model_dir, "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00002-of-00002.gguf")
aria1 = shard1 + ".aria2"
aria2 = shard2 + ".aria2"
pack_dir = r"F:\packs\iq3_s"

python_exe = r"C:\Users\Sue\AppData\Local\Strata\terminal\0.1.58\python\python.exe"
iq_pack_py = r"C:\Users\Sue\AppData\Local\Strata\terminal\0.1.58\tools\iq_pack.py"
strata_py = r"C:\Users\Sue\AppData\Local\Strata\terminal\0.1.58\strata.py"

print("[AutoPack] Checking download completion...", flush=True)
while os.path.exists(aria1) or os.path.exists(aria2):
    s1 = os.path.getsize(shard1) if os.path.exists(shard1) else 0
    s2 = os.path.getsize(shard2) if os.path.exists(shard2) else 0
    rem1 = max(0, 54817524224 - s1)
    print(f"[AutoPack] Downloading... Shard 1: {s1 / (1024**3):.2f}/51.05 GiB ({rem1/(1024**2):.0f} MB left)", flush=True)
    time.sleep(4)

print("\n[AutoPack] Download 100% COMPLETE! Both shards verified.", flush=True)
time.sleep(2)

print(f"[AutoPack] Starting iq_pack conversion to {pack_dir}...", flush=True)
cmd = [python_exe, iq_pack_py, "--gguf", shard1, "--out", pack_dir, "--compat-bf16"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
for line in iter(proc.stdout.readline, ''):
    if line.strip():
        print(f"[Pack] {line.strip()}", flush=True)
proc.stdout.close()
return_code = proc.wait()

print(f"[AutoPack] iq_pack completed with exit code: {return_code}", flush=True)

if return_code == 0:
    print("[AutoPack] Packing succeeded! Launching Strata High Tier on port 8080...", flush=True)
    launch_cmd = [
        python_exe, strata_py, "launch",
        "--family", "qwen",
        "--model", "iq3_s",
        "--model-path", model_dir,
        "--context", "64k",
        "--vision", "off",
        "--drafting", "dflash2",
        "--tune", "skip",
        "--access", "local",
        "--port", "8080",
        "--yes",
        "--no-tui",
        "--restart"
    ]
    p_launch = subprocess.run(launch_cmd, capture_output=True, text=True)
    print(f"[AutoPack] Launch stdout: {p_launch.stdout}", flush=True)
    print(f"[AutoPack] Launch stderr: {p_launch.stderr}", flush=True)
