"""
LocalGravity 2.0 Startup Orchestrator & Dynamic Port Allocator
- Strictly forbids ports 5000 and 5001 under all circumstances.
- Dynamically allocates free ports for Fastify Headless Core Daemon (3390+) and TabbyAPI (3450+).
- Atomically writes `.runtime/ports.json` and `client/public/runtime-ports.json`.
- Starts Fastify Headless Daemon, triggers SysRAM weight pre-warming, and prints Local & LAN URLs.
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import winreg

FORBIDDEN_PORTS = {5000, 5001}
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.join(SCRIPT_DIR, "server")
RUNTIME_DIR = os.path.join(SCRIPT_DIR, ".runtime")
PORTS_FILE = os.path.join(RUNTIME_DIR, "ports.json")


def is_port_free(port: int, host: str = "0.0.0.0") -> bool:
    if port in FORBIDDEN_PORTS:
        return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def find_free_port(start_port: int, reserved: set[int]) -> int:
    candidate = start_port
    for _ in range(250):
        if candidate not in FORBIDDEN_PORTS and candidate not in reserved:
            if is_port_free(candidate):
                reserved.add(candidate)
                return candidate
        candidate += 1
    raise RuntimeError(f"Could not find a free TCP port starting at {start_port}")


def detect_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def write_ports_atomically(config: dict) -> None:
    os.makedirs(RUNTIME_DIR, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=RUNTIME_DIR, prefix="ports.", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    os.replace(tmp_path, PORTS_FILE)

    client_pub = os.path.join(SCRIPT_DIR, "client", "public")
    os.makedirs(client_pub, exist_ok=True)
    client_ports = os.path.join(client_pub, "runtime-ports.json")
    fd2, tmp_path2 = tempfile.mkstemp(dir=client_pub, prefix="runtime-ports.", suffix=".tmp")
    with os.fdopen(fd2, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    os.replace(tmp_path2, client_ports)


def is_daemon_healthy(health_url: str) -> bool:
    try:
        with urllib.request.urlopen(health_url, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


def check_existing_daemon() -> dict | None:
    if os.path.exists(PORTS_FILE):
        try:
            with open(PORTS_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            d_port = cfg.get("daemonPort")
            if d_port and d_port not in FORBIDDEN_PORTS:
                if is_daemon_healthy(f"http://127.0.0.1:{d_port}/health"):
                    return cfg
        except Exception:
            pass
    return None


def start_fastify_daemon(ports_cfg: dict) -> bool:
    env = os.environ.copy()
    env["LOCALGRAVITY_DAEMON_PORT"] = str(ports_cfg["daemonPort"])
    env["LOCALGRAVITY_TABBY_PORT"] = str(ports_cfg["tabbyPort"])
    env["LOCALGRAVITY_VITE_PORT"] = str(ports_cfg["vitePort"])
    env["LOCALGRAVITY_REUSE_PORTS"] = "1"

    dist_entry = os.path.join(SERVER_DIR, "dist", "index.js")
    node_exe = "node.exe" if os.name == "nt" else "node"

    if os.path.exists(dist_entry):
        cmd = [node_exe, dist_entry]
    else:
        npx_exe = "npx.cmd" if os.name == "nt" else "npx"
        cmd = [npx_exe, "tsx", "src/index.ts"]

    subprocess.Popen(
        cmd,
        cwd=SERVER_DIR,
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        close_fds=True,
    )

    health_url = f"http://127.0.0.1:{ports_cfg['daemonPort']}/health"
    for _ in range(40):
        time.sleep(0.35)
        if is_daemon_healthy(health_url):
            return True
    return False


def find_browser_exe(name: str) -> str:
    if os.name != "nt":
        return ""
    try:
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}",
        )
        val, _ = winreg.QueryValueEx(key, "")
        if os.path.exists(val):
            return val
    except Exception:
        pass
    return ""


def launch_browser_app(app_url: str) -> None:
    msedge = find_browser_exe("msedge.exe")
    if msedge:
        subprocess.Popen(
            [msedge, f"--app={app_url}", "--window-size=1480,920"],
            creationflags=subprocess.DETACHED_PROCESS if os.name == "nt" else 0,
        )
        return

    chrome = find_browser_exe("chrome.exe")
    if chrome:
        subprocess.Popen(
            [chrome, f"--app={app_url}", "--window-size=1480,920"],
            creationflags=subprocess.DETACHED_PROCESS if os.name == "nt" else 0,
        )
        return

    import webbrowser
    webbrowser.open(app_url)


def main() -> None:
    parser = argparse.ArgumentParser(description="LocalGravity 2.0 Launcher")
    parser.add_argument("--headless", action="store_true", help="Start daemon without opening browser window")
    args = parser.parse_args()

    existing = check_existing_daemon()
    if existing:
        ports_cfg = existing
    else:
        reserved = set(FORBIDDEN_PORTS)
        daemon_port = find_free_port(3390, reserved)
        tabby_port = find_free_port(3450, reserved)
        vite_port = find_free_port(5173, reserved)

        assert daemon_port not in FORBIDDEN_PORTS, "Forbidden port detected!"
        assert tabby_port not in FORBIDDEN_PORTS, "Forbidden port detected!"
        assert vite_port not in FORBIDDEN_PORTS, "Forbidden port detected!"

        lan_ip = detect_lan_ip()
        ports_cfg = {
            "daemonPort": daemon_port,
            "tabbyPort": tabby_port,
            "vitePort": vite_port,
            "daemonHost": "0.0.0.0",
            "lanIp": lan_ip,
            "localUrl": f"http://localhost:{daemon_port}",
            "lanUrl": f"http://{lan_ip}:{daemon_port}",
            "wsSyncUrl": f"ws://localhost:{daemon_port}/ws/sync",
            "tabbyBaseUrl": f"http://127.0.0.1:{tabby_port}",
            "allocatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "forbiddenPorts": [5000, 5001],
        }
        write_ports_atomically(ports_cfg)
        ok = start_fastify_daemon(ports_cfg)
        if not ok:
            print("ERROR: Fastify Headless Core Daemon failed to respond to health check.", file=sys.stderr)
            sys.exit(1)

    # Trigger SysRAM Pre-Warm pass
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{ports_cfg['daemonPort']}/api/tabby/prewarm",
            method="POST",
            data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

    print("==================================================================")
    print("  LocalGravity 2.0 (LocalGravity + Harness² Engine)")
    print("==================================================================")
    print(f"  Local Desktop URL       : {ports_cfg['localUrl']}")
    print(f"  LAN / Remote Web URL    : {ports_cfg['lanUrl']}")
    print(f"  WebSocket Multiplexer   : {ports_cfg['wsSyncUrl']}")
    print(f"  TabbyAPI EXL3 Endpoint  : {ports_cfg['tabbyBaseUrl']} (Q4 KV, N-gram x4)")
    print(f"  Port Safety Verification: Ports 5000 & 5001 UNTOUCHED")
    print("==================================================================")

    if not args.headless:
        launch_browser_app(ports_cfg["localUrl"])


if __name__ == "__main__":
    main()
