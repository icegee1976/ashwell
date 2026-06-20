@echo off
chcp 65001 >nul
REM 雙擊即可查看目前用量 / tier / 喚醒窗(不必開終端機)。
cd /d "%~dp0.."
node dist\cli.js status
echo.
pause
