param(
    [switch]$Check,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ports = @(4173, 4175, 4176, 4177)
$node = Get-Command node.exe -ErrorAction SilentlyContinue

function Test-PersonalSite {
    param([int]$Port)

    try {
        $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port" -TimeoutSec 1
        return ($response.Content -match "Xiao Lu")
    } catch {
        return $false
    }
}

function Test-PortBusy {
    param([int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(500, $false)) {
            return $false
        }
        $client.EndConnect($connect)
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

if (-not $node) {
    Write-Host "Node.js was not found. Please install Node.js or add node.exe to PATH." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

if ($Check) {
    Write-Host "Personal portfolio launcher check passed." -ForegroundColor Green
    & $node.Source --version
    exit 0
}

$selectedPort = $null
$alreadyRunning = $false

foreach ($port in $ports) {
    if (Test-PersonalSite -Port $port) {
        $selectedPort = $port
        $alreadyRunning = $true
        break
    }

    if (-not (Test-PortBusy -Port $port)) {
        $selectedPort = $port
        break
    }
}

if (-not $selectedPort) {
    Write-Host "Ports 4173, 4175, 4176 and 4177 are all busy." -ForegroundColor Red
    Write-Host "Close other local site windows or stop the busy node.exe process, then try again."
    Read-Host "Press Enter to close"
    exit 1
}

$url = "http://127.0.0.1:${selectedPort}"

if (-not $NoBrowser) {
    if ($alreadyRunning) {
        Start-Process $url
    } else {
        $openCommand = "Start-Sleep -Seconds 2; Start-Process '$url'"
        Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-Command",
            $openCommand
        )
    }
}

if ($alreadyRunning) {
    Write-Host "Personal portfolio is already running: $url" -ForegroundColor Green
    Write-Host "The browser has been opened. You can close this window."
    Start-Sleep -Seconds 2
    exit 0
}

$env:PORT = [string]$selectedPort
Write-Host "Starting personal portfolio: $url" -ForegroundColor Green
Write-Host "Keep this window open. Closing it will stop the local site service."
Write-Host "Admin, email and analytics features must be used from this URL."
& $node.Source "$PSScriptRoot\server.mjs"

Write-Host "Personal portfolio server has stopped." -ForegroundColor Yellow
Read-Host "Press Enter to close"
