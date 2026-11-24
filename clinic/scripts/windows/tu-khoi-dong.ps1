# Bat / tat tu khoi dong phan mem cung Windows (loi tat trong thu muc Startup cua nguoi dung)
param([switch]$Enable, [switch]$Disable)
$ErrorActionPreference = 'Stop'
$clinic = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Phan mem phong kham.lnk'
if ($Disable) {
  Remove-Item -LiteralPath $lnk -ErrorAction SilentlyContinue
  exit 0
}
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $clinic 'chay-an.vbs') + '"'
$s.WorkingDirectory = $clinic
$s.Description = 'Phan mem quan ly phong kham'
$s.Save()
