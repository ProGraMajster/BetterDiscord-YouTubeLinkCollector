# Adapted from the existing verified ZIP packager. Author: ProGraMajster.
param([Parameter(Mandatory)][string]$SourceRoot, [Parameter(Mandatory)][string]$ArchivePath)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($SourceRoot)
$taskZip = [IO.Path]::GetFullPath($ArchivePath)
if (Test-Path -LiteralPath $taskZip) { throw 'Release ZIP already exists; inspect before replacing.' }
$taskExpected = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
foreach ($taskLine in Get-Content -LiteralPath (Join-Path $taskRoot 'SHA256SUMS.txt')) {
    if ($taskLine -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid manifest line' }
    $taskName = $Matches[2]
    if ($taskExpected.ContainsKey($taskName) -or $taskName.Contains('\') -or $taskName.StartsWith('/') -or $taskName.Split('/') -contains '..') { throw 'Unsafe or duplicate manifest path' }
    $taskExpected.Add($taskName, $Matches[1])
}
$taskExpected.Add('SHA256SUMS.txt', (Get-FileHash -LiteralPath (Join-Path $taskRoot 'SHA256SUMS.txt') -Algorithm SHA256).Hash.ToLowerInvariant())
$taskArchive = [IO.Compression.ZipFile]::Open($taskZip, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($taskName in ($taskExpected.Keys | Sort-Object -CaseSensitive)) {
        $taskFile = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskName))
        if (-not $taskFile.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::Ordinal)) { throw 'Archive source escapes root' }
        if ((Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected[$taskName]) { throw "Source hash mismatch: $taskName" }
        $taskEntry = $taskArchive.CreateEntry('YouTubeLinkCollector/' + $taskName, [IO.Compression.CompressionLevel]::Optimal)
        $taskEntry.LastWriteTime = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $taskInput = [IO.File]::OpenRead($taskFile)
        $taskOutput = $taskEntry.Open()
        try { $taskInput.CopyTo($taskOutput) } finally { $taskOutput.Dispose(); $taskInput.Dispose() }
    }
} finally { $taskArchive.Dispose() }
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskZip)
try {
    $taskSeen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($taskEntry in $taskArchive.Entries) {
        if (-not $taskEntry.FullName.StartsWith('YouTubeLinkCollector/')) { throw 'Unexpected archive prefix' }
        $taskName = $taskEntry.FullName.Substring('YouTubeLinkCollector/'.Length)
        if (-not $taskExpected.ContainsKey($taskName) -or -not $taskSeen.Add($taskName)) { throw "Unexpected or duplicate ZIP entry: $taskName" }
        $taskStream = $taskEntry.Open()
        try { $taskHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskStream)).ToLowerInvariant() } finally { $taskStream.Dispose() }
        if ($taskHash -ne $taskExpected[$taskName]) { throw "ZIP hash mismatch: $taskName" }
    }
    if ($taskSeen.Count -ne $taskExpected.Count) { throw 'Missing archive files' }
} finally { $taskArchive.Dispose() }
Write-Output "ZIP verified: $($taskExpected.Count) reviewed files."
