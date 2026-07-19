# patch_v344_mmkv_codemod.ps1 (r2 — PS 5.1 compatible)

$ErrorActionPreference = 'Stop'
$Root = 'C:\Users\Curtm\PrivastreamCinema\frontend'

Write-Host "[V344] Codemod: AsyncStorage -> MMKV shim" -ForegroundColor Cyan

$shim1 = Join-Path $Root 'src\utils\mmkvStorage.ts'
$shim2 = Join-Path $Root 'src\utils\mmkvMigrate.ts'
if (-not (Test-Path -LiteralPath $shim1)) { Write-Host "ERROR: $shim1 missing." -ForegroundColor Red; exit 1 }
if (-not (Test-Path -LiteralPath $shim2)) { Write-Host "ERROR: $shim2 missing." -ForegroundColor Red; exit 1 }

# PS 5.1 relative-path helper
function Get-RelativePathCompat([string]$fromDir, [string]$toFile) {
  $fromUri = New-Object System.Uri(($fromDir.TrimEnd('\','/') + '\'))
  $toUri = New-Object System.Uri($toFile)
  $rel = $fromUri.MakeRelativeUri($toUri).ToString()
  $rel = [Uri]::UnescapeDataString($rel) -replace '\\', '/'
  if (-not ($rel.StartsWith('.'))) { $rel = './' + $rel }
  return $rel
}

$files = Get-ChildItem -Path (Join-Path $Root 'app'), (Join-Path $Root 'src') -Recurse -Include *.ts, *.tsx -File -ErrorAction SilentlyContinue |
         Where-Object { $_.FullName -notmatch 'node_modules|\.bak_|mmkvStorage\.ts|mmkvMigrate\.ts' }

$targetImportRegex = 'from\s+[''"]@react-native-async-storage/async-storage[''"]'
$hits = @()
foreach ($f in $files) {
  $c = Get-Content -LiteralPath $f.FullName -Raw
  if ($c -match $targetImportRegex) { $hits += $f }
}
Write-Host "  found $($hits.Count) files importing AsyncStorage" -ForegroundColor DarkGray

$shimAbs = (Resolve-Path -LiteralPath $shim1).Path
foreach ($f in $hits) {
  Copy-Item -LiteralPath $f.FullName -Destination "$($f.FullName).bak_v344" -Force -ErrorAction SilentlyContinue

  $fileDir = [System.IO.Path]::GetDirectoryName($f.FullName)
  $rel = Get-RelativePathCompat $fileDir $shimAbs
  # strip .ts extension for the import
  $rel = $rel -replace '\.ts$', ''

  $c = Get-Content -LiteralPath $f.FullName -Raw
  $newImport = "from '$rel'"
  $c2 = [regex]::Replace($c, $targetImportRegex, $newImport)
  Set-Content -LiteralPath $f.FullName -Value $c2 -NoNewline
  Write-Host ("  patched: " + $f.FullName.Substring($Root.Length + 1) + " -> $rel") -ForegroundColor Green
}

# Wire ensureMMKVMigrated into _layout / App.
$layoutCandidates = @(
  (Join-Path $Root 'app\_layout.tsx'),
  (Join-Path $Root 'app\_layout.jsx'),
  (Join-Path $Root 'App.tsx'),
  (Join-Path $Root 'App.jsx')
)
$layout = $null
foreach ($p in $layoutCandidates) { if (Test-Path -LiteralPath $p) { $layout = $p; break } }

if (-not $layout) {
  Write-Host "  WARN: no _layout.tsx / App.tsx found - add ensureMMKVMigrated() manually" -ForegroundColor Yellow
} else {
  $lc = Get-Content -LiteralPath $layout -Raw
  if ($lc -notmatch 'ensureMMKVMigrated') {
    Copy-Item -LiteralPath $layout -Destination "$layout.bak_v344" -Force
    $layoutDir = [System.IO.Path]::GetDirectoryName($layout)
    $migRel = Get-RelativePathCompat $layoutDir (Join-Path $Root 'src\utils\mmkvMigrate.ts')
    $migRel = $migRel -replace '\.ts$', ''
    $importLine = "import { ensureMMKVMigrated } from '$migRel';"
    $bootCall = "`r`n// V344 - migrate AsyncStorage -> MMKV on first boot (idempotent)`r`nensureMMKVMigrated().catch(function () {});"
    $lc2 = $importLine + "`r`n" + $lc + $bootCall
    Set-Content -LiteralPath $layout -Value $lc2 -NoNewline
    Write-Host "  patched _layout: $layout" -ForegroundColor Green
  } else {
    Write-Host "  _layout already wired - skip" -ForegroundColor Yellow
  }
}

Write-Host "[V344] Done." -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1) cd $Root"
Write-Host "  2) yarn add react-native-mmkv@^2.12.2"
Write-Host "  3) Bump 'versionCode' in app.json (+1)"
Write-Host "  4) Emergent Publish -> new AAB build -> sideload"
