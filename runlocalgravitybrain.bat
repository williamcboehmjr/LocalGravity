@echo off
title LocalGravity Central Brain 2.0 (Strata Engine + Fastify Core)
color 0B

echo ==================================================================
echo   Starting LocalGravity Central Brain 2.0
echo   Fastify Central Brain + Strata Engine (Qwen 3.8 Flash-Next)
echo   Closing this console window will immediately shut down the Brain.
echo ==================================================================

cd /d "%~dp0"

node "%~dp0launch.mjs" --foreground

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] LocalGravity exited with error code %errorlevel%.
    pause
)
