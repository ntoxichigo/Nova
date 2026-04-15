$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
Set-Location $ProjectDir

Write-Host "[Ntox] Installing dependencies..."
npm install

Write-Host "[Ntox] Building production bundle..."
npm run build
