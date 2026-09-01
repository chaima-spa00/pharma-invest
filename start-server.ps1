# Simple PowerShell Static File Server
# Hosts the current directory on http://localhost:8080/

$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host " Pharma SPA Web Server is RUNNING! " -ForegroundColor Green
    Write-Host " Host: http://localhost:$port/ " -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host "Press Ctrl+C in this window to stop the server." -ForegroundColor Yellow
    Write-Host ""
} catch {
    Write-Error "Failed to start server. Port $port might be in use or admin permissions are required: $_"
    exit
}

$currentDir = Get-Location

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath
        if ($path -eq "/") {
            $path = "/index.html"
        }

        # Clean path and combine with current directory
        # Decode URL path (e.g. %20 -> space)
        $decodedPath = [Uri]::UnescapeDataString($path)
        $filePath = [System.IO.Path]::Combine($currentDir, $decodedPath.TrimStart('/'))

        if (Test-Path $filePath -PathType Leaf) {
            $extension = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($extension) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".png"  { $response.ContentType = "image/png" }
                ".jpg"  { $response.ContentType = "image/jpeg" }
                ".jpeg" { $response.ContentType = "image/jpeg" }
                ".gif"  { $response.ContentType = "image/gif" }
                ".svg"  { $response.ContentType = "image/svg+xml" }
                ".ico"  { $response.ContentType = "image/x-icon" }
                default { $response.ContentType = "application/octet-stream" }
            }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $html = "<html><body><h1>404 Not Found</h1><p>File not found: $path</p></body></html>"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
            $response.ContentType = "text/html; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch {
        # Log error to console but keep listening
        Write-Host "Error handling request: $_" -ForegroundColor Red
    } finally {
        if ($null -ne $response) {
            try {
                $response.OutputStream.Close()
            } catch {}
        }
    }
}
