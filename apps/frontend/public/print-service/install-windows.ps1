param(
  # Use a locally built binary instead of downloading (for development).
  [string]$BinaryPath,
  # Override the download URL (a matching .sha256 URL must also be reachable).
  [string]$BinaryUrl,
  # Exact browser origin(s) allowed to call the agent. Comma-separated.
  [string]$AllowedOrigins = 'https://pos.gsmpilot.com'
)

$ErrorActionPreference = 'Stop'

$serviceName = 'LocalPrintAgent'
$displayName = 'Local Print Agent'
$installDir = Join-Path $env:ProgramData 'LocalPrintAgent'
$exePath = Join-Path $installDir 'local-print-agent.exe'
$configPath = Join-Path $installDir 'print-agent-config.json'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer from PowerShell as Administrator.'
}

$origins = @($AllowedOrigins -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
if ($origins.Count -eq 0) {
  throw 'At least one allowed POS origin is required.'
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null

if ($BinaryPath) {
  if (-not (Test-Path $BinaryPath)) {
    throw "Binary not found: $BinaryPath"
  }
  Copy-Item $BinaryPath $exePath -Force
} else {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
  $urls = @()
  if ($BinaryUrl) { $urls += $BinaryUrl }
  $urls += "https://github.com/ammarshameer/restaurant-pos-system/releases/download/agent-latest/local-print-agent-windows-$arch.exe"
  $urls += "https://github.com/ammarshameer/restaurant-pos-system/releases/latest/download/local-print-agent-windows-$arch.exe"

  $downloaded = $false
  foreach ($candidate in $urls) {
    try {
      Write-Host "Downloading $candidate"
      Invoke-WebRequest -UseBasicParsing -Uri $candidate -OutFile $exePath
    } catch {
      Write-Host "Download failed, trying next source..."
      continue
    }

    # Fail closed: a missing or mismatched published checksum aborts the install.
    try {
      Write-Host 'Verifying SHA-256 checksum...'
      $checksumText = (Invoke-WebRequest -UseBasicParsing -Uri "$candidate.sha256").Content.Trim()
      $expected = ($checksumText -split '\s+')[0].ToLowerInvariant()
      if ($expected -notmatch '^[a-f0-9]{64}$') {
        throw "Invalid checksum published at $candidate.sha256"
      }
      $actual = (Get-FileHash -Algorithm SHA256 -Path $exePath).Hash.ToLowerInvariant()
      if ($actual -ne $expected) {
        throw "SHA-256 mismatch. Published: $expected Downloaded: $actual"
      }
      $downloaded = $true
      break
    } catch {
      throw "Checksum verification failed for $candidate`: $($_.Exception.Message)"
    }
  }
  if (-not $downloaded) {
    throw 'Could not download a verified print agent binary. Build it locally (go build in apps/print-agent) and rerun with -BinaryPath.'
  }
}

# Generate a fresh random token on every install. It is shown once at the end.
$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
$token = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })

$config = [ordered]@{
  port           = 17778
  printerName    = ''
  token          = $token
  allowedOrigins = $origins
}
$config | ConvertTo-Json -Depth 4 | Set-Content -Path $configPath -Encoding UTF8

# Only Administrators and the LocalService account may read the token file.
& icacls $configPath /inheritance:r /grant:r '*S-1-5-32-544:(F)' '*S-1-5-19:(R)' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Could not restrict permissions on the print agent config file.'
}

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Updating existing '$displayName' service..."
  & sc.exe stop $serviceName | Out-Null
  & sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 2
}

# Run as LocalService, never LocalSystem.
& sc.exe create $serviceName binPath= "`"$exePath`"" start= auto DisplayName= "`"$displayName`"" obj= 'NT AUTHORITY\LocalService' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Could not register the print agent service.'
}
& sc.exe description $serviceName 'Loopback print bridge: lets apps send jobs to installed printers' | Out-Null
& sc.exe failure $serviceName reset= 60 actions= restart/3000/restart/3000/restart/3000 | Out-Null
& sc.exe start $serviceName | Out-Null
Start-Sleep -Seconds 2

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service -or $service.Status -ne 'Running') {
  throw "The '$displayName' service was installed but did not start. It runs as LocalService; make sure that account can access the printer."
}

Write-Host "Installed and started '$displayName'. It runs as LocalService and starts automatically with Windows."
Write-Host '======================================================================'
Write-Host 'COPY THIS TOKEN INTO POS SETTINGS > LOCAL PRINT SERVICE (SHOWN ONCE):'
Write-Host $token
Write-Host '======================================================================'
Write-Host 'Allowed browser origins:'
$origins | ForEach-Object { Write-Host "  $_" }
