param(
  # Use a locally built binary instead of downloading (for development).
  [string]$BinaryPath,
  # Override the download URL.
  [string]$BinaryUrl
)

$ErrorActionPreference = 'Stop'

$serviceName = 'LocalPrintAgent'
$displayName = 'Local Print Agent'
$installDir = Join-Path $env:ProgramData 'LocalPrintAgent'
$exePath = Join-Path $installDir 'local-print-agent.exe'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer from PowerShell as Administrator.'
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
  foreach ($url in $urls) {
    try {
      Write-Host "Downloading $url"
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $exePath
      $downloaded = $true
      break
    } catch {
      Write-Host "Download failed, trying next source..."
    }
  }
  if (-not $downloaded) {
    throw 'Could not download the print agent binary. Build it locally (go build in apps/print-agent) and rerun with -BinaryPath.'
  }
}

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Updating existing '$displayName' service..."
  & sc.exe stop $serviceName | Out-Null
  & sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 2
}

& sc.exe create $serviceName binPath= "`"$exePath`"" start= auto DisplayName= "`"$displayName`"" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Could not register the print agent service.'
}
& sc.exe description $serviceName 'Loopback print bridge: lets apps send jobs to installed printers' | Out-Null
& sc.exe failure $serviceName reset= 60 actions= restart/3000/restart/3000/restart/3000 | Out-Null
& sc.exe start $serviceName | Out-Null
Start-Sleep -Seconds 2

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service -or $service.Status -ne 'Running') {
  throw "The '$displayName' service was installed but did not start."
}
Write-Host "Installed and started '$displayName'. It will start automatically with Windows."
