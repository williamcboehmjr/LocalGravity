import urllib.request
import struct
import json
import time

url = "https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF/resolve/main/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf"
print("Reading first 2MB of shard 2 header...")
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Range": "bytes=0-2097152"})
with urllib.request.urlopen(req) as resp:
    header_bytes = resp.read()
print(f"Read {len(header_bytes)} bytes header.")

magic = header_bytes[:4]
print("Magic:", magic)
version, n_tensors, n_kv = struct.unpack("<IIIQ" if False else "<IIQ", header_bytes[4:20])
print(f"Version: {version}, n_tensors: {n_tensors}, n_kv: {n_kv}")
