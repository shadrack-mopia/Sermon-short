# Stop Sermon Shorts processes started by start.ps1 (Ollama is left running).
param([switch]$Quiet)
$root = Split-Path $PSScriptRoot -Parent
$be = Join-Path $root "backend"
$dataDir = "D:/Sermons"
if (Test-Path "$be\.env") {
    $line = Get-Content "$be\.env" | Where-Object { $_ -match '^DATA_DIR=' } | Select-Object -First 1
    if ($line) { $dataDir = $line.Substring(9) }
}
$pidFile = Join-Path $dataDir "logs\pids.txt"
$stopped = 0
if (Test-Path $pidFile) {
    foreach ($p in Get-Content $pidFile) {
        if ($p -and (Get-Process -Id $p -ErrorAction SilentlyContinue)) {
            taskkill /F /T /PID $p 2>&1 | Out-Null   # /T also stops child processes (python, node)
            $stopped++
        }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}
if (-not $Quiet) { Write-Host "Stopped $stopped process tree(s)." }
