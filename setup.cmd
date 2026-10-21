@echo off
rem Prepara el entorno de HardScope (Node.js, Git y dependencias) y abre la app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
set code=%errorlevel%
echo.
pause
exit /b %code%
