# =====================================================================
# DIMA 오프라인 배포 패키지 생성
# ---------------------------------------------------------------------
# Python 무설치로 동작하는 완전한 패키지를 만든다. 실행 레이아웃:
#   DIMA.exe                         (루트 진입점)
#   app\                             (정적 파일 + 번들 런타임)
#     index.html, css\, js\, libs\, samples\
#     server.exe                     (Flask — /api/* 프록시 대상)
#     python_backend\solve_cli.exe   (운영 솔버)
#     python_backend\*.py            (python 폴백용 — 선택)
#
# 사전 조건: build-python.ps1 로 번들 exe, compile_exe.ps1 로 DIMA.exe 를 먼저 생성.
# 사용:  development\make_zip.ps1
# =====================================================================
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$App       = Join-Path $Root "app"
$Backend   = Join-Path $App  "python_backend"

# --- 사전 점검: 핵심 산출물이 모두 있어야 동작하는 패키지가 된다 ---
$required = @(
    @{ p = (Join-Path $Root "DIMA.exe");            hint = "development\compile_exe.ps1" },
    @{ p = (Join-Path $App  "server.exe");          hint = "development\build-python.ps1" },
    @{ p = (Join-Path $Backend "solve_cli.exe");    hint = "development\build-python.ps1" }
)
$missing = $false
foreach ($r in $required) {
    if (-not (Test-Path $r.p)) {
        Write-Host "[ERROR] 누락: $($r.p)  → 먼저 실행: $($r.hint)" -ForegroundColor Red
        $missing = $true
    }
}
if ($missing) { exit 1 }

# --- 스테이징 폴더로 복사(개발/캐시 산출물 제외) ---
$stage = Join-Path $env:TEMP ("DIMA_pkg_" + [Guid]::NewGuid().ToString("N").Substring(0,8))
$stageApp = Join-Path $stage "app"
New-Item -ItemType Directory -Path $stageApp -Force | Out-Null

Write-Host "패키지 스테이징 중..." -ForegroundColor Yellow
Copy-Item (Join-Path $Root "DIMA.exe")   $stage -Force
if (Test-Path (Join-Path $Root "README.txt")) { Copy-Item (Join-Path $Root "README.txt") $stage -Force }

# app/ 내용 복사 — 배포에 불필요/민감한 항목은 제외
$exclude = @('.venv', 'dist', 'build', '__pycache__', '.pytest_cache', '.env', '.dima_port')
Get-ChildItem -Path $App -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item $_.FullName -Destination $stageApp -Recurse -Force
}

# python_backend 내부의 개발 산출물도 정리(번들 exe와 .py 만 남기고 캐시/빌드 제거)
$stageBackend = Join-Path $stageApp "python_backend"
foreach ($d in @('__pycache__', '.pytest_cache', 'dist', 'build')) {
    $t = Join-Path $stageBackend $d
    if (Test-Path $t) { Remove-Item $t -Recurse -Force }
}

# --- 압축 ---
# .NET ZipFile/Compress-Archive 는 대상 경로에 한글/@ 등이 있으면 "Illegal characters
# in path" 로 실패할 수 있다. ASCII 인 TEMP 경로에 만든 뒤 최종 위치로 이동한다.
# 파일명은 ASCII로 유지: PS 5.1 이 BOM 없는 스크립트를 ANSI로 읽어 한글 경로 리터럴이
# 깨지면 "Illegal characters in path" 가 발생하기 때문(인코딩 무관 안전).
$dest   = Join-Path $Root "DIMA_offline_package.zip"
$tmpZip = Join-Path $env:TEMP ("DIMA_pkg_" + [Guid]::NewGuid().ToString("N").Substring(0,8) + ".zip")
if (Test-Path $dest) { Remove-Item $dest -Force }
Write-Host "ZIP 압축 중..." -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $tmpZip,
    [System.IO.Compression.CompressionLevel]::Optimal, $false)
Move-Item $tmpZip $dest -Force
Remove-Item $stage -Recurse -Force

$sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host ""
Write-Host "패키지 생성 완료" -ForegroundColor Green
Write-Host "  크기: $sizeMB MB" -ForegroundColor Cyan
Write-Host "  위치: $dest" -ForegroundColor Cyan
Write-Host ""
Write-Host "배포: ZIP 전달 → 압축 해제 → DIMA.exe 더블클릭 (Python 설치 불필요)" -ForegroundColor White
