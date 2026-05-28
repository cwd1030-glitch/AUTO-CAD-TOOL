@echo off
chcp 65001 >nul
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║   DIMA - Design Intelligence AI       ║
echo  ║   설계 검증 AI 플랫폼                 ║
echo  ╚═══════════════════════════════════════╝
echo.

:: 현재 폴더 경로 가져오기
set DIR=%~dp0

:: index.html 절대 경로
set HTML=%DIR%index.html

:: DIMA.exe 실행 파일이 있으면 로컬 HTTP 서버 실행
if exist "%DIR%DIMA.exe" (
    echo  [0] DIMA.exe (로컬 HTTP 서버) 실행 중...
    start "" "%DIR%DIMA.exe"
    goto :success
)

echo  [1] Chrome으로 실행 시도 중...
set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set CHROME86="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist %CHROME% (
    start "" %CHROME% --allow-file-access-from-files "%HTML%"
    goto :success
)
if exist %CHROME86% (
    start "" %CHROME86% --allow-file-access-from-files "%HTML%"
    goto :success
)

echo  [2] Edge로 실행 시도 중...
set EDGE="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist %EDGE% (
    start "" %EDGE% --allow-file-access-from-files "%HTML%"
    goto :success
)

echo  [3] 기본 브라우저로 열기...
start "" "%HTML%"

:success
echo.
echo  ✅ DIMA 앱이 브라우저에서 열렸습니다!
echo.
echo  테스트 파일 위치:
echo    2D 파일: samples\sample_bracket.dxf
echo    3D 파일: samples\sample_part.stl
echo.
timeout /t 3 /nobreak >nul
