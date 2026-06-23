# Builds a per-user Windows installer for DIMA using built-in IExpress.
# Output: DIMA_Setup.exe at the repository root.
param(
    [string]$OutputName = "DIMA_Setup.exe"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$App = Join-Path $Root "app"
$Backend = Join-Path $App "python_backend"
$BuildRoot = Join-Path $Root "build\DIMA_setup_build"
$Stage = Join-Path $BuildRoot "setup_iexpress"
$PayloadDir = Join-Path $Stage "payload"
$PayloadZip = Join-Path $Stage "DIMA_payload.zip"
$InstallerPs1 = Join-Path $Stage "install.ps1"
$InstallerCmd = Join-Path $Stage "install.cmd"
$SedPath = Join-Path $Stage "DIMA_Setup.sed"
$OutputPath = Join-Path $Root $OutputName
$TempOutputPath = Join-Path $BuildRoot $OutputName

function Require-File([string]$Path, [string]$Hint) {
    if (-not (Test-Path $Path)) {
        throw "Missing required file: $Path. Run $Hint first."
    }
}

Require-File (Join-Path $Root "DIMA.exe") "development\compile_exe.ps1"
Require-File (Join-Path $App "server.exe") "development\build-python.ps1"
Require-File (Join-Path $Backend "solve_cli.exe") "development\build-python.ps1"

$iexpress = (Get-Command iexpress.exe -ErrorAction SilentlyContinue).Source
if (-not $iexpress) {
    throw "iexpress.exe was not found. This installer builder requires Windows IExpress."
}

if (Test-Path $BuildRoot) { Remove-Item $BuildRoot -Recurse -Force }
New-Item -ItemType Directory -Path $PayloadDir -Force | Out-Null

Write-Host "[1/4] Staging DIMA runtime..." -ForegroundColor Yellow
Copy-Item (Join-Path $Root "DIMA.exe") $PayloadDir -Force
if (Test-Path (Join-Path $Root "README.txt")) {
    Copy-Item (Join-Path $Root "README.txt") $PayloadDir -Force
}

$PayloadApp = Join-Path $PayloadDir "app"
New-Item -ItemType Directory -Path $PayloadApp -Force | Out-Null
$ExcludeNames = @(".venv", "build", "dist", "__pycache__", ".pytest_cache", ".env", ".dima_port")
Get-ChildItem -Path $App -Force | Where-Object { $ExcludeNames -notcontains $_.Name } | ForEach-Object {
    Copy-Item $_.FullName -Destination $PayloadApp -Recurse -Force
}

Get-ChildItem -Path $PayloadDir -Recurse -Directory -Force |
    Where-Object { $_.Name -in @("__pycache__", ".pytest_cache", "build", "dist") } |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "[2/4] Creating payload archive..." -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $PayloadZip) { Remove-Item $PayloadZip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($PayloadDir, $PayloadZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
exit /b %ERRORLEVEL%
'@ | Set-Content -Path $InstallerCmd -Encoding ASCII

@'
$ErrorActionPreference = "Stop"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\DIMA"
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\DIMA"
$Desktop = [Environment]::GetFolderPath("DesktopDirectory")
$PayloadZip = Join-Path $PSScriptRoot "DIMA_payload.zip"

if (-not (Test-Path $PayloadZip)) {
    [System.Windows.Forms.MessageBox]::Show("DIMA_payload.zip not found.", "DIMA Setup")
    exit 1
}

if (Test-Path $InstallDir) {
    try {
        Get-Process DIMA -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {}
    Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Expand-Archive -Path $PayloadZip -DestinationPath $InstallDir -Force

New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
$Exe = Join-Path $InstallDir "DIMA.exe"
$Shell = New-Object -ComObject WScript.Shell

$StartShortcut = $Shell.CreateShortcut((Join-Path $StartMenuDir "DIMA.lnk"))
$StartShortcut.TargetPath = $Exe
$StartShortcut.WorkingDirectory = $InstallDir
$StartShortcut.IconLocation = $Exe
$StartShortcut.Save()

$DesktopShortcut = $Shell.CreateShortcut((Join-Path $Desktop "DIMA.lnk"))
$DesktopShortcut.TargetPath = $Exe
$DesktopShortcut.WorkingDirectory = $InstallDir
$DesktopShortcut.IconLocation = $Exe
$DesktopShortcut.Save()

[System.Windows.Forms.MessageBox]::Show("DIMA installation complete.`n`nInstalled to:`n$InstallDir", "DIMA Setup")
Start-Process $Exe
'@ | Set-Content -Path $InstallerPs1 -Encoding UTF8

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$TempOutputPath
FriendlyName=DIMA Setup
AppLaunched=install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$Stage
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
[Strings]
FILE0="DIMA_payload.zip"
FILE1="install.cmd"
FILE2="install.ps1"
"@
$sed | Set-Content -Path $SedPath -Encoding ASCII

Write-Host "[3/4] Building setup executable..." -ForegroundColor Yellow
if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
if (Test-Path $TempOutputPath) { Remove-Item $TempOutputPath -Force }
& $iexpress /N /Q $SedPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $TempOutputPath)) {
    throw "IExpress failed to create $TempOutputPath"
}
Move-Item $TempOutputPath $OutputPath -Force

Write-Host "[4/4] Verifying output..." -ForegroundColor Yellow
$item = Get-Item $OutputPath
Write-Host ""
Write-Host "DIMA setup build complete" -ForegroundColor Green
Write-Host ("  File: {0}" -f $item.FullName) -ForegroundColor Cyan
Write-Host ("  Size: {0} MB" -f ([math]::Round($item.Length / 1MB, 1))) -ForegroundColor Cyan
