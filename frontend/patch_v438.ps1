$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"
$fPath = 'src\components\ServiceRow.tsx'
$fAbs  = (Resolve-Path $fPath).Path
$f     = [System.IO.File]::ReadAllText($fAbs)

if ($f.Contains('V438_ROW_HYDRATION')) { Write-Host "[SKIP]"; exit 0 }

# 1) Increase drawDistance from 3x to 8x - keeps more tiles mounted horizontally
$old1 = 'drawDistance={itemTotalWidth * 3}'
$new1 = 'drawDistance={itemTotalWidth * 8} /* V438_ROW_HYDRATION - more pre-rendered tiles = D-pad stays in-row */'
if ($f.Contains($old1)) {
    $f = $f.Replace($old1, $new1)
    Write-Host "[OK] drawDistance -> 8x"
} else {
    Write-Host "[FATAL] drawDistance anchor missing"; exit 1
}

# 2) Add removeClippedSubviews={false} so offscreen mounted tiles keep native tags
$old2 = 'viewabilityConfig={viewabilityConfig}'
$new2 = 'viewabilityConfig={viewabilityConfig}
            removeClippedSubviews={false} /* V438 - keep native tags alive for spatial nav */'
if ($f.Contains($old2)) {
    $f = $f.Replace($old2, $new2)
    Write-Host "[OK] removeClippedSubviews=false"
}

[System.IO.File]::WriteAllText($fAbs, $f)
Write-Host "[OK] v438 applied"
