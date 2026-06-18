@echo off
setlocal
cd /d "%~dp0"
echo ==== DIMA.exe Rebuild ====
echo.
taskkill /IM DIMA.exe /F >nul 2>&1
echo Compiling via compile_exe.ps1 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0compile_exe.ps1"
echo.
if exist "%~dp0DIMA.exe" (
    echo [OK] DIMA.exe updated. Now run the DIMA run .bat file.
) else (
    echo [FAIL] Build failed. .NET Framework 4.x required. See messages above.
)
echo.
pause
