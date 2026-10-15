"""
LocalGravity Launcher - Robust Windows launcher that verifies Central Brain and opens app window.
"""

import os
import subprocess
import sys
import time
import urllib.request
import winreg

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BRAIN_DIR = os.path.join(SCRIPT_DIR, "brain")
VENV_PYTHON = os.path.join(BRAIN_DIR, ".venv", "Scripts", "python.exe")
HEALTH_URL = "http://127.0.0.1:3390/health"
APP_URL = "http://localhost:3390"


def is_brain_running() -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


def start_brain():
    print("Starting LocalGravity Central Brain...")
    cmd = [
        VENV_PYTHON,
        "-m",
        "uvicorn",
        "src.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        "3390",
    ]
    # Start as background detached process
    subprocess.Popen(
        cmd,
        cwd=BRAIN_DIR,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        close_fds=True,
    )
    # Wait for brain to respond
    for _ in range(30):
        time.sleep(0.5)
        if is_brain_running():
            print("Central Brain ready.")
            return True
    return False


def find_browser_exe(name: str) -> str:
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


def launch_browser_app():
    # 1. Try Microsoft Edge in standalone app window
    msedge = find_browser_exe("msedge.exe")
    if msedge:
        subprocess.Popen(
            [msedge, f"--app={APP_URL}", "--window-size=1440,900"],
            creationflags=subprocess.DETACHED_PROCESS if os.name == "nt" else 0,
        )
        return

    # 2. Try Google Chrome in standalone app window
    chrome = find_browser_exe("chrome.exe")
    if chrome:
        subprocess.Popen(
            [chrome, f"--app={APP_URL}", "--window-size=1440,900"],
            creationflags=subprocess.DETACHED_PROCESS if os.name == "nt" else 0,
        )
        return

    # 3. Fallback to default browser
    import webbrowser
    webbrowser.open(APP_URL)


def main():
    if not is_brain_running():
        start_brain()
    launch_browser_app()


if __name__ == "__main__":
    main()
