$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceDir = (Resolve-Path (Join-Path $appDir "..\..")).Path
$pythonPath = Join-Path $workspaceDir "work\chatterbox-env\Scripts\python.exe"
$serverPath = Join-Path $appDir "server.py"
$cacheRoot = Join-Path $workspaceDir "work\huggingface-cache"

$voiceLabPorts = 8765..8771
$voiceLabPids = @()
foreach ($voiceLabPort in $voiceLabPorts) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $voiceLabPort -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $voiceLabPids += $listener.OwningProcess
    }
}

foreach ($voiceLabPid in ($voiceLabPids | Sort-Object -Unique)) {
    Stop-Process -Id $voiceLabPid -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

$env:HF_HOME = $cacheRoot
$env:PKUSEG_HOME = Join-Path $cacheRoot "pkuseg"
$env:TORCH_HOME = Join-Path $cacheRoot "torch"
$env:XDG_CACHE_HOME = $cacheRoot
$env:NUMBA_CACHE_DIR = Join-Path $cacheRoot "numba"
$env:MPLCONFIGDIR = Join-Path $cacheRoot "matplotlib"

Start-Process -FilePath $pythonPath -ArgumentList @("-u", $serverPath) -WorkingDirectory $appDir -WindowStyle Hidden

$ready = $false
foreach ($attempt in 1..30) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:8771/api/status"
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $ready) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Cricket Voice Lab could not restart.", "Cricket Voice Lab") | Out-Null
    exit 1
}

Start-Process "http://127.0.0.1:8771"
