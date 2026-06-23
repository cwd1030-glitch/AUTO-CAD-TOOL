# Builds a single-file DIMA_Setup.exe installer.
# The installer is a C# stub with DIMA_payload.zip appended to the end.
param(
    [string]$OutputName = "DIMA_Setup.exe"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$App = Join-Path $Root "app"
$Backend = Join-Path $App "python_backend"
$BuildRoot = Join-Path $Root "build\DIMA_setup_selfextract"
$PayloadDir = Join-Path $BuildRoot "payload"
$PayloadZip = Join-Path $BuildRoot "DIMA_payload.zip"
$StubCs = Join-Path $BuildRoot "DimaSetupStub.cs"
$StubExe = Join-Path $BuildRoot "DimaSetupStub.exe"
$OutputPath = Join-Path $Root $OutputName
$Marker = "DIMA_PAYLOAD_V1"

function Require-File([string]$Path, [string]$Hint) {
    if (-not (Test-Path $Path)) {
        throw "Missing required file: $Path. Run $Hint first."
    }
}

Require-File (Join-Path $Root "DIMA.exe") "development\compile_exe.ps1"
Require-File (Join-Path $App "server.exe") "development\build-python.ps1"
Require-File (Join-Path $Backend "solve_cli.exe") "development\build-python.ps1"

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
Require-File $csc ".NET Framework C# compiler installation"

if (Test-Path $BuildRoot) { Remove-Item $BuildRoot -Recurse -Force }
New-Item -ItemType Directory -Path $PayloadDir -Force | Out-Null

Write-Host "[1/5] Staging DIMA runtime..." -ForegroundColor Yellow
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

Write-Host "[2/5] Creating payload archive..." -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($PayloadDir, $PayloadZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$stub = @'
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

class DimaSetup {
    const string Marker = "DIMA_PAYLOAD_V1";
    const int LengthDigits = 20;

    [STAThread]
    static int Main() {
        try {
            string exePath = Assembly.GetExecutingAssembly().Location;
            string tempZip = Path.Combine(Path.GetTempPath(), "DIMA_payload_" + Guid.NewGuid().ToString("N") + ".zip");
            ExtractPayload(exePath, tempZip);

            string setupDir = Path.GetDirectoryName(exePath);
            string installDir = Path.Combine(setupDir, "DIMA_Installed");

            try {
                foreach (var p in Process.GetProcessesByName("DIMA")) {
                    try { p.Kill(); p.WaitForExit(3000); } catch {}
                }
            } catch {}

            if (Directory.Exists(installDir)) Directory.Delete(installDir, true);
            Directory.CreateDirectory(installDir);
            ZipFile.ExtractToDirectory(tempZip, installDir);
            try { File.Delete(tempZip); } catch {}

            string appExe = Path.Combine(installDir, "DIMA.exe");
            string startMenuDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Microsoft", "Windows", "Start Menu", "Programs", "DIMA");
            Directory.CreateDirectory(startMenuDir);
            CreateShortcut(Path.Combine(startMenuDir, "DIMA.lnk"), appExe, installDir);
            CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "DIMA.lnk"), appExe, installDir);

            MessageBox.Show("DIMA installation complete.\n\nInstalled to:\n" + installDir, "DIMA Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Process.Start(appExe);
            return 0;
        } catch (Exception ex) {
            MessageBox.Show("DIMA installation failed:\n" + ex.Message, "DIMA Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static void ExtractPayload(string exePath, string tempZip) {
        byte[] markerBytes = Encoding.ASCII.GetBytes(Marker);
        int trailerLen = markerBytes.Length + LengthDigits;
        using (FileStream input = File.OpenRead(exePath)) {
            if (input.Length < trailerLen) throw new Exception("Installer payload is missing.");
            input.Seek(-trailerLen, SeekOrigin.End);
            byte[] trailer = new byte[trailerLen];
            ReadExactly(input, trailer, 0, trailer.Length);
            string marker = Encoding.ASCII.GetString(trailer, 0, markerBytes.Length);
            if (marker != Marker) throw new Exception("Installer payload marker was not found.");
            string lenText = Encoding.ASCII.GetString(trailer, markerBytes.Length, LengthDigits);
            long payloadLen = long.Parse(lenText);
            long payloadStart = input.Length - trailerLen - payloadLen;
            if (payloadStart < 0) throw new Exception("Installer payload length is invalid.");

            input.Seek(payloadStart, SeekOrigin.Begin);
            using (FileStream output = File.Create(tempZip)) {
                byte[] buffer = new byte[1024 * 1024];
                long remaining = payloadLen;
                while (remaining > 0) {
                    int read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                    if (read <= 0) throw new EndOfStreamException();
                    output.Write(buffer, 0, read);
                    remaining -= read;
                }
            }
        }
    }

    static void ReadExactly(Stream s, byte[] buffer, int offset, int count) {
        while (count > 0) {
            int read = s.Read(buffer, offset, count);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
            count -= read;
        }
    }

    static void CreateShortcut(string shortcutPath, string targetPath, string workingDir) {
        try {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        } catch {
            string cmdPath = Path.ChangeExtension(shortcutPath, ".cmd");
            File.WriteAllText(cmdPath, "@echo off\r\nstart \"\" \"" + targetPath + "\"\r\n", Encoding.ASCII);
        }
    }
}
'@
$stub | Set-Content -Path $StubCs -Encoding UTF8

Write-Host "[3/5] Compiling setup stub..." -ForegroundColor Yellow
& $csc /nologo /target:winexe /platform:x86 /out:$StubExe /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll $StubCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $StubExe)) {
    throw "Failed to compile setup stub."
}

Write-Host "[4/5] Appending payload..." -ForegroundColor Yellow
if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
Copy-Item $StubExe $OutputPath -Force
$payloadLength = (Get-Item $PayloadZip).Length
$lengthText = $payloadLength.ToString().PadLeft(20, "0")
$markerBytes = [System.Text.Encoding]::ASCII.GetBytes($Marker + $lengthText)

$outStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
try {
    $inStream = [System.IO.File]::OpenRead($PayloadZip)
    try {
        $buffer = New-Object byte[] (1024 * 1024)
        while (($read = $inStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $outStream.Write($buffer, 0, $read)
        }
    } finally {
        $inStream.Dispose()
    }
    $outStream.Write($markerBytes, 0, $markerBytes.Length)
} finally {
    $outStream.Dispose()
}

Write-Host "[5/5] Verifying setup file..." -ForegroundColor Yellow
$item = Get-Item $OutputPath
Write-Host ""
Write-Host "DIMA setup build complete" -ForegroundColor Green
Write-Host ("  File: {0}" -f $item.FullName) -ForegroundColor Cyan
Write-Host ("  Size: {0} MB" -f ([math]::Round($item.Length / 1MB, 1))) -ForegroundColor Cyan
