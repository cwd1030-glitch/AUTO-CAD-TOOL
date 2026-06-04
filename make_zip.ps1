$paths = @(
    "$PSScriptRoot\index.html",
    "$PSScriptRoot\README.txt",
    "$PSScriptRoot\css",
    "$PSScriptRoot\js",
    "$PSScriptRoot\libs",
    "$PSScriptRoot\samples"
)

$batFile = "$PSScriptRoot\▶ DIMA 실행.bat"
$dest    = "$PSScriptRoot\DIMA_오프라인패키지.zip"

# BAT 파일 포함
$paths += $batFile

Write-Host "ZIP 패키지 생성 중..." -ForegroundColor Yellow

Compress-Archive -Path $paths -DestinationPath $dest -Force

$sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host ""
Write-Host "✅ ZIP 생성 완료!" -ForegroundColor Green
Write-Host "   크기: $sizeMB MB" -ForegroundColor Cyan
Write-Host "   위치: $dest" -ForegroundColor Cyan
Write-Host ""
Write-Host "배포 방법:" -ForegroundColor White
Write-Host "  1. ZIP 파일을 USB/이메일/드라이브로 전달" -ForegroundColor Gray
Write-Host "  2. 압축 해제 후 '▶ DIMA 실행.bat' 더블클릭" -ForegroundColor Gray
