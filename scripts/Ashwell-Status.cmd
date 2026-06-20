@echo off
chcp 65001 >nul
REM Double-click to see current usage / tier / wake window (no terminal needed).
cd /d "%~dp0.."
node dist\cli.js status
echo.
pause
