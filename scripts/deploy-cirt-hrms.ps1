<#
CIRT HRMS deployment for the Windows server (Windows PowerShell 5.1 compatible).

DEPLOYMENT CHECKLIST (run in order, from an elevated PowerShell on the server)
  [ ] 1. Agree a maintenance window. Nobody is editing payroll (drafts are saved first).
  [ ] 2. Set the PostgreSQL connection for the backup in THIS session. Use a protected
         pgpass file, never a password on the command line:
           $env:PGHOST = 'localhost'; $env:PGPORT = '5432'; $env:PGUSER = '<db user>'
           $env:PGPASSFILE = '<path to pgpass.conf>'
  [ ] 3. Copy the new release to a staging folder on the SAME drive as the live app
         (for example D:\hrms-release), not inside the live folder.
  [ ] 4. Preflight (changes nothing):
           .\deploy-cirt-hrms.ps1 -CurrentRoot <live> -StagedRelease <stage> -BackupRoot <backups> `
             -DatabaseName <db> -NextServiceName <svc> -LaravelServiceName <svc> `
             -WebHealthUri http://<host>:<port>/ -LaravelHealthUri http://<host>:<port>/up
  [ ] 5. Build the stage (npm ci, build, composer install). Still changes nothing live:
           add -BuildOnly
  [ ] 6. Deploy. Does, in this order: (a) database backup, verified with pg_restore --list,
         (b) application file backup, (c) stop services and swap in the new build,
         (d) php artisan migrate --force, (e) optional repair of old data (-RepairData),
         (f) php artisan payroll:schema-check, (g) start services and health checks.
         Any failure in (c)-(g) puts the previous code back automatically:
           add -Apply -ConfirmProductionRelease   (and -RepairData if the dry run below is clean)
  [ ] 7. Optional dry run of the data repair before step 6: it only prints what it would change:
           php artisan payroll:repair-data      (run in <live>\backend)
  [ ] 8. Verify in the browser: log in, open Run Payroll for the open month, check an employee
         with Elec. units (amount follows the units), arrears and quarter rent, Save Draft and
         reload; the values must come back unchanged.
  [ ] 9. Keep the backup folder printed at the end until the next month's payroll is closed.

ROLLBACK
  Code only (database unchanged, e.g. a UI problem):
    .\deploy-cirt-hrms.ps1 -Rollback -CurrentRoot <live> -BackupRoot <backups> `
      -RollbackFrom <backup run folder> -NextServiceName <svc> -LaravelServiceName <svc> `
      -WebHealthUri <uri> -LaravelHealthUri <uri> -ConfirmProductionRelease
  Code + database (only if the database must go back to the pre-deployment state; this
  discards everything entered after the backup):
    add -RestoreDatabase -DatabaseName <db> -ConfirmDatabaseRestore

