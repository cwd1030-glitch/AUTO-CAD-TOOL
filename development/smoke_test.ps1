# =====================================================================
# DIMA 번들 런타임 스모크 테스트 (헤드리스)
# ---------------------------------------------------------------------
# 빌드 산출물이 실제로 동작하는지 빠르게 검증한다:
#   1) solve_cli.exe  — 운영 솔버가 샘플 STL로 status=success 반환
#   2) server.exe     — Flask /api/analyze 가 status=success 반환
# DIMA.exe(트레이/브라우저)는 띄우지 않으므로 CI/빌드 후 검증에 적합하다.
#
# 사용:  development\smoke_test.ps1
# 종료코드 0 = 통과, 1 = 실패.
# =====================================================================
$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$App       = Join-Path $Root "app"
$Backend   = Join-Path $App  "python_backend"
$Stl       = Join-Path $App  "samples\sample_part.stl"

$fail = 0
Write-Host "=== DIMA Smoke Test ===" -ForegroundColor Cyan

if (-not (Test-Path $Stl)) { Write-Host "[SKIP] sample STL 없음: $Stl" -ForegroundColor Yellow; exit 1 }
$stlBytes = [IO.File]::ReadAllBytes($Stl)

# --- 1) solve_cli.exe ---
$solver = Join-Path $Backend "solve_cli.exe"
if (Test-Path $solver) {
    $gates = Join-Path $env:TEMP "dima_smoke_gates.json"
    [System.IO.File]::WriteAllText($gates, '[{"id":1,"coord":[20,14,6],"speed_factor":1.0}]')
    $out = & $solver --stl $Stl --gates_file $gates --resolution 1.5 --cooling_enabled true --coolant_temp 25 --melt_temp 230 2>$null
    try {
        $j = $out | ConvertFrom-Json
        if ($j.status -eq "success" -and $j.vertex_fill_times.Count -gt 0) {
            Write-Host "[PASS] solve_cli.exe  (fill=$($j.vertex_fill_times.Count), cycle=$([math]::Round([double]$j.cycle_time,1))s)" -ForegroundColor Green
        } else { Write-Host "[FAIL] solve_cli.exe  status=$($j.status) msg=$($j.message)" -ForegroundColor Red; $fail = 1 }
    } catch { Write-Host "[FAIL] solve_cli.exe  비정상 출력" -ForegroundColor Red; $fail = 1 }
} else {
    Write-Host "[FAIL] solve_cli.exe 없음 — build-python.ps1 먼저 실행" -ForegroundColor Red; $fail = 1
}

# --- 2) server.exe (/api/analyze) ---
$server = Join-Path $App "server.exe"
if (Test-Path $server) {
    $port = 5090
    $env:DIMA_FLASK_PORT = "$port"
    $proc = Start-Process -FilePath $server -PassThru -WindowStyle Hidden
    $listening = $false
    for ($i=0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if ($proc.HasExited) { break }
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { $listening = $true; break }
    }
    if ($listening) {
        $b64 = [Convert]::ToBase64String($stlBytes)
        $payload = @{ stl_data=$b64; resolution=1.5; cooling_enabled=$false; melt_temp=230; gates=@(@{id=1;coord=@(20,14,6);speed_factor=1.0}) } | ConvertTo-Json -Depth 5
        try {
            $r = Invoke-RestMethod "http://127.0.0.1:$port/api/analyze" -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 120
            if ($r.status -eq "success") {
                Write-Host "[PASS] server.exe /api/analyze  (fill=$($r.vertex_fill_times.Count))" -ForegroundColor Green
            } else { Write-Host "[FAIL] server.exe /api/analyze  status=$($r.status) msg=$($r.message)" -ForegroundColor Red; $fail = 1 }
        } catch { Write-Host "[FAIL] server.exe 요청 실패: $($_.Exception.Message)" -ForegroundColor Red; $fail = 1 }
    } else {
        Write-Host "[FAIL] server.exe 가 기동되지 않음" -ForegroundColor Red; $fail = 1
    }
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    Remove-Item Env:\DIMA_FLASK_PORT -ErrorAction SilentlyContinue
} else {
    Write-Host "[FAIL] server.exe 없음 — build-python.ps1 먼저 실행" -ForegroundColor Red; $fail = 1
}

Write-Host ""
if ($fail -eq 0) { Write-Host "SMOKE TEST PASSED" -ForegroundColor Green; exit 0 }
else { Write-Host "SMOKE TEST FAILED" -ForegroundColor Red; exit 1 }
