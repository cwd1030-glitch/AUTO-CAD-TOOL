@echo off
setlocal
cd /d "%~dp0"
set "HTML=%~dp0index.html"

if exist "%~dp0DIMA.exe" (
    echo Starting DIMA.exe ^(local HTTP server^) ... http://localhost:8899
    start "" "%~dp0DIMA.exe"
    goto done
)

echo DIMA.exe not found. Opening in browser ^(STP will NOT work via file://^).
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%CHROME%" ( start "" "%CHROME%" "%HTML%" & goto done )
if exist "%CHROME86%" ( start "" "%CHROME86%" "%HTML%" & goto done )
if exist "%EDGE%" ( start "" "%EDGE%" "%HTML%" & goto done )
start "" "%HTML%"

:done
echo.
echo DIMA launched. If STP fails, make sure the address bar shows http://localhost
timeout /t 2 /nobreak >nul
