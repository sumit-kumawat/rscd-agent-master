# RSCD Manager — Windows VM production deploy (portal :80, API :81)
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path '.env')) {
    if (Test-Path '.env.windows.example') {
        Copy-Item '.env.windows.example' '.env'
        Write-Host 'Created .env from .env.windows.example — edit credentials, then re-run.' -ForegroundColor Yellow
        exit 1
    }
    Write-Host 'ERROR: .env missing. Copy .env.windows.example to .env' -ForegroundColor Red
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host 'ERROR: Docker not found. Install Docker Desktop for Windows and enable Linux containers.' -ForegroundColor Red
    exit 1
}

$dockerInfo = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: Docker daemon not running. Start Docker Desktop.' -ForegroundColor Red
    exit 1
}

Write-Host '==> Building frontend (API port 81)' -ForegroundColor Cyan
Set-Location (Join-Path $Root 'frontend')
if (Test-Path 'package-lock.json') { npm ci } else { npm install }
$env:VITE_BACKEND_PORT = '81'
npm run build
Set-Location $Root

if (-not (Test-Path 'backend\public\index.html')) {
    Write-Host 'ERROR: frontend build did not produce backend\public\index.html' -ForegroundColor Red
    exit 1
}

Write-Host '==> Building Docker images' -ForegroundColor Cyan
$env:DOCKER_BUILDKIT = '1'
docker compose -f docker-compose.windows.yml build app

Write-Host '==> Starting stack (restart unless-stopped)' -ForegroundColor Cyan
docker compose -f docker-compose.windows.yml up -d

Write-Host '==> Waiting for API health on port 81' -ForegroundColor Cyan
$ok = $false
for ($i = 1; $i -le 40; $i++) {
    try {
        $r = Invoke-RestMethod -Uri 'http://localhost:81/health' -TimeoutSec 5
        if ($r.status -eq 'ok') { $ok = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}

docker compose -f docker-compose.windows.yml ps
if ($ok) {
    Write-Host ''
    Write-Host 'Deploy complete:' -ForegroundColor Green
    Write-Host '  Portal (UI):  http://localhost/' -ForegroundColor Green
    Write-Host '  API / health: http://localhost:81/health' -ForegroundColor Green
    Write-Host '  Logs: docker compose -f docker-compose.windows.yml logs -f app' -ForegroundColor Gray
} else {
    Write-Host 'WARNING: API health not ready — check: docker compose -f docker-compose.windows.yml logs app' -ForegroundColor Yellow
}
