# Start Sermon Shorts: API (127.0.0.1:18765), worker, and web app (0.0.0.0:3100).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1 [-Dev]
param([switch]$Dev, [int]$ApiPort = 18765, [int]$WebPort = 3100)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$be = Join-Path $root "backend"
$fe = Join-Path $root "frontend"
$py = "$be\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "No Python environment found at backend\.venv. Run scripts\setup.ps1 first." }

$dataDir = "D:/Sermons"
if (Test-Path "$be\.env") {
    $line = Get-Content "$be\.env" | Where-Object { $_ -match '^DATA_DIR=' } | Select-Object -First 1
    if ($line) { $dataDir = $line.Substring(9) }
}
$logs = Join-Path $dataDir "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

& "$PSScriptRoot\stop.ps1" -Quiet

foreach ($port in $ApiPort, $WebPort) {
    $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        $owner = (Get-CimInstance Win32_Process -Filter "ProcessId=$($busy[0].OwningProcess)").CommandLine
        throw "Port $port is already used by another program: $owner`nStop it or run: scripts\start.ps1 -ApiPort <n> -WebPort <n> (a different ApiPort needs BACKEND_URL set when building the frontend)."
    }
}

# Ollama (local LLM). The desktop app usually runs it already.
try { Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 3 | Out-Null }
catch {
    $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    $env:OLLAMA_MODELS = "$dataDir\models\ollama" -replace '/', '\'
    Start-Process -WindowStyle Hidden $ollama -ArgumentList "serve"
    Write-Host "Started Ollama"
}

$pids = @()
$pids += (Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory $be $py `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", $ApiPort `
    -RedirectStandardOutput "$logs\api.log" -RedirectStandardError "$logs\api.err.log").Id
$pids += (Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory $be $py -ArgumentList "-m", "app.worker" `
    -RedirectStandardOutput "$logs\worker.log" -RedirectStandardError "$logs\worker.err.log").Id

$env:BACKEND_URL = "http://127.0.0.1:$ApiPort"
$npmScript = if ($Dev -or -not (Test-Path "$fe\.next\BUILD_ID")) { "dev" } else { "start" }
$pids += (Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory $fe "cmd.exe" `
    -ArgumentList "/c", "npx next $npmScript -H 0.0.0.0 -p $WebPort" `
    -RedirectStandardOutput "$logs\web.log" -RedirectStandardError "$logs\web.err.log").Id
$pids | Set-Content "$logs\pids.txt"

Write-Host "Waiting for the web app..."
for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest "http://127.0.0.1:$WebPort/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 2 }
}
# the LAN address is the one on the adapter that has a default gateway (skips VirtualBox/WSL adapters)
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
       Select-Object -First 1).IPv4Address.IPAddress
Write-Host ""
Write-Host "Sermon Shorts is running" -ForegroundColor Green
Write-Host "  On this laptop:     http://localhost:$WebPort"
if ($ip) { Write-Host "  On your network:    http://${ip}:$WebPort  (allow Node.js through Windows Firewall when asked)" }
Write-Host "  Logs:               $logs"
Write-Host "  Stop:               powershell -ExecutionPolicy Bypass -File scripts\stop.ps1"
