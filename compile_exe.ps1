# DIMA.exe 빌드 스크립트
$ErrorActionPreference = "Stop"

$csharpCode = @'
using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;

class Program {
    [STAThread]
    static void Main() {
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string htmlPath = Path.Combine(appDir, "index.html");

        if (!File.Exists(htmlPath)) {
            MessageBox.Show("index.html not found.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string fileUri = new Uri(htmlPath).AbsoluteUri;

        string chromePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe");
        string chromePathx86 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe");
        string edgePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");

        string browserPath = "";
        if (File.Exists(chromePath)) {
            browserPath = chromePath;
        } else if (File.Exists(chromePathx86)) {
            browserPath = chromePathx86;
        } else if (File.Exists(edgePath)) {
            browserPath = edgePath;
        }

        if (string.IsNullOrEmpty(browserPath)) {
            try {
                Process.Start(fileUri);
            } catch (Exception ex) {
                MessageBox.Show("Failed to open browser: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return;
        }

        string tempProfile = Path.Combine(Path.GetTempPath(), "DIMA_AppProfile");
        string args = string.Format("--app=\"{0}\" --allow-file-access-from-files --user-data-dir=\"{1}\" --disk-cache-size=0 --disable-application-cache", fileUri, tempProfile);

        try {
            Process.Start(browserPath, args);
        } catch (Exception ex) {
            MessageBox.Show("Failed to launch DIMA: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
'@

# 임시 C# 소스 파일 쓰기
$tempCsFile = Join-Path $PSScriptRoot "launcher.cs"
$targetExeFile = Join-Path $PSScriptRoot "DIMA.exe"

Write-Host "1. 임시 C# 소스 작성 중..." -ForegroundColor Yellow
Set-Content -Path $tempCsFile -Value $csharpCode -Encoding UTF8

# csc.exe 경로 설정
$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $cscPath)) {
    $cscPath = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $cscPath)) {
    throw "Windows C# 컴파일러(csc.exe)를 찾을 수 없습니다. .NET Framework가 설치되어 있는지 확인해 주세요."
}

Write-Host "2. DIMA.exe 컴파일 시작..." -ForegroundColor Yellow
$compileArgs = @(
    "/target:winexe",
    "/out:$targetExeFile",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.dll",
    $tempCsFile
)

& $cscPath $compileArgs

if (Test-Path $targetExeFile) {
    Write-Host "✅ DIMA.exe 컴파일 성공!" -ForegroundColor Green
    Write-Host "위치: $targetExeFile" -ForegroundColor Cyan
} else {
    throw "컴파일은 완료되었으나 DIMA.exe가 생성되지 않았습니다."
}

# 임시 파일 삭제
if (Test-Path $tempCsFile) {
    Remove-Item $tempCsFile
    Write-Host "3. 임시 파일 정리 완료." -ForegroundColor Gray
}
