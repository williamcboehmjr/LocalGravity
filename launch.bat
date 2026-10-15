@echo off
setlocal

set SCRIPT_DIR=%~dp0
set BRAIN_DIR=%SCRIPT_DIR%brain
set PYTHON_EXE=%BRAIN_DIR%\.venv\Scripts\python.exe

:: 1. Launch python launcher directly which handles health checks, server launch, and browser app window
if exist "%PYTHON_EXE%" (
    start "" "%PYTHON_EXE%" "%SCRIPT_DIR%launch.py"
    exit /b 0
)

:: 2. Fallback direct browser launch
start http://localhost:3390
exit /b 0
