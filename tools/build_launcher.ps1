$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot

$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compilerPath)) {
    throw "C# compiler not found: $compilerPath"
}

Push-Location $projectDir
try {
    & $compilerPath /nologo /target:winexe /out:R3-Web.exe /r:System.Windows.Forms.dll,System.Drawing.dll 'tools\launcher\WebLauncher.cs'
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
    Write-Host 'Built R3-Web.exe'
} finally {
    Pop-Location
}
