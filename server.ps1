Add-Type -AssemblyName System.Net
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8899/')
$listener.Start()
Write-Host 'DIMA Server running at http://localhost:8899' -ForegroundColor Cyan

while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response

    $url = $req.Url.LocalPath
    if ($url -eq '/') { $url = '/index.html' }

    $safePath = $url -replace '/', '\'
    $file = "c:\Users\mecha\PROJECT\AUTO_CAD_TOOL" + $safePath

    if (Test-Path $file -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext   = [System.IO.Path]::GetExtension($file)
        $ct = switch ($ext) {
            '.html' { 'text/html; charset=utf-8' }
            '.css'  { 'text/css' }
            '.js'   { 'application/javascript' }
            '.png'  { 'image/png' }
            '.ico'  { 'image/x-icon' }
            default { 'application/octet-stream' }
        }
        $resp.ContentType   = $ct
        $resp.ContentLength64 = $bytes.Length
        $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $resp.StatusCode = 404
    }
    $resp.Close()
}
