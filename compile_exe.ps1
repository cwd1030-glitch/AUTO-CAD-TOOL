# DIMA.exe Build Script (Built-in HTTP Server)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$csharpCode = @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Collections.Generic;
using System.Runtime.InteropServices;

class DimaTrayApp : ApplicationContext {

    static HttpListener _listener;
    static string       _baseDir;
    static int          _port;
    static Mutex        _mutex;
    NotifyIcon          _tray;

    static readonly Dictionary<string,string> MimeMap =
        new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase) {
        {".html","text/html; charset=utf-8"},{".htm","text/html; charset=utf-8"},
        {".css","text/css"},{".js","application/javascript; charset=utf-8"},
        {".wasm","application/wasm"},{".json","application/json; charset=utf-8"},
        {".png","image/png"},{".jpg","image/jpeg"},{".jpeg","image/jpeg"},
        {".gif","image/gif"},{".ico","image/x-icon"},{".svg","image/svg+xml"},
        {".ttf","font/ttf"},{".woff","font/woff"},{".woff2","font/woff2"},
        {".stl","application/octet-stream"},{".dxf","application/octet-stream"},
        {".stp","application/octet-stream"},{".step","application/octet-stream"},
        {".txt","text/plain; charset=utf-8"}
    };

    [STAThread]
    static void Main() {
        string logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dima_error.log");
        try {
            // --- Single Instance Lock ---
            bool createdNew;
            _mutex = new Mutex(true, "Local\\DIMA_SingleInstance_Mutex", out createdNew);
            if (!createdNew) {
                // Another DIMA is already running – just open browser to it and exit
                // Try to read port file
                string portFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".dima_port");
                if (File.Exists(portFile)) {
                    try {
                        int existingPort = int.Parse(File.ReadAllText(portFile).Trim());
                        OpenBrowserStatic(existingPort);
                        return;
                    } catch { }
                }
                // Fallback: scan ports
                for (int p = 8899; p < 8949; p++) {
                    try {
                        var req = (HttpWebRequest)WebRequest.Create("http://localhost:" + p + "/");
                        req.Timeout = 500;
                        var resp = (HttpWebResponse)req.GetResponse();
                        if (resp.StatusCode == HttpStatusCode.OK) {
                            resp.Close();
                            OpenBrowserStatic(p);
                            return;
                        }
                        resp.Close();
                    } catch { }
                }
                // Could not find existing instance – show message
                MessageBox.Show("DIMA가 이미 실행 중입니다.\n시스템 트레이에서 DIMA 아이콘을 확인해 주세요.",
                                "DIMA", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            _port    = FindFreePort(8899);

            _listener = new HttpListener();
            _listener.Prefixes.Add("http://localhost:" + _port + "/");
            try { _listener.Start(); }
            catch (Exception ex) {
                MessageBox.Show("HTTP 서버를 시작할 수 없습니다.\n" + ex.Message,
                                "DIMA 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ReleaseMutex();
                return;
            }

            // Write port file so other instances can find us
            try {
                File.WriteAllText(Path.Combine(_baseDir, ".dima_port"), _port.ToString());
            } catch { }

            new Thread(ServeLoop) { IsBackground = true, Name = "DIMA-HTTP" }.Start();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DimaTrayApp());

            // Cleanup on exit
            ReleaseMutex();
            try { File.Delete(Path.Combine(_baseDir, ".dima_port")); } catch { }
        }
        catch (Exception ex) {
            try { File.WriteAllText(logFile, DateTime.Now + "\n" + ex.ToString()); } catch { }
            MessageBox.Show("DIMA 실행 오류:\n" + ex.Message, "DIMA Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static void ReleaseMutex() {
        try { _mutex.ReleaseMutex(); } catch { }
        try { _mutex.Dispose(); } catch { }
    }

    static void OpenBrowserStatic(int port) {
        try {
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            if (File.Exists(edgePath)) {
                Process.Start(edgePath, "--app=http://localhost:" + port);
                return;
            }
            string chromePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
            if (!File.Exists(chromePath))
                chromePath = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";
            if (File.Exists(chromePath)) {
                Process.Start(chromePath, "--app=http://localhost:" + port);
                return;
            }
            Process.Start(new ProcessStartInfo {
                FileName        = "http://localhost:" + port,
                UseShellExecute = true
            });
        } catch { }
    }

    DimaTrayApp() {
        Icon appIcon = BuildIcon();

        var menu = new ContextMenuStrip();
        var title = new ToolStripMenuItem("DIMA  v1.0") { Enabled = false };
        title.Font = new Font(title.Font, FontStyle.Bold);
        menu.Items.Add(title);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open in Browser", null, (s, e) => OpenBrowser());
        menu.Items.Add("Clean up CAD processes", null, (s, e) => KillCADProcesses());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (s, e) => Quit());

        _tray = new NotifyIcon {
            Icon             = appIcon,
            Text             = "DIMA | http://localhost:" + _port,
            ContextMenuStrip = menu,
            Visible          = true
        };
        _tray.DoubleClick += (s, e) => OpenBrowser();
        _tray.ShowBalloonTip(3000, "DIMA is running",
            "URL: http://localhost:" + _port + "\nDouble-click to open in browser.",
            ToolTipIcon.Info);

        OpenBrowser();
    }

    static Icon BuildIcon() {
        var bmp = new Bitmap(48, 48);
        using (var g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            var rect = new Rectangle(2, 2, 44, 44);
            using (var brush = new SolidBrush(Color.FromArgb(8, 12, 24)))
                g.FillEllipse(brush, rect);
            using (var pen = new Pen(Color.FromArgb(0, 212, 255), 2.5f))
                g.DrawEllipse(pen, rect);
            using (var font = new Font("Segoe UI", 22, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var brush = new SolidBrush(Color.FromArgb(0, 212, 255))) {
                var sf = new StringFormat {
                    Alignment     = StringAlignment.Center,
                    LineAlignment = StringAlignment.Center
                };
                g.DrawString("D", font, brush, new RectangleF(0, 0, 48, 48), sf);
            }
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    void OpenBrowser() {
        try {
            // Edge 독립 앱 모드 시도
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            if (File.Exists(edgePath)) {
                Process.Start(edgePath, "--app=http://localhost:" + _port);
                return;
            }
            
            // Chrome 독립 앱 모드 시도
            string chromePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
            if (!File.Exists(chromePath)) {
                chromePath = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";
            }
            if (File.Exists(chromePath)) {
                Process.Start(chromePath, "--app=http://localhost:" + _port);
                return;
            }

            // 시스템 패스 직접 시도
            try {
                Process.Start("msedge.exe", "--app=http://localhost:" + _port);
                return;
            } catch { }

            // 기본 브라우저 폴백
            Process.Start(new ProcessStartInfo {
                FileName        = "http://localhost:" + _port,
                UseShellExecute = true
            });
        } catch { }
    }

    void KillCADProcesses() {
        int killed = 0;
        foreach (var p in Process.GetProcessesByName("acad")) {
            try {
                p.Kill();
                killed++;
            } catch { }
        }
        MessageBox.Show("백그라운드 AutoCAD 프로세스 " + killed + "개를 안전하게 정리했습니다.", "DIMA 리소스 정리", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    void Quit() {
        _tray.Visible = false;
        try { _listener.Stop(); } catch { }
        try { File.Delete(Path.Combine(_baseDir, ".dima_port")); } catch { }
        ReleaseMutex();
        ExitThread();
    }

    static int FindFreePort(int start) {
        for (int p = start; p < start + 50; p++) {
            try {
                var t = new TcpListener(IPAddress.Loopback, p);
                t.Start(); t.Stop();
                return p;
            } catch { }
        }
        return start;
    }

    static void ServeLoop() {
        while (_listener.IsListening) {
            HttpListenerContext ctx;
            try { ctx = _listener.GetContext(); }
            catch { break; }
            ThreadPool.QueueUserWorkItem(HandleRequest, ctx);
        }
    }

    static void HandleRequest(object state) {
        var ctx = (HttpListenerContext)state;
        try {
            string urlPath = ctx.Request.Url.LocalPath;

            // DWG -> DXF 변환 POST 요청 처리
            if (ctx.Request.HttpMethod == "POST" && urlPath == "/convert-dwg") {
                try {
                    byte[] dwgBytes;
                    using (var ms = new MemoryStream()) {
                        ctx.Request.InputStream.CopyTo(ms);
                        dwgBytes = ms.ToArray();
                    }

                    string tempDir = Path.Combine(Path.GetTempPath(), "DIMA");
                    if (!Directory.Exists(tempDir)) Directory.CreateDirectory(tempDir);

                    string tempDwg = Path.Combine(tempDir, Guid.NewGuid().ToString() + ".dwg");
                    string tempDxf = Path.Combine(tempDir, Guid.NewGuid().ToString() + ".dxf");

                    File.WriteAllBytes(tempDwg, dwgBytes);

                    // AutoCAD COM 변환 기동
                    ConvertDwgToDxfCOM(tempDwg, tempDxf);

                    if (File.Exists(tempDxf)) {
                        byte[] dxfBytes = File.ReadAllBytes(tempDxf);
                        ctx.Response.ContentType = "text/plain; charset=utf-8";
                        ctx.Response.ContentLength64 = dxfBytes.Length;
                        ctx.Response.Headers["Cache-Control"] = "no-cache";
                        ctx.Response.OutputStream.Write(dxfBytes, 0, dxfBytes.Length);
                        ctx.Response.StatusCode = 200;

                        // 임시 파일 삭제
                        try { File.Delete(tempDwg); File.Delete(tempDxf); } catch { }
                    } else {
                        throw new FileNotFoundException("AutoCAD가 DXF 파일 출력을 생성하지 못했습니다.");
                    }
                }
                catch (Exception ex) {
                    bool missing = ex.Message.Contains("설치 정보를 찾을 수 없습니다") || 
                                   ex.Message.Contains("기동할 수 없습니다") || 
                                   ex.Message.Contains("ProgID");
                    if (missing) {
                        ctx.Response.Headers.Add("X-AutoCAD-Missing", "true");
                    }
                    ctx.Response.StatusCode = 500;
                    string errMsg = "DWG 변환 실패: 로컬 PC에 AutoCAD가 설치되어 있지 않거나 열 수 없습니다.\n" + ex.Message;
                    byte[] errBytes = System.Text.Encoding.UTF8.GetBytes(errMsg);
                    ctx.Response.ContentType = "text/plain; charset=utf-8";
                    ctx.Response.ContentLength64 = errBytes.Length;
                    ctx.Response.OutputStream.Write(errBytes, 0, errBytes.Length);
                }
                ctx.Response.Close();
                return;
            }

            // CAD 백그라운드 프로세스 정리 API
            if (ctx.Request.HttpMethod == "POST" && urlPath == "/cleanup-cad") {
                int killed = 0;
                foreach (var p in Process.GetProcessesByName("acad")) {
                    try {
                        p.Kill();
                        killed++;
                    } catch { }
                }
                ctx.Response.StatusCode = 200;
                byte[] respBytes = System.Text.Encoding.UTF8.GetBytes("Successfully cleaned up " + killed + " acad processes.");
                ctx.Response.ContentType = "text/plain; charset=utf-8";
                ctx.Response.ContentLength64 = respBytes.Length;
                ctx.Response.OutputStream.Write(respBytes, 0, respBytes.Length);
                ctx.Response.Close();
                return;
            }

            if (urlPath == "/" || urlPath == "") urlPath = "/index.html";
            urlPath = urlPath.Replace("..", "").Replace("//", "/");
            string filePath = Path.GetFullPath(
                Path.Combine(_baseDir, urlPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));

            if (!filePath.StartsWith(_baseDir, StringComparison.OrdinalIgnoreCase)) {
                ctx.Response.StatusCode = 403;
                ctx.Response.Close();
                return;
            }

            if (File.Exists(filePath)) {
                byte[] data = File.ReadAllBytes(filePath);
                string ext  = Path.GetExtension(filePath);
                string mime;
                ctx.Response.ContentType     = MimeMap.TryGetValue(ext, out mime) ? mime : "application/octet-stream";
                ctx.Response.ContentLength64 = data.Length;
                ctx.Response.Headers["Cache-Control"] = "no-cache";
                ctx.Response.OutputStream.Write(data, 0, data.Length);
                ctx.Response.StatusCode = 200;
            } else {
                ctx.Response.StatusCode = 404;
            }
        } catch { }
        finally { try { ctx.Response.Close(); } catch { } }
    }

    static void ConvertDwgToDxfCOM(string dwgPath, string dxfPath) {
        Exception threadEx = null;
        Thread t = new Thread(() => {
            dynamic acadApp = null;
            dynamic doc = null;
            bool newlyCreated = false;
            try {
                // 이미 실행 중인 AutoCAD 인스턴스를 가져오기 시도
                try {
                    acadApp = Marshal.GetActiveObject("AutoCAD.Application");
                } catch {
                    // 없으면 새로 인스턴스 생성
                    Type acadType = Type.GetTypeFromProgID("AutoCAD.Application");
                    if (acadType == null) {
                        for (int ver = 25; ver >= 16; ver--) {
                            acadType = Type.GetTypeFromProgID("AutoCAD.Application." + ver);
                            if (acadType != null) break;
                        }
                    }
                    if (acadType == null) {
                        throw new Exception("로컬 컴퓨터의 AutoCAD 레지스트리 설치 정보를 찾을 수 없습니다.");
                    }
                    acadApp = Activator.CreateInstance(acadType, true);
                    newlyCreated = true;
                }

                if (acadApp == null) {
                    throw new Exception("AutoCAD 응용 프로그램을 기동할 수 없습니다.");
                }

                acadApp.Visible = false; // 백그라운드 무음 실행
                dynamic docs = acadApp.Documents;
                doc = docs.Open(dwgPath, true);
                
                // 37: AutoCAD 2018 DXF 포맷
                doc.SaveAs(dxfPath, 37);
                doc.Close(false);
                doc = null;

                if (newlyCreated && acadApp != null) {
                    acadApp.Quit();
                    acadApp = null;
                }
            }
            catch (Exception ex) {
                threadEx = ex;
                try {
                    if (newlyCreated && acadApp != null) {
                        acadApp.Quit();
                    }
                } catch { }
            }
            finally {
                if (doc != null) {
                    try { Marshal.ReleaseComObject(doc); } catch { }
                }
                if (acadApp != null) {
                    try { Marshal.ReleaseComObject(acadApp); } catch { }
                }
            }
        });

        t.Start();
        if (!t.Join(15000)) { // 15초 제한 시간 초과 방지
            try { t.Abort(); } catch { }
            foreach (var p in Process.GetProcessesByName("acad")) {
                try { p.Kill(); } catch { }
            }
            throw new TimeoutException("AutoCAD가 응답하지 않아 변환을 중단했습니다 (15초 제한 시간 초과).");
        }

        if (threadEx != null) {
            throw threadEx;
        }
    }
}
'@

$tempCs    = Join-Path $ScriptDir "_tmp_launcher.cs"
$targetExe = Join-Path $ScriptDir "DIMA.exe"

Write-Host ""
Write-Host "=== DIMA.exe Build ===" -ForegroundColor Cyan

# Write C# source
Write-Host "[1/3] Writing C# source..." -ForegroundColor Yellow
[System.IO.File]::WriteAllText($tempCs, $csharpCode, [System.Text.Encoding]::UTF8)

# Find csc.exe
$cscPaths = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$cscPath = $cscPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $cscPath) {
    Write-Host "[ERROR] csc.exe not found. Install .NET Framework 4.x." -ForegroundColor Red
    Remove-Item $tempCs -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "        Compiler: $cscPath" -ForegroundColor Gray

# Compile
Write-Host "[2/3] Compiling..." -ForegroundColor Yellow
$args2 = @(
    "/target:winexe",
    "/platform:anycpu",
    "/optimize+",
    "/codepage:65001",
    "/out:$targetExe",
    "/reference:System.dll",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Net.dll",
    $tempCs
)
$result = & $cscPath $args2 2>&1
$exitCode = $LASTEXITCODE

# Cleanup temp
Remove-Item $tempCs -ErrorAction SilentlyContinue
Write-Host "[3/3] Cleanup done." -ForegroundColor Yellow

Write-Host ""
if ($exitCode -eq 0 -and (Test-Path $targetExe)) {
    $size = [math]::Round((Get-Item $targetExe).Length / 1KB, 1)
    Write-Host "===============================" -ForegroundColor Green
    Write-Host "  Build SUCCESS: DIMA.exe" -ForegroundColor Green
    Write-Host "  Path : $targetExe" -ForegroundColor Cyan
    Write-Host "  Size : ${size} KB" -ForegroundColor Cyan
    Write-Host "===============================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  - Double-click DIMA.exe to launch" -ForegroundColor White
    Write-Host "  - Built-in HTTP server starts on localhost:8899" -ForegroundColor Gray
    Write-Host "  - Browser opens automatically" -ForegroundColor Gray
    Write-Host "  - Right-click tray icon to exit" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "===============================" -ForegroundColor Red
    Write-Host "  Build FAILED" -ForegroundColor Red
    Write-Host "===============================" -ForegroundColor Red
    $result | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
    exit 1
}
