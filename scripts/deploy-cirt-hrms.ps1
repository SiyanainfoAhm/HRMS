[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CurrentRoot,
    [Parameter(Mandatory = $true)][string]$StagedRelease,
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [Parameter(Mandatory = $true)][string]$DatabaseName,
    [Parameter(Mandatory = $true)][string]$NextServiceName,
    [Parameter(Mandatory = $true)][string]$LaravelServiceName,
    [Parameter(Mandatory = $true)][uri]$WebHealthUri,
    [Parameter(Mandatory = $true)][uri]$LaravelHealthUri,
    [string]$IisAppPoolName,
    [string]$PhpExe = 'C:\php84\php.exe',
    [string]$NpmCommand = 'npm.cmd',
    [string]$ComposerCommand = 'composer.bat',
    [string]$PgDumpExe = 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe',
    [switch]$BuildOnly,
    [switch]$Apply,
    [switch]$ConfirmProductionRelease
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-ExistingDirectory([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label directory does not exist: $Path" }
    return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path).TrimEnd('\')
}

function Invoke-Native([string]$File, [string[]]$Arguments, [string]$Label) {
    Write-Host "== $Label"
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Copy-ProductionEnvironment([string]$Current, [string]$Stage) {
    foreach ($relative in @('.env.local', 'backend\.env')) {
        $source = Join-Path $Current $relative
        $destination = Join-Path $Stage $relative
        if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) {
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required runtime environment file is missing: $relative" }
            $parent = Split-Path -Parent $destination
            if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "Staged release is missing $parent" }
            Copy-Item -LiteralPath $source -Destination $destination
            Write-Host "Copied protected runtime configuration into staged release: $relative"
        }
    }
}

function Build-StagedRelease([string]$Stage) {
    Copy-ProductionEnvironment $script:CurrentPath $Stage
    if (-not (Test-Path -LiteralPath (Join-Path $Stage 'package-lock.json') -PathType Leaf)) { throw 'Staged release has no package-lock.json.' }
    if (-not (Test-Path -LiteralPath (Join-Path $Stage 'backend\composer.lock') -PathType Leaf)) { throw 'Staged release has no backend\composer.lock.' }
    if (-not (Test-Path -LiteralPath $script:PhpExePath -PathType Leaf)) { throw "PHP executable not found: $script:PhpExePath" }
    if (-not (Test-Path -LiteralPath $script:PgDumpPath -PathType Leaf)) { throw "pg_dump executable not found: $script:PgDumpPath" }

    Push-Location $Stage
    try {
        Invoke-Native $script:NpmPath @('ci', '--no-audit', '--no-fund') 'Install locked frontend dependencies in staged release'
        Invoke-Native $script:NpmPath @('run', 'build') 'Build staged Next.js production application'
        Invoke-Native $script:ComposerPath @('install', '--working-dir=backend', '--no-dev', '--prefer-dist', '--no-interaction', '--optimize-autoloader') 'Install locked Laravel production dependencies in staged release'
        Invoke-Native $script:PhpExePath @('artisan', 'config:cache', '--no-interaction') 'Cache Laravel configuration in staged release'
        Invoke-Native $script:PhpExePath @('artisan', 'route:cache', '--no-interaction') 'Cache Laravel routes in staged release'
        Invoke-Native $script:PhpExePath @('artisan', 'view:cache', '--no-interaction') 'Cache Laravel views in staged release'
    } finally {
        Pop-Location
    }
}

function Assert-NoPendingMigrations([string]$Stage) {
    Push-Location (Join-Path $Stage 'backend')
    try {
        $status = & $script:PhpExePath artisan migrate:status --no-ansi 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Could not read migration status. No migration was run.' }
        if (($status -join "`n") -match '(?im)\bPending\b') {
            throw 'The staged code reports pending database migrations. Stop here and obtain a separately approved migration plan; this script never runs migrations.'
        }
    } finally {
        Pop-Location
    }
    Write-Host 'Migration status is clear; no migrations were executed.'
}

function Wait-ForHealth([uri]$Uri, [string]$Label) {
    $lastError = $null
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -Method Get -TimeoutSec 10 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                Write-Host "$Label health check passed (HTTP $($response.StatusCode))."
                return
            }
            $lastError = "HTTP $($response.StatusCode)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 5
    }
    throw "$Label health check failed after 12 attempts: $lastError"
}

