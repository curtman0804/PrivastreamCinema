$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"
$pAbs = (Resolve-Path 'app\player.tsx').Path
$p = [System.IO.File]::ReadAllText($pAbs)

# Find the orphan block. It starts at the "Current offset display" comment
# that was left dangling after our v433 partial-removal.
$orphanStart = '                                          {/* Current offset display - NOT focusable, D-pad skips over. */}'
$idx = $p.IndexOf($orphanStart)
if ($idx -lt 0) {
    Write-Host "[SKIP] no orphan found"
    exit 0
}

# Find the end of the orphan block: it will contain 3 <Pressable> ... </Pressable>
# sequences plus a wrapping </View>, then finally close with '})()}' or similar.
# Simplest: find the FIRST '})()}' AFTER the orphan start and delete through it.
$endMarker = '})()}'
$endIdx = $p.IndexOf($endMarker, $idx)
if ($endIdx -lt 0) {
    # try alternative end
    $endMarker = ")}`n`n"
    $endIdx = $p.IndexOf($endMarker, $idx)
}
if ($endIdx -lt 0) {
    Write-Host "[FATAL] cannot find orphan end marker"
    exit 1
}
$endIdx += $endMarker.Length
$len = $endIdx - $idx
$p = $p.Remove($idx, $len)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] removed $len chars of orphan JSX"
