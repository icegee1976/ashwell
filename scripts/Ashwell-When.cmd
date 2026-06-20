@echo off
chcp 65001 >nul
REM 雙擊即可看下次排程觸發時間。
cd /d "%~dp0.."
node dist\cli.js when
echo.
pause
