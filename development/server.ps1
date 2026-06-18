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
    $file = Join-Path $PSScriptRoot $safePath

    if (Test-Path $file -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext   = [System.IO.Path]::GetExtension($file)
        $ct = switch ($ext) {
            '.html' { 'text/html; charset=utf-8' }
            '.css'  { 'text/css' }
            '.js'   { 'application/javascript' }
            '.wasm' { 'application/wasm' }
            '.png'  { 'image/png' }
            '.ico'  { 'image/x-icon' }
            default { 'application/octet-stream' }
        }
        $resp.ContentType   = $ct
        $resp.ContentLength64 = $bytes.Length
        # SharedArrayBuffer (WASM 멀티스레드) 활성화에 필요한 보안 헤더
        $resp.Headers.Add('Cross-Origin-Opener-Policy', 'same-origin')
        $resp.Headers.Add('Cross-Origin-Embedder-Policy', 'require-corp')
        # JS/CSS 파일은 캐시 방지 (개발 중 수정사항 즉시 반영)
        if ($ext -eq '.js' -or $ext -eq '.css' -or $ext -eq '.html') {
            $resp.Headers.Add('Cache-Control', 'no-cache, no-store, must-revalidate')
        }
        $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $resp.StatusCode = 404
    }
    $resp.Close()
}
