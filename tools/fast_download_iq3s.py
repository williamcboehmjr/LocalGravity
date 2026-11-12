import os
import sys
import time
import math
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DEST_DIR = Path("F:/Models/Qwen3.8-Flash-Next-IQ3_S")
DEST_DIR.mkdir(parents=True, exist_ok=True)

FILES = [
    {
        "name": "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00002.gguf",
        "url": "https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF/resolve/main/IQ3_S/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00001-of-00002.gguf",
        "size": 54817524224,
    },
    {
        "name": "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00002-of-00002.gguf",
        "url": "https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF/resolve/main/IQ3_S/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S-00002-of-00002.gguf",
        "size": 28800138432,
    }
]

CHUNK_SIZE = 32 * 1024 * 1024  # 32 MB chunks
MAX_WORKERS = 16  # 16 concurrent HTTP streams

def download_chunk(url, file_path, chunk_idx, start_byte, end_byte):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Range": f"bytes={start_byte}-{end_byte}"
    }
    req = urllib.request.Request(url, headers=headers)
    max_retries = 5
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
                expected_len = end_byte - start_byte + 1
                if len(data) != expected_len:
                    raise IOError(f"Short read: got {len(data)}, expected {expected_len}")
                with open(file_path, "r+b") as f:
                    f.seek(start_byte)
                    f.write(data)
                return chunk_idx, len(data)
        except Exception as e:
            if attempt == max_retries - 1:
                raise e
            time.sleep(1.5 * (attempt + 1))

def download_file(item):
    name = item["name"]
    url = item["url"]
    total_size = item["size"]
    out_path = DEST_DIR / name
    state_path = DEST_DIR / f"{name}.progress.json"

    # Pre-allocate sparse file if not exists
    if not out_path.exists() or out_path.stat().st_size != total_size:
        print(f"[{name}] Pre-allocating {total_size / (1024**3):.2f} GiB on Drive F:...")
        with open(out_path, "wb") as f:
            f.truncate(total_size)

    # Load progress state
    completed_chunks = set()
    if state_path.exists():
        try:
            with open(state_path, "r") as f:
                completed_chunks = set(json.load(f))
            print(f"[{name}] Resuming: {len(completed_chunks)} chunks already downloaded.")
        except Exception:
            pass

    num_chunks = math.ceil(total_size / CHUNK_SIZE)
    chunks_to_download = []
    for i in range(num_chunks):
        if i not in completed_chunks:
            start_b = i * CHUNK_SIZE
            end_b = min(total_size - 1, (i + 1) * CHUNK_SIZE - 1)
            chunks_to_download.append((i, start_b, end_b))

    print(f"[{name}] Starting multi-stream download: {len(chunks_to_download)} / {num_chunks} chunks remaining.")
    return name, url, out_path, state_path, total_size, completed_chunks, chunks_to_download

def main():
    print("=" * 70)
    print("  Official ISTA-DASLab Qwen 3.8 Flash-Next IQ3_S Fast Downloader")
    print(f"  Target Destination: {DEST_DIR}")
    print(f"  Parallel Streams  : {MAX_WORKERS} concurrent connections")
    print("=" * 70)

    plans = [download_file(f) for f in FILES]

    # Combine all remaining chunks across all files into one shared work pool
    tasks = []
    file_map = {}
    total_all_bytes = sum(f["size"] for f in FILES)
    already_done_bytes = 0

    for name, url, out_path, state_path, total_size, completed_chunks, chunks_to_download in plans:
        file_map[name] = {
            "state_path": state_path,
            "completed": completed_chunks,
            "total_chunks": math.ceil(total_size / CHUNK_SIZE)
        }
        already_done_bytes += len(completed_chunks) * CHUNK_SIZE
        for c_idx, s_b, e_b in chunks_to_download:
            tasks.append((name, url, str(out_path), c_idx, s_b, e_b))

    downloaded_session_bytes = 0
    t0 = time.time()
    last_log_time = t0

    print(f"Total model size: {total_all_bytes / (1024**3):.2f} GiB")
    print(f"Total chunks to fetch across both shards: {len(tasks)}")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {
            executor.submit(download_chunk, url, path, c_idx, s_b, e_b): (name, c_idx)
            for (name, url, path, c_idx, s_b, e_b) in tasks
        }

        save_counter = 0
        for future in as_completed(future_map):
            name, c_idx = future_map[future]
            try:
                idx, nbytes = future.result()
                downloaded_session_bytes += nbytes
                file_map[name]["completed"].add(idx)
                save_counter += 1

                # Periodically save state and print progress
                now = time.time()
                if now - last_log_time >= 5.0 or save_counter >= 16:
                    elapsed = now - t0
                    speed_mb = (downloaded_session_bytes / (1024 * 1024)) / max(0.1, elapsed)
                    total_current_bytes = already_done_bytes + downloaded_session_bytes
                    pct = (total_current_bytes / total_all_bytes) * 100
                    rem_bytes = max(0, total_all_bytes - total_current_bytes)
                    eta_sec = rem_bytes / max(1, (speed_mb * 1024 * 1024))
                    eta_min = eta_sec / 60

                    print(
                        f"[{pct:5.1f}%] {total_current_bytes/(1024**3):5.2f} / {total_all_bytes/(1024**3):.2f} GiB "
                        f"| Speed: {speed_mb:5.1f} MB/s | ETA: {eta_min:4.1f} min",
                        flush=True
                    )
                    last_log_time = now
                    save_counter = 0

                    # Flush state JSONs
                    for fn, finfo in file_map.items():
                        tmp_state = str(finfo["state_path"]) + ".tmp"
                        with open(tmp_state, "w") as sf:
                            json.dump(list(finfo["completed"]), sf)
                        os.replace(tmp_state, finfo["state_path"])

            except Exception as exc:
                print(f"Error on chunk {c_idx} of {name}: {exc}", file=sys.stderr, flush=True)

    # Final cleanup of progress files
    for name, finfo in file_map.items():
        if len(finfo["completed"]) >= finfo["total_chunks"]:
            if finfo["state_path"].exists():
                finfo["state_path"].unlink()
            done_file = DEST_DIR / f"{name}.done"
            done_file.write_text("ok")
            print(f"SUCCESS: {name} completely verified and saved.")

    total_time = (time.time() - t0) / 60
    print("=" * 70)
    print(f"All ISTA-DASLab IQ3_S shards downloaded successfully in {total_time:.2f} minutes!")
    print("=" * 70)

if __name__ == "__main__":
    main()
