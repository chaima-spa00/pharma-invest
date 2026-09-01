@echo off
title Pharma SPA Server
echo ==================================================
echo  Starting Pharma SPA Server on http://localhost:8080/
echo ==================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
if %errorlevel% neq 0 (
    echo.
    echo Server stopped with error.
    pause
)
