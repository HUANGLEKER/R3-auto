param(
    [switch]$Apply,
    [switch]$UndoCompression
)

$ErrorActionPreference = 'Stop'
if ($Apply -and $UndoCompression) { throw 'Choose either -Apply or -UndoCompression.' }
$projectDir = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$targets = @('node', 'node_modules')

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class R3DiskSize {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetCompressedFileSizeW(string fileName, out uint high);
    public static ulong Read(string fileName) {
        uint high;
        uint low = GetCompressedFileSizeW(fileName, out high);
        if (low == uint.MaxValue && Marshal.GetLastWin32Error() != 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return ((ulong)high << 32) | low;
    }
}
'@

function Get-SafeTree([string]$relative) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $projectDir $relative))
    if (!(($absolute + '\').StartsWith($projectDir + '\', [StringComparison]::OrdinalIgnoreCase))) {
        throw "Path outside project: $absolute"
    }
    if (!(Test-Path -LiteralPath $absolute)) { return }
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($absolute)
    while ($pending.Count -gt 0) {
        $item = Get-Item -LiteralPath $pending.Pop() -Force
        # Inspect each directory before descending; never follow junctions or symlinks (e.g. pnpm layout).
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            continue
        }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
                $pending.Push($child.FullName)
            }
        } else {
            $item
        }
    }
}

function Get-Usage($files) {
    [long]$logical = 0
    [long]$stored = 0
    foreach ($file in $files) {
        $logical += $file.Length
        $stored += [R3DiskSize]::Read($file.FullName)
    }
    [pscustomobject]@{ Logical = $logical; Stored = $stored }
}

$files = @(foreach ($target in $targets) { Get-SafeTree $target })
$cacheFiles = @(Get-SafeTree '.npm-cache')
$before = Get-Usage ($files + $cacheFiles)
Write-Host ('Before: {0:N2} MiB file content; {1:N2} MiB stored (dependencies + local npm cache).' -f ($before.Logical / 1MB), ($before.Stored / 1MB))
if (!$Apply -and !$UndoCompression) {
    Write-Host 'Preview only. Use -Apply to remove local npm cache and compress dependencies; -UndoCompression to decompress.'
    exit 0
}

$hashes = @{}
foreach ($file in $files) {
    $hashes[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
}

foreach ($target in $targets) {
    $absolute = Join-Path $projectDir $target
    if (!(Test-Path -LiteralPath $absolute)) { continue }
    $operation = if ($UndoCompression) { '/U' } else { '/C' }
    # Native NTFS compression keeps every file readable at its original path.
    Write-Host "Processing $target..."
    & "$env:WINDIR\System32\compact.exe" $operation "/S:$absolute" /A /I /Q | Select-Object -Last 4
    if ($LASTEXITCODE -ne 0) { throw "Compression operation failed for $target (exit $LASTEXITCODE)." }
}

$afterFiles = @(foreach ($target in $targets) { Get-SafeTree $target })
if ($afterFiles.Count -ne $files.Count) { throw 'Dependency file count changed during optimization.' }
foreach ($file in $afterFiles) {
    if (!$hashes.ContainsKey($file.FullName) -or
        (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $hashes[$file.FullName]) {
        throw "Dependency content changed during optimization: $($file.FullName)"
    }
}

if ($Apply) {
    # Revalidate the fixed, project-local cache immediately before deletion.
    $null = @(Get-SafeTree '.npm-cache')
    $cacheDir = Join-Path $projectDir '.npm-cache'
    if (Test-Path -LiteralPath $cacheDir) { Remove-Item -LiteralPath $cacheDir -Recurse -Force }
}
$remainingCache = @(Get-SafeTree '.npm-cache')
$after = Get-Usage ($afterFiles + $remainingCache)
Write-Host ('After: {0:N2} MiB file content; {1:N2} MiB stored; saved {2:N2} MiB stored.' -f ($after.Logical / 1MB), ($after.Stored / 1MB), (($before.Stored - $after.Stored) / 1MB))
Write-Host "SHA-256 verified: $($afterFiles.Count) dependency files unchanged."