function Start-ApplicationServices {
    Start-Service -Name $script:NextService
    Start-Service -Name $script:LaravelService
    if ($script:IisPool) {
        Import-Module WebAdministration
        Start-WebAppPool -Name $script:IisPool
    }
}

function Stop-ApplicationServices {
    if ($script:IisPool) {
        Import-Module WebAdministration
        Stop-WebAppPool -Name $script:IisPool
    }
    Stop-Service -Name $script:NextService -Force
    Stop-Service -Name $script:LaravelService -Force
}

if ($BuildOnly -and $Apply) { throw 'Choose -BuildOnly or -Apply, not both.' }
if ($Apply -and -not $ConfirmProductionRelease) { throw 'Deployment is opt-in. Add -ConfirmProductionRelease to -Apply only during the approved maintenance window.' }
if ($Apply -and ([string]::IsNullOrWhiteSpace($NextServiceName) -or [string]::IsNullOrWhiteSpace($LaravelServiceName))) { throw 'Both Windows service names are required for deployment.' }

$script:CurrentPath = Resolve-ExistingDirectory $CurrentRoot 'Current application'
$script:StagePath = Resolve-ExistingDirectory $StagedRelease 'Staged release'
$script:BackupPath = [System.IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
$resolvedCommand = Get-Command $PhpExe -ErrorAction SilentlyContinue
$script:PhpExePath = $null
if ($resolvedCommand) { $script:PhpExePath = $resolvedCommand.Source }
if (-not $script:PhpExePath -and (Test-Path -LiteralPath $PhpExe -PathType Leaf)) { $script:PhpExePath = [System.IO.Path]::GetFullPath($PhpExe) }
$resolvedCommand = Get-Command $NpmCommand -ErrorAction SilentlyContinue
$script:NpmPath = $null
if ($resolvedCommand) { $script:NpmPath = $resolvedCommand.Source }
$resolvedCommand = Get-Command $ComposerCommand -ErrorAction SilentlyContinue
$script:ComposerPath = $null
if ($resolvedCommand) { $script:ComposerPath = $resolvedCommand.Source }
$script:PgDumpPath = if (Test-Path -LiteralPath $PgDumpExe -PathType Leaf) { [System.IO.Path]::GetFullPath($PgDumpExe) } else { $null }
$script:NextService = $NextServiceName
$script:LaravelService = $LaravelServiceName
$script:IisPool = $IisAppPoolName

if (-not $script:PhpExePath -or -not $script:NpmPath -or -not $script:ComposerPath -or -not $script:PgDumpPath) {
    throw 'PHP 8.4, npm, Composer, and pg_dump must be installed and their paths resolvable before continuing.'
}
if ($script:CurrentPath -eq $script:StagePath -or $script:StagePath.StartsWith($script:CurrentPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The staged release must be a separate directory outside the current application root.'
}
if ([System.IO.Path]::GetPathRoot($script:CurrentPath) -ne [System.IO.Path]::GetPathRoot($script:StagePath)) {
    throw 'Current and staged directories must be on the same volume for the reversible directory swap.'
}
if (-not (Test-Path -LiteralPath (Split-Path -Parent $script:BackupPath) -PathType Container)) {
    throw 'The parent directory for backups must already exist.'
}
if ($env:PGPASSWORD -and -not $env:PGPASSFILE -and -not $env:PGSERVICE) {
    Write-Warning 'A password environment variable is present. It will not be printed or included in process arguments; prefer PGPASSFILE or PGSERVICE.'
}

Write-Host "Current root: $script:CurrentPath"
Write-Host "Staged release: $script:StagePath"
Write-Host "Backup root: $script:BackupPath"
Write-Host "Database name: $DatabaseName"
Write-Host 'This script never executes php artisan migrate and never restores a database backup.'

if (-not $Apply -and -not $BuildOnly) {
    Write-Host 'Preflight only; no build, backup, service restart, or deployment was performed. Use -BuildOnly to build the stage, or -Apply -ConfirmProductionRelease during the approved window.'
    exit 0
}

Build-StagedRelease $script:StagePath
if ($BuildOnly) {
    Write-Host 'Staged production build completed. No backup, service restart, database migration, or deployment was performed.'
    exit 0
}

Assert-NoPendingMigrations $script:StagePath
if (-not (Get-Service -Name $script:NextService -ErrorAction SilentlyContinue)) { throw "Next.js Windows service not found: $script:NextService" }
if (-not (Get-Service -Name $script:LaravelService -ErrorAction SilentlyContinue)) { throw "Laravel Windows service not found: $script:LaravelService" }
if (-not $env:PGHOST -or -not $env:PGUSER -or -not ($env:PGPASSFILE -or $env:PGSERVICE -or $env:PGPASSWORD)) {
    throw 'PostgreSQL backup connection variables are incomplete. Configure PGHOST, PGUSER, and a protected PGPASSFILE/PGSERVICE before deployment.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRun = Join-Path $script:BackupPath "CIRT-HRMS-$stamp"
$appBackup = Join-Path $backupRun 'application'
$databaseBackup = Join-Path $backupRun 'database.dump'
$previousRoot = "$script:CurrentPath.rollback-$stamp"
$failedRoot = "$script:CurrentPath.failed-$stamp"
New-Item -ItemType Directory -Path $backupRun | Out-Null

& $script:PgDumpPath --no-password --format=custom --no-owner --file $databaseBackup --dbname $DatabaseName
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $databaseBackup -PathType Leaf)) {
    throw 'Database backup failed. No application services were stopped and no deployment was performed.'
}

& robocopy $script:CurrentPath $appBackup /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "Application backup failed with robocopy exit code $LASTEXITCODE. No deployment was performed." }

