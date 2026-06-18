# build-python.ps1 — Python 솔버/서버를 무설치 단독 exe 로 번들 (Windows)
# 실행:  powershell -ExecutionPolicy Bypass -File build-python.ps1
# 결과:  src-tauri\bin\solve_cli.exe  (+ 선택: server.exe)
#
# 이 단계를 먼저 실행한 뒤 `npm run build` 하면, 대상 PC 에 Python 설치 없이
# 동작하는 설치 프로그램이 만들어진다.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app  = Resolve-Path (Join-Path $root "..\app")
$bin  = Join-Path $root "src-tauri\bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

Write-Host "==> Python 의존성 및 PyInstaller 설치" -ForegroundColor Cyan
python -m pip install --upgrade pip pyinstaller
python -m pip install -r (Join-Path $app "requirements.txt")

Write-Host "==> solve_cli 번들 (필수: 오프라인 코어 솔버)" -ForegroundColor Cyan
Push-Location (Join-Path $app "python_backend")
pyinstaller --noconfirm --clean solve_cli.spec
Copy-Item ".\dist\solve_cli.exe" (Join-Path $bin "solve_cli.exe") -Force
Pop-Location

Write-Host "==> server 번들 (선택: 멀티-AI 리뷰 등 온라인 기능)" -ForegroundColor Cyan
try {
    Push-Location $app
    pyinstaller --noconfirm --clean server.spec
    Copy-Item ".\dist\server.exe" (Join-Path $bin "server.exe") -Force
    Pop-Location
} catch {
    Write-Warning "server.exe 번들 생략(선택 사항): $_"
}

Write-Host "`n✅ Python 번들 완료 → $bin" -ForegroundColor Green
Get-ChildItem $bin | Format-Table Name, Length
