@echo off
title LocalGravity Central Brain 2.0
color 0B

echo ==================================================================
echo   Starting LocalGravity Central Brain 2.0 (Contained Console Mode)
echo   Fastify Headless Core + TabbyAPI EXL3 + 128GB SysRAM Pre-Warmer
echo   Closing this console window will immediately shut down the Brain.
echo ==================================================================

cd /d "%~dp0"

node "%~dp0launch.mjs" --foreground

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] LocalGravity exited with error code %errorlevel%.
    pause
)