This script never prints or stores a password and has no machine-specific paths: tools are
found on PATH or in the standard install folders, or passed with -PhpExe / -PgDumpExe /
-PgRestoreExe / -NpmCommand / -ComposerCommand.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CurrentRoot,
    [string]$StagedRelease,
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [string]$DatabaseName,
    [Parameter(Mandatory = $true)][string]$NextServiceName,
    [Parameter(Mandatory = $true)][string]$LaravelServiceName,
    [Parameter(Mandatory = $true)][uri]$WebHealthUri,
    [Parameter(Mandatory = $true)][uri]$LaravelHealthUri,
    [string]$IisAppPoolName,
    [string]$PhpExe = 'php.exe',
    [string]$NpmCommand = 'npm.cmd',
    [string]$ComposerCommand = 'composer.bat',
    [string]$PgDumpExe,
    [string]$PgRestoreExe,
    [switch]$BuildOnly,
    [switch]$Apply,
    [switch]$ConfirmProductionRelease,
    [switch]$RepairData,
    [switch]$Rollback,
    [string]$RollbackFrom,
    [switch]$RestoreDatabase,
    [switch]$ConfirmDatabaseRestore
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-ExistingDirectory([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label directory does not exist: $Path" }
    return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path).TrimEnd('\')
}

function Find-Tool([string]$Explicit, [string]$Name, [string[]]$Folders) {
    if ($Explicit) {
        $cmd = Get-Command $Explicit -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
        if (Test-Path -LiteralPath $Explicit -PathType Leaf) { return [System.IO.Path]::GetFullPath($Explicit) }
        return $null
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($pattern in $Folders) {
        $hit = Get-ChildItem -Path (Join-Path $pattern $Name) -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

function Invoke-Native([string]$File, [string[]]$Arguments, [string]$Label) {
    Write-Host "== $Label"
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Invoke-Artisan([string]$Root, [string[]]$Arguments, [string]$Label) {
    Push-Location (Join-Path $Root 'backend')
    try { Invoke-Native $script:PhpExePath (@('artisan') + $Arguments) $Label } finally { Pop-Location }
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
    if (-not (Test-Path -LiteralPath (Join-Path $Stage 'database\sql\28_payroll_integrity_hardening.sql') -PathType Leaf)) { throw 'Staged release is incomplete: database\sql folder is missing (the migrations read it).' }

    Push-Location $Stage
    try {
        Invoke-Native $script:NpmPath @('ci', '--no-audit', '--no-fund') 'Install locked frontend dependencies in staged release'
        Invoke-Native $script:NpmPath @('run', 'build') 'Build staged Next.js production application'
        Invoke-Native $script:ComposerPath @('install', '--working-dir=backend', '--no-dev', '--prefer-dist', '--no-interaction', '--optimize-autoloader') 'Install locked Laravel production dependencies in staged release'
    } finally {
        Pop-Location
    }
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

function Assert-DatabaseEnvironment {
    if (-not $env:PGHOST -or -not $env:PGUSER -or -not ($env:PGPASSFILE -or $env:PGSERVICE -or $env:PGPASSWORD)) {
        throw 'PostgreSQL connection variables are incomplete. Set PGHOST, PGUSER and a protected PGPASSFILE (or PGSERVICE) before continuing.'
    }
    if ($env:PGPASSWORD -and -not $env:PGPASSFILE -and -not $env:PGSERVICE) {
        Write-Warning 'PGPASSWORD is set. It is never printed or put on a command line; prefer PGPASSFILE or PGSERVICE.'
    }
}

function Assert-AppTimezone([string]$Root, [string]$Label) {
    # Quarter assignment / effective dates use the server date, so a UTC default puts
    # them a day early before 05:30 IST. The release must pin Asia/Kolkata.
    $envFile = Join-Path $Root 'backend\.env'
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "$Label has no backend\.env, so APP_TIMEZONE cannot be verified." }
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*APP_TIMEZONE\s*=' } | Select-Object -Last 1
    $value = if ($line) { (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'") } else { '(not set - Laravel defaults to UTC)' }
    if ($value -ne 'Asia/Kolkata') {
        throw "$Label backend\.env has APP_TIMEZONE=$value. Set APP_TIMEZONE=Asia/Kolkata and run again; nothing was deployed."
    }
    Write-Host "$Label APP_TIMEZONE=Asia/Kolkata"
}

function Restore-Code([string]$PreviousRoot, [string]$FailedRoot, [string]$Reason) {
    Write-Warning "Restoring the previous release: $Reason"
    try {
        Stop-ApplicationServices
        if (Test-Path -LiteralPath $script:CurrentPath -PathType Container) {
            Move-Item -LiteralPath $script:CurrentPath -Destination $FailedRoot
        }
        if (Test-Path -LiteralPath $PreviousRoot -PathType Container) {
            Move-Item -LiteralPath $PreviousRoot -Destination $script:CurrentPath
        }
        Start-ApplicationServices
        Wait-ForHealth $LaravelHealthUri 'Laravel API after code rollback'
        Wait-ForHealth $WebHealthUri 'IIS / Next.js after code rollback'
        Write-Warning "Code rollback completed. Failed release kept at: $FailedRoot."
    } catch {
        Write-Error "Automatic code rollback needs operator intervention: $($_.Exception.Message). Previous release folder: $PreviousRoot"
    }
}

# ---------------------------------------------------------------- common setup
if ($Rollback -and ($BuildOnly -or $Apply)) { throw 'Choose -Rollback, -BuildOnly or -Apply, not a combination.' }
if ($BuildOnly -and $Apply) { throw 'Choose -BuildOnly or -Apply, not both.' }
if (($Apply -or $Rollback) -and -not $ConfirmProductionRelease) { throw 'Deployment and rollback are opt-in. Add -ConfirmProductionRelease during the approved maintenance window.' }

$script:CurrentPath = Resolve-ExistingDirectory $CurrentRoot 'Current application'
$script:BackupPath = [System.IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
$script:NextService = $NextServiceName
$script:LaravelService = $LaravelServiceName
$script:IisPool = $IisAppPoolName
$script:PhpExePath = Find-Tool $PhpExe 'php.exe' @()
$script:NpmPath = Find-Tool $NpmCommand 'npm.cmd' @()
$script:ComposerPath = Find-Tool $ComposerCommand 'composer.bat' @()
$pgFolders = @("$env:ProgramFiles\PostgreSQL\*\bin")
$script:PgDumpPath = Find-Tool $PgDumpExe 'pg_dump.exe' $pgFolders
$script:PgRestorePath = Find-Tool $PgRestoreExe 'pg_restore.exe' $pgFolders

if (-not (Test-Path -LiteralPath (Split-Path -Parent $script:BackupPath) -PathType Container)) {
    throw 'The parent directory for backups must already exist.'
}
foreach ($svc in @($NextServiceName, $LaravelServiceName)) {
    if (($Apply -or $Rollback) -and -not (Get-Service -Name $svc -ErrorAction SilentlyContinue)) { throw "Windows service not found: $svc" }
}

# ---------------------------------------------------------------- rollback mode
if ($Rollback) {
    if (-not $RollbackFrom) { throw '-RollbackFrom <backup run folder created by a previous -Apply> is required.' }
    $run = Resolve-ExistingDirectory $RollbackFrom 'Backup run'
    $appBackup = Join-Path $run 'application'
    $dump = Join-Path $run 'database.dump'
    if (-not (Test-Path -LiteralPath $appBackup -PathType Container)) { throw "No application backup in $run" }
    if ($RestoreDatabase) {
        if (-not $ConfirmDatabaseRestore) { throw 'Restoring the database discards everything entered after the backup. Add -ConfirmDatabaseRestore to proceed.' }
        if (-not $DatabaseName) { throw '-DatabaseName is required with -RestoreDatabase.' }
        if (-not $script:PgRestorePath) { throw 'pg_restore was not found. Pass -PgRestoreExe.' }
        if (-not (Test-Path -LiteralPath $dump -PathType Leaf)) { throw "No database dump in $run" }
        Assert-DatabaseEnvironment
    }
    if (-not $script:PhpExePath) { throw 'php.exe was not found.' }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $failedRoot = "$script:CurrentPath.rolledback-$stamp"
    Stop-ApplicationServices
    try {
        if ($RestoreDatabase) {
            Invoke-Native $script:PgRestorePath @('--no-password', '--clean', '--if-exists', '--no-owner', '--single-transaction', '--dbname', $DatabaseName, $dump) 'Restore database from backup (single transaction)'
        }
        Move-Item -LiteralPath $script:CurrentPath -Destination $failedRoot
        New-Item -ItemType Directory -Path $script:CurrentPath | Out-Null
        & robocopy $appBackup $script:CurrentPath /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /NFL /NDL /NP
        if ($LASTEXITCODE -ge 8) { throw "Restoring application files failed with robocopy exit code $LASTEXITCODE." }
    } finally {
        Start-ApplicationServices
    }
    Wait-ForHealth $LaravelHealthUri 'Laravel API after rollback'
    Wait-ForHealth $WebHealthUri 'IIS / Next.js after rollback'
    Write-Host "Rollback complete. The rolled-back release is kept at: $failedRoot"
    exit 0
}

# ---------------------------------------------------------------- deploy mode
if (-not $StagedRelease) { throw '-StagedRelease is required.' }
if (-not $DatabaseName) { throw '-DatabaseName is required.' }
$script:StagePath = Resolve-ExistingDirectory $StagedRelease 'Staged release'

if (-not $script:PhpExePath -or -not $script:NpmPath -or -not $script:ComposerPath) {
    throw 'PHP 8.4, npm and Composer must be installed and resolvable (PATH, or pass -PhpExe / -NpmCommand / -ComposerCommand).'
}
if (-not $script:PgDumpPath) { throw 'pg_dump was not found on PATH or under Program Files\PostgreSQL. Pass -PgDumpExe.' }
if (-not $script:PgRestorePath) { throw 'pg_restore was not found (needed to verify the backup). Pass -PgRestoreExe.' }
if ($script:CurrentPath -eq $script:StagePath -or $script:StagePath.StartsWith($script:CurrentPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The staged release must be a separate directory outside the current application root.'
}
if ([System.IO.Path]::GetPathRoot($script:CurrentPath) -ne [System.IO.Path]::GetPathRoot($script:StagePath)) {
    throw 'Current and staged directories must be on the same volume for the reversible directory swap.'
}

Write-Host "Current root:   $script:CurrentPath"
Write-Host "Staged release: $script:StagePath"
Write-Host "Backup root:    $script:BackupPath"
Write-Host "Database name:  $DatabaseName"

if (-not $Apply -and -not $BuildOnly) {
    Assert-AppTimezone $script:CurrentPath 'Current release'
    Write-Host 'Preflight only; nothing was built, backed up, stopped or deployed. Use -BuildOnly, then -Apply -ConfirmProductionRelease.'
    exit 0
}

Build-StagedRelease $script:StagePath
if ($BuildOnly) {
    Write-Host 'Staged production build completed. No backup, service restart, migration or deployment was performed.'
    exit 0
}

Assert-AppTimezone $script:StagePath 'Staged release'
Assert-DatabaseEnvironment

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRun = Join-Path $script:BackupPath "CIRT-HRMS-$stamp"
$appBackup = Join-Path $backupRun 'application'
$databaseBackup = Join-Path $backupRun 'database.dump'
$previousRoot = "$script:CurrentPath.rollback-$stamp"
$failedRoot = "$script:CurrentPath.failed-$stamp"
New-Item -ItemType Directory -Path $backupRun | Out-Null

# (a) database backup, verified
& $script:PgDumpPath --no-password --format=custom --no-owner --file $databaseBackup --dbname $DatabaseName
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $databaseBackup -PathType Leaf)) {
    throw 'Database backup failed. No services were stopped and nothing was deployed.'
}
& $script:PgRestorePath --list $databaseBackup | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The database backup could not be read back (pg_restore --list failed). Nothing was deployed.' }
Write-Host "Database backup verified: $databaseBackup"

# (b) application files backup
& robocopy $script:CurrentPath $appBackup /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "Application backup failed with robocopy exit code $LASTEXITCODE. Nothing was deployed." }
Write-Host "Application backup: $appBackup"

# (c)-(g) swap, migrate, repair, check, start
$swapped = $false
try {
    Stop-ApplicationServices
    Move-Item -LiteralPath $script:CurrentPath -Destination $previousRoot
    Move-Item -LiteralPath $script:StagePath -Destination $script:CurrentPath
    $swapped = $true

    Invoke-Artisan $script:CurrentPath @('migrate', '--force', '--no-interaction') 'Run pending database migrations'
    if ($RepairData) {
        Invoke-Artisan $script:CurrentPath @('payroll:repair-data') 'Data repair dry run (shows what will change)'
        Invoke-Artisan $script:CurrentPath @('payroll:repair-data', '--apply') 'Data repair (never deletes, never touches finalized months)'
    }
    Invoke-Artisan $script:CurrentPath @('payroll:schema-check') 'Post-deploy schema and data check'
    foreach ($cache in @('config:cache', 'route:cache', 'view:cache')) {
        Invoke-Artisan $script:CurrentPath @($cache, '--no-interaction') "Laravel $cache"
    }

    Start-ApplicationServices
    Wait-ForHealth $LaravelHealthUri 'Laravel API'
    Wait-ForHealth $WebHealthUri 'IIS / Next.js'
    Write-Host 'Deployment checks passed.'
    Write-Host "Backups: $backupRun"
    Write-Host "Previous release kept at: $previousRoot"
    Write-Host "To roll back: -Rollback -RollbackFrom '$backupRun' (add -RestoreDatabase -ConfirmDatabaseRestore to also restore the database)."
} catch {
    $deploymentError = $_.Exception.Message
    Write-Error "Deployment failed: $deploymentError"
    if ($swapped) {
        Restore-Code $previousRoot $failedRoot $deploymentError
        Write-Warning "Migrations that already ran were NOT reverted (they are idempotent and non-destructive). To return the database to its state before this deployment: -Rollback -RollbackFrom '$backupRun' -RestoreDatabase -ConfirmDatabaseRestore -DatabaseName $DatabaseName"
    }
    throw
}
