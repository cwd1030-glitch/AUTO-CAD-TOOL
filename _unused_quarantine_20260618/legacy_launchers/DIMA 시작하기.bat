@echo off
cd /d "%~dp0"
title DIMA Launcher

echo ============================================
echo    Starting DIMA ...
echo ============================================
echo.

REM 1) kill running instance
taskkill /IM DIMA.exe /F >nul 2>&1

REM 2) check Python
where python >nul 2>&1
if errorlevel 1 goto NOPY
python --version >nul 2>&1
if errorlevel 1 goto NOPY

REM 3) check libraries, install if missing
echo [1/2] Checking libraries...
python -c "import importlib.util as u,sys; sys.exit(0 if all(u.find_spec(x) for x in ['flask','flask_cors','numpy','scipy','trimesh','dotenv','google.generativeai']) else 1)" >nul 2>&1
if errorlevel 1 (
    echo      First run: installing required libraries. Please wait 1-3 min...
    python -m pip install --upgrade pip >nul 2>&1
    python -m pip install -r "%~dp0app\requirements.txt"
    if errorlevel 1 (
        echo.
        echo [ERROR] Library install failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
)

REM 4) launch
echo [2/2] Launching DIMA... a browser will open at http://localhost:8899
if exist "%~dp0app\DIMA.exe" (
    start "" "%~dp0app\DIMA.exe"
) else if exist "%~dp0DIMA.exe" (
    start "" "%~dp0DIMA.exe"
) else (
    echo [ERROR] DIMA.exe not found.
    pause
    exit /b 1
)
timeout /t 4 /nobreak >nul
exit /b 0

:NOPY
echo [NEED PYTHON] Python is not installed (or only the Microsoft Store stub).
echo.
echo   1. Install Python 3.10+ from https://www.python.org/downloads/
echo   2. IMPORTANT: check "Add Python to PATH" during install
echo   3. Run this file again
echo.
echo   Tip: if typing "python" opens Microsoft Store, turn OFF the alias at
echo        Settings ^> Apps ^> Advanced app settings ^> App execution aliases
echo        (disable python.exe / python3.exe), then install from python.org.
echo.
pause
exit /b 1
