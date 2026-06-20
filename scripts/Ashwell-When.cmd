@echo off
chcp 65001 >nul
REM Double-click to see the next scheduled trigger time.
cd /d "%~dp0.."
node dist\cli.js when
echo.
pause
