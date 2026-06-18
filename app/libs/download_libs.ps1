# 라이브러리 다운로드 스크립트
$libs = @(
    @{ url = "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js";                          out = "three.min.js" },
    @{ url = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js";       out = "OrbitControls.js" },
    @{ url = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/STLLoader.js";            out = "STLLoader.js" },
    @{ url = "https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js";                          out = "chart.min.js" }
)

$dest = "c:\Users\mecha\PROJECT\AUTO_CAD_TOOL\libs"

foreach ($lib in $libs) {
    $target = Join-Path $dest $lib.out
    Write-Host "다운로드 중: $($lib.out) ..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri $lib.url -OutFile $target -UseBasicParsing -TimeoutSec 30
        $size = (Get-Item $target).Length
        Write-Host "  완료: $($lib.out) ($([math]::Round($size/1024,1)) KB)" -ForegroundColor Green
    } catch {
        Write-Host "  실패: $($lib.out) - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "모든 라이브러리 다운로드 완료!" -ForegroundColor Cyan
Write-Host "저장 위치: $dest" -ForegroundColor Cyan
