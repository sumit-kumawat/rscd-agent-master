# Register Windows Scheduled Task to start RSCD Manager after reboot (requires Docker Desktop).
# Run as Administrator:
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\register-autostart.ps1
#Requires -RunAsAdministrator
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TaskName = 'RSCD-Manager-Docker'
$ComposeFile = Join-Path $Root 'docker-compose.windows.yml'

if (-not (Test-Path $ComposeFile)) {
    Write-Host "ERROR: $ComposeFile not found" -ForegroundColor Red
    exit 1
}

$docker = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source
if (-not $docker) {
    Write-Host 'ERROR: docker.exe not in PATH' -ForegroundColor Red
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute $docker `
    -Argument "compose -f `"$ComposeFile`" up -d" `
    -WorkingDirectory $Root

# Delay so Docker Desktop can start after user logon
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT2M'

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Description 'Start RSCD Manager (nginx :80, API :81) via Docker Compose' `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName" -ForegroundColor Green
Write-Host 'Also enable in Docker Desktop: Settings → General → Start Docker Desktop when you sign in' -ForegroundColor Yellow
Write-Host "Test now: Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Gray
