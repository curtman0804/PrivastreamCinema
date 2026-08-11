# ============================================================================
# patch_v397.ps1 - Full-screen video + quality-first auto-pick (OTA)
#
# 1. FULL SCREEN: the player used ResizeMode.CONTAIN, so any non-16:9
#    release (2.35:1 scope movies etc.) played with black letterbox bars.
#    Now ResizeMode.COVER - the picture always fills the screen.
#
# 2. QUALITY-FIRST BINGE: the "Play Next" fast path took the backend
#    (seeder-ranked) list as-is; v388 only demoted foreign releases.
#    Now the list is ranked the same way the details page ranks streams:
#      - cached/direct links first (instant start)
#      - then resolution: 4K > 1080p > 720p > HD
#      - HDR / Dolby Vision demoted (Firestick can't tone-map -> dark pic)
#      - lossless audio (DTS-HD MA / TrueHD / Atmos / DTS-X) demoted
#        (Firestick can't decode -> silent playback)
#    v388's English-first partition runs after this and is stable, so the
#    final pick is: best cached English highest-quality stream.
#
# REQUIRES: v388 applied.
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V397 Full Screen + Quality-First Binge" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found - wrong CWD?" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V397_FULLSCREEN')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}
if (-not $p.Contains('V388_ENGLISH_FIRST')) {
  Write-Host "[FATAL] V388 not applied - run patch_v388.ps1 first!" -ForegroundColor Red
  exit 1
}

# --- 1: full-screen video (no letterbox bars) ---
$old = 'resizeMode={ResizeMode.CONTAIN}'
$new = 'resizeMode={ResizeMode.COVER} /* V397_FULLSCREEN - picture fills the screen, no letterbox bars */'
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing (ResizeMode.CONTAIN)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: full-screen video" -ForegroundColor Green

# --- 2: quality-first ranking on the Play Next fast path ---
$old = @'
          if (list.length === 0) { console.log('[PLAYER v128] no streams for next ep'); return; }
'@
$new = @'
          if (list.length === 0) { console.log('[PLAYER v128] no streams for next ep'); return; }
          /* V397_QUALITY_FIRST - the fast path inherited raw backend (seeder)
             order; v388 below only demotes foreign releases. Rank by what
             actually plays best on the Firestick (same rules as the details
             ranker): cached first, then resolution, HDR/DV and lossless
             audio demoted. v388's English partition after this is stable,
             so the final pick = best cached English highest-quality. */
          const _v397Score = (s: any): number => {
            try {
              const t = String((s && (s.title || s.name || s.filename)) || '').toUpperCase();
              let q = 0;
              if (/\b(2160P?|4K|UHD)\b/.test(t)) q += 400;
              else if (/\b1080P?\b/.test(t)) q += 300;
              else if (/\b720P?\b/.test(t)) q += 200;
              else if (/\bHD\b/.test(t)) q += 100;
              if (s && s.url) q += 5000; /* cached/direct = instant start */
              if (/\bHDR(10\+?)?\b|\bDOLBY[\s.]?VISION\b|\bDV\b/.test(t)) q -= 20000; /* no HDR tone-map on Firestick */
              if (/\bDTS[\s\-:]?X\b|\bDTSX\b|\bTRUEHD\b|\bTRUE[\s\-]?HD\b|\bATMOS\b|\bDTS[\s\-]?HD(\s*MA)?\b/.test(t)) q -= 20000; /* undecodable audio */
              else if (/\bDTS\b/.test(t)) q -= 2000;
              return q;
            } catch (_) { return 0; }
          };
          try {
            list.sort((a: any, b: any) => _v397Score(b) - _v397Score(a));
            const _v397Top = list[0];
            console.log('[PLAYER v397] quality-ranked ' + list.length + ' streams, top: ' + String((_v397Top && (_v397Top.title || _v397Top.name)) || '?').slice(0, 80));
          } catch (_) {}
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing (v128 fast path line)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: quality-first binge ranking" -ForegroundColor Green

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V397 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V397_FULLSCREEN" app\player.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "  On the Firestick: force-close app, open, wait 20s," -ForegroundColor Cyan
Write-Host "  force-close again, reopen." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
