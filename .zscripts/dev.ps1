$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
Set-Location $ProjectDir

Write-Host "[Ntox] Starting cross-platform dev bootstrap..."
node scripts/dev-bootstrap.mjs --with-mini-services
