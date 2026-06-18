@echo off
cd /d "%~dp0"
title DIMA Diagnostic

echo ============================================
echo    DIMA Diagnostic  (window stays open)
echo ============================================
echo.
echo Folder: %CD%
echo.

echo [1] Python check -----------------------------
where python
python --version
echo.

echo [2] Library check ----------------------------
python -c "import importlib.util as u" 2>nul
if errorlevel 1 (
    echo     Python not working - skip library check
) else (
    python -c "import importlib.util as u; print('\n'.join(['    '+m+' = '+('OK' if u.find_spec(m) else 'MISSING') for m in ['flask','flask_cors','numpy','scipy','trimesh','dotenv','google.generativeai']]))"
)
echo.

echo [3] DIMA.exe check ---------------------------
if exist "%~dp0app\DIMA.exe" (echo     app\DIMA.exe : found) else (echo     app\DIMA.exe : NOT FOUND)
if exist "%~dp0DIMA.exe" (echo     root DIMA.exe : found) else (echo     root DIMA.exe : NOT FOUND)
echo.

echo [4] Launch DIMA ------------------------------
taskkill /IM DIMA.exe /F >nul 2>&1
if exist "%~dp0app\DIMA.exe" (
    start "" "%~dp0app\DIMA.exe"
    echo     launched app\DIMA.exe
) else if exist "%~dp0DIMA.exe" (
    start "" "%~dp0DIMA.exe"
    echo     launched root DIMA.exe
) else (
    echo     DIMA.exe NOT FOUND
)
echo     waiting 6 seconds...
timeout /t 6 /nobreak >nul
echo.

echo [5] Server check (http://localhost:8899) -----
powershell -NoProfile -Command "try{ $r=Invoke-WebRequest -UseBasicParsing http://localhost:8899 -TimeoutSec 6; Write-Host ('    Server OK (HTTP ' + $r.StatusCode + ') -> app is running. Open http://localhost:8899 in a browser.') }catch{ Write-Host ('    No response -> DIMA.exe did not start. Reason: ' + $_.Exception.Message) }"
echo.
echo ============================================
echo   Done. Please screenshot lines [1] to [5].
echo ============================================
echo.
pause
