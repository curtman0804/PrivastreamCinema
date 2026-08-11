$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"
$pAbs = (Resolve-Path 'app\player.tsx').Path
$lines = [System.IO.File]::ReadAllLines($pAbs)
$total = $lines.Length
Write-Host "Total lines: $total"

# Find the orphan block: starts at first '<Pressable' after 'Auto-synced subtitles',
# ends at first '})()}' that follows.
$autoSyncIdx = -1
for ($i = 0; $i -lt $total; $i++) {
    if ($lines[$i] -match 'Auto-synced subtitles') { $autoSyncIdx = $i; break }
}
if ($autoSyncIdx -lt 0) { Write-Host "[FATAL] can't locate anchor"; exit 1 }
Write-Host "Found auto-sync at line $($autoSyncIdx + 1)"

# From autoSyncIdx forward, find the FIRST '<Pressable' - that's the orphan start.
$orphanStart = -1
for ($i = $autoSyncIdx + 1; $i -lt $total; $i++) {
    if ($lines[$i] -match '^\s+<Pressable' -and $lines[$i+1] -match 'focusable=\{true\}') {
        $orphanStart = $i
        break
    }
}
if ($orphanStart -lt 0) { Write-Host "[OK] no orphan Pressable found"; exit 0 }
Write-Host "Orphan starts at line $($orphanStart + 1)"

# Look at what's before the orphan Pressable. If the previous non-blank line
# is '})()}' (closing of v437 IIFE) then this orphan IS the leftover and safe to nuke.
# Find orphan end: first line containing '})()}' after orphanStart.
$orphanEnd = -1
for ($i = $orphanStart; $i -lt $total; $i++) {
    if ($lines[$i].TrimEnd() -eq '            })()}') { $orphanEnd = $i; break }
    if ($lines[$i] -match '\}\)\(\)\}') { $orphanEnd = $i; break }
}
if ($orphanEnd -lt 0) { Write-Host "[FATAL] can't find orphan end"; exit 1 }
Write-Host "Orphan ends at line $($orphanEnd + 1)"

# Delete lines [orphanStart .. orphanEnd] inclusive
$kept = @()
for ($i = 0; $i -lt $total; $i++) {
    if ($i -ge $orphanStart -and $i -le $orphanEnd) { continue }
    $kept += $lines[$i]
}
[System.IO.File]::WriteAllLines($pAbs, $kept)
$removed = ($orphanEnd - $orphanStart + 1)
Write-Host "[OK] removed $removed lines (orphan block)"
