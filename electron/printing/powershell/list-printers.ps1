$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  Get-Printer | Select-Object -ExpandProperty Name
} catch {
  # Fallback for older Windows installations without the PrintManagement module.
  Get-WmiObject -Class Win32_Printer | Select-Object -ExpandProperty Name
}
