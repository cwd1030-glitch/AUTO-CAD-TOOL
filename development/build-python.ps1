# =====================================================================
# DIMA Python 번들 빌드 스크립트
# ---------------------------------------------------------------------
# solve_cli.exe (운영 솔버)  +  server.exe (Flask AI/검증 서버) 를
# PyInstaller 로 단독 실행 파일(무설치)로 빌드한다.
# 빌드 전 솔버 회귀 테스트(pytest)를 게이트로 실행 — 실패 시 빌드 중단.
#
# 산출 배치:
#   app/python_backend/solve_cli.exe   (C# 런처가 우선 호출)
#   app/server.exe                     (C# 런처가 우선 기동)
#
# 사용:  development\build-python.ps1            (테스트+빌드)
#        development\build-python.ps1 -SkipTests (테스트 생략, 비권장)
# =====================================================================
param(
    [switch]$SkipTests
)
# PyInstaller/pytest emit INFO logs on stderr; under "Stop" PowerShell 5.1 turns
# that into a terminating NativeCommandError. We rely on explicit $LASTEXITCODE
# and Test-Path checks below for success detection instead.
$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$App       = Join-Path $Root "app"
$Backend   = Join-Path $App  "python_backend"

Write-Host ""
Write-Host "=== DIMA Python Bundle Build ===" -ForegroundColor Cyan

# --- 1. Python 인터프리터 결정 (venv 우선) ---
$venvPy = Join-Path $App ".venv\Scripts\python.exe"
if (Test-Path $venvPy) {
    $py = $venvPy
    Write-Host "[py] venv: $py" -ForegroundColor Gray
} else {
    $py = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $py) {
        Write-Host "[ERROR] Python을 찾을 수 없습니다. app\.venv 를 만들거나 Python을 설치하세요." -ForegroundColor Red
        Write-Host "        py -m venv app\.venv; app\.venv\Scripts\python -m pip install -r app\requirements.txt pyinstaller pytest" -ForegroundColor DarkGray
        exit 1
    }
    Write-Host "[py] system: $py" -ForegroundColor Yellow
}

# --- 1b. 실행 중인 번들 프로세스 종료 ---
# server.exe / solve_cli.exe 가 실행 중이면 산출물 파일이 잠겨 Copy-Item 이 조용히
# 실패하고 구버전 exe 가 남는다(디버깅을 크게 헷갈리게 함). 빌드 전에 정리한다.
foreach ($pname in @('server', 'solve_cli')) {
    Get-Process $pname -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

# --- 2. 회귀 테스트 게이트 ---
if (-not $SkipTests) {
    Write-Host "[1/4] Running solver regression tests..." -ForegroundColor Yellow
    Push-Location $Backend
    & $py -m pytest test_solvers.py -q
    $testExit = $LASTEXITCODE
    Pop-Location
    if ($testExit -ne 0) {
        Write-Host "[ERROR] 테스트 실패 — 빌드를 중단합니다. (회귀 가능성)" -ForegroundColor Red
        exit 1
    }
    Write-Host "        Tests passed." -ForegroundColor Green
} else {
    Write-Host "[1/4] Tests SKIPPED (-SkipTests)" -ForegroundColor DarkYellow
}

# --- 3. solve_cli.exe 빌드 ---
Write-Host "[2/4] Building solve_cli.exe (operational solver)..." -ForegroundColor Yellow
Push-Location $Backend
& $py -m PyInstaller --noconfirm --clean solve_cli.spec
$b1 = $LASTEXITCODE
Pop-Location
if ($b1 -ne 0 -or -not (Test-Path (Join-Path $Backend "dist\solve_cli.exe"))) {
    Write-Host "[ERROR] solve_cli.exe 빌드 실패" -ForegroundColor Red
    exit 1
}
Copy-Item (Join-Path $Backend "dist\solve_cli.exe") (Join-Path $Backend "solve_cli.exe") -Force
Write-Host "        -> app\python_backend\solve_cli.exe" -ForegroundColor Green

# --- 4. server.exe 빌드 ---
Write-Host "[3/4] Building server.exe (Flask AI/validation server)..." -ForegroundColor Yellow
Push-Location $App
& $py -m PyInstaller --noconfirm --clean server.spec
$b2 = $LASTEXITCODE
Pop-Location
if ($b2 -ne 0 -or -not (Test-Path (Join-Path $App "dist\server.exe"))) {
    Write-Host "[ERROR] server.exe 빌드 실패" -ForegroundColor Red
    exit 1
}
Copy-Item (Join-Path $App "dist\server.exe") (Join-Path $App "server.exe") -Force
Write-Host "        -> app\server.exe" -ForegroundColor Green

Write-Host "[4/4] Smoke-testing bundled runtime..." -ForegroundColor Yellow
& (Join-Path $ScriptDir "smoke_test.ps1")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] 스모크 테스트 실패 — 번들이 정상 동작하지 않습니다." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "===============================" -ForegroundColor Green
Write-Host "  Bundle build SUCCESS" -ForegroundColor Green
Write-Host "  solve_cli.exe : $([math]::Round((Get-Item (Join-Path $Backend 'solve_cli.exe')).Length/1MB,1)) MB" -ForegroundColor Cyan
Write-Host "  server.exe    : $([math]::Round((Get-Item (Join-Path $App 'server.exe')).Length/1MB,1)) MB" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Green
Write-Host "  다음: development\compile_exe.ps1 로 DIMA.exe 빌드" -ForegroundColor White
Write-Host ""
