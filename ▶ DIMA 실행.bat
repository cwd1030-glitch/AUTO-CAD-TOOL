@echo off
setlocal
cd /d "%~dp0"
echo Closing any running DIMA instance...
taskkill /IM DIMA.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul
if exist "%~dp0app\DIMA.exe" (
    echo Starting DIMA ^(app server^) ... http://localhost:8899
    start "" "%~dp0app\DIMA.exe"
    goto done
)
if exist "%~dp0DIMA.exe" (
    start "" "%~dp0DIMA.exe"
    goto done
)
echo [ERROR] DIMA.exe not found.
pause
:done
timeout /t 2 /nobreak >nul
