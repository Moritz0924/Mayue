param(
  [switch]$NoBrowser,
  [switch]$NoInstall
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[Mayue Demo] $Message" -ForegroundColor Cyan
}

function Test-Cmd {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-UrlReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSec = 60
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

function Ensure-NpmDeps {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectDir,
    [switch]$SkipInstall
  )

  $nodeModules = Join-Path $ProjectDir "node_modules"
  if (Test-Path $nodeModules) {
    return
  }

  if ($SkipInstall) {
    throw "node_modules missing in '$ProjectDir' and -NoInstall was specified."
  }

  Write-Step "Installing dependencies: $ProjectDir"
  & npm install --prefix $ProjectDir
}

function Start-Backend {
  param([string]$BackendDir)
  Write-Step "Starting backend dev server..."
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/k", "cd /d `"$BackendDir`" && set PYTHON_BIN=python && npm run dev" `
    -WorkingDirectory $BackendDir
}

function Start-Frontend {
  param([string]$FrontendDir)
  Write-Step "Starting frontend dev server..."
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/k", "cd /d `"$FrontendDir`" && npm run dev" `
    -WorkingDirectory $FrontendDir
}

$root = $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

if (-not (Test-Path $backendDir)) {
  throw "Backend directory not found: $backendDir"
}
if (-not (Test-Path $frontendDir)) {
  throw "Frontend directory not found: $frontendDir"
}

if (-not (Test-Cmd "node")) {
  throw "node is not installed or not in PATH."
}
if (-not (Test-Cmd "npm")) {
  throw "npm is not installed or not in PATH."
}

Ensure-NpmDeps -ProjectDir $backendDir -SkipInstall:$NoInstall
Ensure-NpmDeps -ProjectDir $frontendDir -SkipInstall:$NoInstall

$backendReady = Test-UrlReady -Url "http://localhost:8000/healthz" -TimeoutSec 2
if (-not $backendReady) {
  Start-Backend -BackendDir $backendDir
} else {
  Write-Step "Backend already running at http://localhost:8000"
}

$frontendReady = Test-UrlReady -Url "http://localhost:5173" -TimeoutSec 2
if (-not $frontendReady) {
  Start-Frontend -FrontendDir $frontendDir
} else {
  Write-Step "Frontend already running at http://localhost:5173"
}

Write-Step "Waiting for backend health endpoint..."
if (-not (Test-UrlReady -Url "http://localhost:8000/healthz" -TimeoutSec 90)) {
  throw "Backend did not become ready within 90 seconds."
}

Write-Step "Waiting for frontend dev server..."
if (-not (Test-UrlReady -Url "http://localhost:5173" -TimeoutSec 90)) {
  throw "Frontend did not become ready within 90 seconds."
}

Write-Step "Demo is ready."
Write-Host "  Frontend:   http://localhost:5173" -ForegroundColor Green
Write-Host "  Health:     http://localhost:8000/healthz" -ForegroundColor Green
Write-Host "  Twin 3D:    http://localhost:8000/demo/twin-demo.html" -ForegroundColor Green

if (-not $NoBrowser) {
  Start-Process "http://localhost:5173"
  Start-Process "http://localhost:8000/demo/twin-demo.html"
}

