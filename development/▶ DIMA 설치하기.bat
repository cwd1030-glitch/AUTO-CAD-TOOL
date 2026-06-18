@echo off
chcp 65001 >nul
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║   DIMA - Design Intelligence AI       ║
echo  ║   설계 검증 AI 플랫폼 설치 프로그램  ║
echo  ╚═══════════════════════════════════════╝
echo.
echo  DIMA를 PC에 설치하고 바탕화면 및 시작 메뉴에 바로가기를 생성합니다.
echo  설치를 진행하려면 아무 키나 누르십시오...
pause >nul
echo.:: Python 설치 여부 확인
python -c "import sys" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [오류] Python이 설치되어 있지 않거나 환경 변수^(PATH^)에 추가되어 있지 않습니다.
    echo  DIMA 서버 구동을 위해 Python이 필수적으로 필요합니다.
    echo  설치 중 'Add Python to PATH' 옵션을 반드시 체크해 주세요.
    echo.
    echo  아무 키나 누르시면 Python 다운로드 페이지로 이동합니다...
    pause >nul
    start https://www.python.org/downloads/
    exit /b
)

echo  [확인] Python 설치가 감지되었습니다.
echo  필수 패키지들을 설치합니다...
python -m pip install --upgrade pip
python -m pip install -r "%~dp0requirements.txt"

echo.
:: 설치 프로세스 및 바로가기 생성 스크립트 실행
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

echo.
echo  설치 프로그램이 완료되었습니다.
echo.
pause
