# DIMA Windows Installer (setup.ps1)
# Installs DIMA as a desktop application and creates shortcuts on the Desktop and Start Menu.

$ErrorActionPreference = "Stop"
$InstallName = "DIMA"
$LocalPrograms = Join-Path $env:LOCALAPPDATA "Programs"
$InstallDir = Join-Path $LocalPrograms $InstallName
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   DIMA (Design Intelligence AI) Install" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 0. Kill existing DIMA processes
Write-Host "[0/5] Stopping existing DIMA processes..." -ForegroundColor Yellow
$procs = Get-Process -Name "DIMA" -ErrorAction SilentlyContinue
if ($procs) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "      Stopped $($procs.Count) DIMA process(es)." -ForegroundColor Gray
} else {
    Write-Host "      No existing DIMA processes found." -ForegroundColor Gray
}

# 1. Compile DIMA.exe to make sure it is updated
Write-Host "[1/5] Compiling DIMA.exe to ensure latest version..." -ForegroundColor Yellow
$ExePath = Join-Path $ScriptDir "DIMA.exe"
$compileScript = Join-Path $ScriptDir "compile_exe.ps1"
if (Test-Path $compileScript) {
    if (Test-Path $ExePath) {
        Remove-Item $ExePath -Force -ErrorAction SilentlyContinue
    }
    & $compileScript
    if (-not (Test-Path $ExePath)) {
        Write-Host "[ERROR] Failed to compile DIMA.exe. Please check .NET Framework installation." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "[ERROR] compile_exe.ps1 not found." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "      DIMA.exe ready ($([math]::Round((Get-Item $ExePath).Length / 1KB, 1)) KB)" -ForegroundColor Gray

# 2. Setup install folder
Write-Host "[2/5] Configuring installation directory..." -ForegroundColor Yellow
if (Test-Path $InstallDir) {
    Write-Host "      Removing existing installation..." -ForegroundColor Gray
    Remove-Item -Path $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Write-Host "      Install Path: $InstallDir" -ForegroundColor Gray

# 3. Copy files
Write-Host "[3/5] Copying files..." -ForegroundColor Yellow
$CopyTargets = @("DIMA.exe")
$CopyFolders = @("app")

$copiedCount = 0
foreach ($file in $CopyTargets) {
    $srcPath = Join-Path $ScriptDir $file
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $InstallDir -Force
        $copiedCount++
        Write-Host "      Copied: $file" -ForegroundColor Gray
    } else {
        Write-Host "      [SKIP] $file not found" -ForegroundColor DarkYellow
    }
}
foreach ($folder in $CopyFolders) {
    $srcFolder = Join-Path $ScriptDir $folder
    if (Test-Path $srcFolder) {
        $dest = Join-Path $InstallDir $folder
        Copy-Item -Path $srcFolder -Destination $dest -Recurse -Force
        $copiedCount++
        Write-Host "      Copied folder: $folder/" -ForegroundColor Gray
    } else {
        Write-Host "      [SKIP] $folder/ not found" -ForegroundColor DarkYellow
    }
}
Write-Host "      Total: $copiedCount items copied." -ForegroundColor Gray

# 4. Create shortcuts
Write-Host "[4/5] Creating shortcuts..." -ForegroundColor Yellow
$WshShell = New-Object -ComObject WScript.Shell

# Desktop shortcut
$DesktopPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), "DIMA.lnk")
$Shortcut = $WshShell.CreateShortcut($DesktopPath)
$Shortcut.TargetPath = Join-Path $InstallDir "DIMA.exe"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "DIMA CAD - Design Intelligence AI Platform"
$Shortcut.Save()
Write-Host "      Created Desktop shortcut: DIMA" -ForegroundColor Gray

# Start Menu shortcut
$StartMenuDir = [System.IO.Path]::Combine([Environment]::GetFolderPath("Programs"), $InstallName)
if (-not (Test-Path $StartMenuDir)) {
    New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
}
$StartMenuPath = Join-Path $StartMenuDir "DIMA.lnk"
$ShortcutStart = $WshShell.CreateShortcut($StartMenuPath)
$ShortcutStart.TargetPath = Join-Path $InstallDir "DIMA.exe"
$ShortcutStart.WorkingDirectory = $InstallDir
$ShortcutStart.Description = "DIMA CAD - Design Intelligence AI Platform"
$ShortcutStart.Save()
Write-Host "      Added to Start Menu: DIMA" -ForegroundColor Gray

# 5. Write Uninstall script
Write-Host "[5/5] Creating uninstaller..." -ForegroundColor Yellow
$UninstallScript = @"
`$ErrorActionPreference = "Stop"
Write-Host "=========================================" -ForegroundColor Red
Write-Host "   Uninstalling DIMA..." -ForegroundColor Red
Write-Host "=========================================" -ForegroundColor Red
`$InstallDir = "$InstallDir"
`$DesktopLink = "$DesktopPath"
`$StartMenuLinkDir = "$StartMenuDir"

# Stop DIMA process if running
Get-Process -Name "DIMA" -ErrorAction SilentlyContinue | Stop-Process -Force

# Delete folders and files
if (Test-Path `$InstallDir) {
    Remove-Item -Path `$InstallDir -Recurse -Force
    Write-Host "Removed application files." -ForegroundColor Gray
}
if (Test-Path `$DesktopLink) {
    Remove-Item `$DesktopLink -Force
    Write-Host "Removed Desktop shortcut." -ForegroundColor Gray
}
if (Test-Path `$StartMenuLinkDir) {
    Remove-Item `$StartMenuLinkDir -Recurse -Force
    Write-Host "Removed Start Menu shortcuts." -ForegroundColor Gray
}

Write-Host "DIMA has been successfully uninstalled." -ForegroundColor Green
Read-Host "Press Enter to close this window"
"@

$UninstallPath = Join-Path $InstallDir "uninstall.ps1"
$UninstallScript | Out-File -FilePath $UninstallPath -Encoding utf8 -Force

# Create uninstaller batch helper
$UninstallBat = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0uninstall.ps1`"`r`n"
$UninstallBatPath = Join-Path $InstallDir "DIMA_Uninstaller.bat"
$UninstallBat | Out-File -FilePath $UninstallBatPath -Encoding ascii -Force

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "   DIMA 설치 완료! (Installation Complete)" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  바탕화면의 'DIMA' 아이콘을 더블클릭하여 실행하세요." -ForegroundColor White
Write-Host "  (Double-click 'DIMA' on your Desktop to launch)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Install Path : $InstallDir" -ForegroundColor Gray
Write-Host "  Uninstaller  : $InstallDir\DIMA_Uninstaller.bat" -ForegroundColor Gray
Write-Host ""

# Ask if user wants to launch now
$launch = Read-Host "지금 DIMA를 실행하시겠습니까? (Launch DIMA now?) [Y/n]"
if ($launch -ne "n" -and $launch -ne "N") {
    Write-Host "DIMA를 실행합니다..." -ForegroundColor Cyan
    Start-Process (Join-Path $InstallDir "DIMA.exe")
}