$swapped = $false
try {
    Stop-ApplicationServices
    Move-Item -LiteralPath $script:CurrentPath -Destination $previousRoot
    Move-Item -LiteralPath $script:StagePath -Destination $script:CurrentPath
    $swapped = $true
    Start-ApplicationServices
    Wait-ForHealth $LaravelHealthUri 'Laravel API'
    Wait-ForHealth $WebHealthUri 'IIS / Next.js'
    Write-Host "Deployment checks passed. Backups: $backupRun"
    Write-Host "Previous release retained at: $previousRoot"
} catch {
    $deploymentError = $_.Exception.Message
    Write-Error "Deployment verification failed: $deploymentError"
    if ($swapped) {
        try {
            Stop-ApplicationServices
            if (Test-Path -LiteralPath $script:CurrentPath -PathType Container) {
                Move-Item -LiteralPath $script:CurrentPath -Destination $failedRoot
            }
            if (Test-Path -LiteralPath $previousRoot -PathType Container) {
                Move-Item -LiteralPath $previousRoot -Destination $script:CurrentPath
            }
            Start-ApplicationServices
            Wait-ForHealth $LaravelHealthUri 'Laravel API after code rollback'
            Wait-ForHealth $WebHealthUri 'IIS / Next.js after code rollback'
            Write-Warning "Code rollback completed. Failed release retained at: $failedRoot. Database was not restored or modified by this script."
        } catch {
            Write-Error "Automatic code rollback needs operator intervention: $($_.Exception.Message). Keep the database unchanged and use the retained rollback folder: $previousRoot"
        }
    }
    throw
}
