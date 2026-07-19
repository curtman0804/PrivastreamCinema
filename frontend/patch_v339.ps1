# patch_v339_stronger_dv_and_qxr_blacklist.ps1 (v339r2)

$ErrorActionPreference = 'Stop'
$Target = 'C:\Users\Curtm\PrivastreamCinema\frontend\app\details\[type]\[id].tsx'

Write-Host "[V339r2] Patching $Target" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Target)) { Write-Host "ERROR: not found" -ForegroundColor Red; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item -LiteralPath $Target -Destination "$Target.bak_v339r2_$stamp" -Force

$content = Get-Content -LiteralPath $Target -Raw

if ($content -match 'V339_QXR_PENALTY') {
  Write-Host "[V339r2] Already patched. Skipping." -ForegroundColor Yellow; exit 0
}

# -- 1) Force DV line to -5000 --
$dvRegex = '/\* V(?:319_QUALITY_FIRST|338_RESTORE_DV_PENALTY|339_STRONGER_DV)[^*]*\*/ if \(_v272IsDV\) s [+\-]= \d+;'
$dvReplacement = '/* V339_STRONGER_DV */ if (_v272IsDV) s -= 5000;'
if ($content -match $dvRegex) {
  $content = [regex]::Replace($content, $dvRegex, $dvReplacement)
  Write-Host "  DV penalty forced to -5000" -ForegroundColor Green
} else {
  Write-Host "  WARN: DV line not found by regex" -ForegroundColor Yellow
}

# -- 2) Insert QxR/r00t penalty block before V158_AUDIO_PENALTY --
$v158Anchor = '/* V158_AUDIO_PENALTY'

$qxrBlock = @'
/* V339_QXR_PENALTY - QxR/r00t MKVs use ContentCompAlgo compression that
       ExoPlayer 2.18.1 cannot parse. Playback fails immediately with a source
       error even when the file is otherwise fine. Bump these down so they
       only get picked when nothing else exists. */
    {
      const _v339t = (String(stream.title || '') + ' ' + String(stream.name || '')).toUpperCase();
      const _v339IsProblematic = (
        _v339t.indexOf('[QXR]') !== -1 || _v339t.indexOf(' QXR ') !== -1 || _v339t.indexOf('.QXR.') !== -1
        || _v339t.indexOf('[R00T]') !== -1 || _v339t.indexOf(' R00T') !== -1 || _v339t.indexOf('R00T)') !== -1
      );
      if (_v339IsProblematic) {
        s -= 2500;
        console.log('[V339] QxR/r00t penalty -2500 |', String(stream.name || '').slice(0, 80));
      }
    }
    
'@

$injection = $qxrBlock + $v158Anchor

if ($content.Contains($v158Anchor)) {
  $idx = $content.IndexOf($v158Anchor)
  $content = $content.Substring(0, $idx) + $injection + $content.Substring($idx + $v158Anchor.Length)
  Write-Host "  QxR/r00t penalty block inserted before V158 anchor" -ForegroundColor Green
} else {
  Write-Host "  WARN: V158 anchor not found - QxR block NOT inserted" -ForegroundColor Yellow
}

Set-Content -LiteralPath $Target -Value $content -NoNewline
Write-Host "[V339r2] Done. Run deploy_ota.bat next." -ForegroundColor Cyan
