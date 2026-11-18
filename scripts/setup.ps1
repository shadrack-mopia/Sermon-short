# One-time setup for Sermon Shorts. Safe to re-run.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 [-DataDir D:\Sermons]
param([string]$DataDir = "D:\Sermons")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$be = Join-Path $root "backend"
$fe = Join-Path $root "frontend"

Write-Host "== Checking prerequisites" -ForegroundColor Cyan
foreach ($cmd in "python", "node", "npm", "ffmpeg", "ffprobe") {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found on PATH" }
}
$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (-not (Test-Path $ollama)) { throw "Ollama not installed. Install it free from https://ollama.com (or: winget install Ollama.Ollama)" }

Write-Host "== Data folders in $DataDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Force "$DataDir\media", "$DataDir\db", "$DataDir\logs", "$DataDir\models\ollama", "$DataDir\models\whisper" | Out-Null
if ([Environment]::GetEnvironmentVariable("OLLAMA_MODELS", "User") -ne "$DataDir\models\ollama") {
    [Environment]::SetEnvironmentVariable("OLLAMA_MODELS", "$DataDir\models\ollama", "User")
    Write-Host "Set OLLAMA_MODELS for your user. Restart Ollama (tray icon > Quit, then reopen) if it was running."
}

Write-Host "== Python environment" -ForegroundColor Cyan
$py = "$be\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { python -m venv "$be\.venv" }
& $py -m pip install -q --upgrade pip
& $py -m pip install -q --no-cache-dir -r "$be\requirements.txt"

if (-not (Test-Path "$be\.env")) {
    $key = & $py -c "import secrets;print(secrets.token_urlsafe(48))"
    @("DATA_DIR=$($DataDir -replace '\\','/')", "SECRET_KEY=$key") | Set-Content -Encoding utf8 "$be\.env"
    Write-Host "Created backend\.env with a new secret key"
}

Write-Host "== AI models (free, local)" -ForegroundColor Cyan
$env:OLLAMA_MODELS = "$DataDir\models\ollama"
& $ollama pull qwen2.5:7b-instruct
& $ollama pull nomic-embed-text
Write-Host "Whisper (large-v3-turbo) downloads automatically on the first sermon (~1.6 GB)."

Write-Host "== Frontend" -ForegroundColor Cyan
Push-Location $fe
npm install
npm run build
Pop-Location

Write-Host "`nSetup complete. Start the app with:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1" -ForegroundColor Green
