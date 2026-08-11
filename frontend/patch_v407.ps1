# ============================================================================
# patch_v407.ps1 - Frontend: release-name-matched subtitle auto-select +
# auto-enable, filename hints in the picker.
#
# Depends on backend V407_MULTI_SUBS (returns multiple English subs per
# episode with `filename`/`downloads`/`matchedBy` metadata).
#
# WHAT IT DOES:
#   1) src/api/client.ts - extend Subtitle interface with optional
#      filename/downloads/matchedBy/hash fields.
#   2) app/player.tsx - on the first fetch of a non-empty subtitles list,
#      derive the release name from the playing URL, score every English
#      sub against it (moviehash > release-group > source > resolution >
#      downloads) and auto-set selectedSubtitle to the winner. This also
#      auto-enables the overlay because selectedSubtitle -> parseSubtitleFile
#      -> setSubtitleCues -> setCurrentSubtitleText via existing effects.
#   3) app/player.tsx - picker rows show the filename tail so manual
#      selection is now distinguishable.
#
# REQUIRES: v406 applied (frontend), backend V407 patched + restarted.
# Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V407  Frontend subtitle release-match" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1) src\api\client.ts - extend Subtitle type with optional fields
# ---------------------------------------------------------------------------
$cPath = 'src\api\client.ts'
$cAbs = (Resolve-Path -LiteralPath $cPath).Path
$c = [System.IO.File]::ReadAllText($cAbs)

if ($c.Contains('V407_SUB_META')) {
  Write-Host "[SKIP] client.ts already patched" -ForegroundColor Yellow
} else {
  $old = @'
      subtitles: Array<{ id: string; url: string; lang: string; langName: string; }>;
'@
  $new = @'
      /* V407_SUB_META - backend now returns multiple subs per language plus
         OpenSubtitles metadata (filename / downloads / matchedBy / hash).
         All new fields are optional so older backends still work. */
      subtitles: Array<{
        id: string;
        url: string;
        lang: string;
        langName: string;
        filename?: string | null;
        downloads?: number | string | null;
        matchedBy?: string | null;
        hash?: string | null;
      }>;
'@
  if (-not $c.Contains($old)) { Write-Host "[FATAL] client.ts anchor missing" -ForegroundColor Red; exit 1 }
  $c = $c.Replace($old, $new)
  [System.IO.File]::WriteAllText($cAbs, $c)
  Write-Host "[OK] 1: client.ts Subtitle type extended" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 2) app\player.tsx - Subtitle interface extend + auto-match logic
# ---------------------------------------------------------------------------
$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V407_SUB_AUTOMATCH')) {
  Write-Host "[SKIP] player.tsx already patched" -ForegroundColor Yellow
} else {
  # 2a: extend the Subtitle interface
  $old = @'
// Subtitle interface
interface Subtitle {
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2a missing (Subtitle interface)" -ForegroundColor Red; exit 1 }
  # naive extend: assume interface has 4 fields ending }; find the block and rewrite
  # be safe - just add the interface's next-field guard via replace of the header + first body brace
  $newHead = @'
// Subtitle interface (V407_SUB_META - optional metadata for release matching)
interface Subtitle {
  filename?: string | null;
  downloads?: number | string | null;
  matchedBy?: string | null;
  hash?: string | null;
'@
  $p = $p.Replace($old, $newHead)
  Write-Host "[OK] 2a: Subtitle interface extended" -ForegroundColor Green

  # 2b: insert auto-match effect right after subtitleOffset state declaration
  $old = @'
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0); // Offset in ms (positive = subtitles appear later)
'@
  $new = @'
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0); // Offset in ms (positive = subtitles appear later)
  /* V407_SUB_AUTOMATCH - remember the auto-match reason for logging / debug */
  const _v407AutoMatchRef = useRef<{ url: string; reason: string } | null>(null);
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2b missing (subtitleOffset state)" -ForegroundColor Red; exit 1 }
  $p = $p.Replace($old, $new)
  Write-Host "[OK] 2b: auto-match ref added" -ForegroundColor Green

  # 2c: insert the auto-match effect just after setSubtitles(...) so it runs
  # whenever a fresh subtitle list arrives.
  $old = @'
        setSubtitles(response.subtitles);
'@
  $new = @'
        setSubtitles(response.subtitles);
        /* V407_SUB_AUTOMATCH - pick the sub whose release descriptor best
           matches the file we are actually playing, then auto-enable it.
           Score priority: moviehash > release-group > source > resolution
           > downloads. Runs only if user has not already picked one. */
        try {
          const _v407GetRel = (u: string) => {
            try {
              const clean = String(u || '').split('?')[0].split('#')[0];
              const seg = clean.substring(clean.lastIndexOf('/') + 1);
              return decodeURIComponent(seg).replace(/\.(mkv|mp4|avi|webm|ts|m4v)$/i, '').toUpperCase();
            } catch (_) { return ''; }
          };
          const _v407Score = (sub: any, rel: string) => {
            if (!rel) return 0;
            const fn = String(sub.filename || '').toUpperCase();
            if (!fn) return -1;
            if (sub.matchedBy === 'moviehash') return 10000;
            let sc = 0;
            const grp = rel.match(/-([A-Z0-9]{2,10})$/);
            if (grp && fn.includes('-' + grp[1])) sc += 80;
            const resolutions = ['2160P', '1440P', '1080P', '720P', '480P'];
            for (const r of resolutions) if (rel.includes(r) && fn.includes(r)) { sc += 30; break; }
            const sources = ['BLURAY', 'BDRIP', 'WEB-DL', 'WEBDL', 'WEBRIP', 'HDTV', 'DVDRIP'];
            for (const s of sources) if (rel.includes(s) && fn.includes(s)) { sc += 20; break; }
            const codecs = ['X265', 'HEVC', 'X264', 'AVC'];
            for (const cd of codecs) if (rel.includes(cd) && fn.includes(cd)) { sc += 10; break; }
            const dl = Number(sub.downloads || 0);
            sc += Math.min(20, Math.floor(dl / 1000));
            return sc;
          };
          const _rel = _v407GetRel((streamUrl as any) || '');
          const _engSubs = (response.subtitles || []).filter((s: any) => (s.lang === 'eng' || s.lang === 'en'));
          if (_engSubs.length > 0) {
            let _best = _engSubs[0]; let _bestScore = -2;
            let _reason = 'first-english';
            for (const _s of _engSubs) {
              const _sc = _v407Score(_s, _rel);
              if (_sc > _bestScore) { _bestScore = _sc; _best = _s; }
            }
            if (_bestScore >= 10000) _reason = 'moviehash';
            else if (_bestScore >= 80) _reason = 'group+more';
            else if (_bestScore >= 30) _reason = 'resolution+source';
            else if (_bestScore >= 0) _reason = 'downloads-fallback';
            console.log('[V407 SUB AUTOMATCH] score=' + _bestScore + ' reason=' + _reason + ' file=' + String(_best.filename || 'n/a').slice(-50));
            _v407AutoMatchRef.current = { url: _best.url, reason: _reason };
            // Only auto-select if user has not manually picked one already
            if (!selectedSubtitle) setSelectedSubtitle(_best.url);
          }
        } catch (_e) {
          console.log('[V407 SUB AUTOMATCH] error, skipping:', _e);
        }
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2c missing (setSubtitles call)" -ForegroundColor Red; exit 1 }
  # Only replace the FIRST occurrence to avoid touching any stale mirror
  $idx = $p.IndexOf($old)
  $p = $p.Substring(0, $idx) + $new + $p.Substring($idx + $old.Length)
  Write-Host "[OK] 2c: auto-match logic added" -ForegroundColor Green

  # 2d: enrich picker row to show filename tail for disambiguation
  $old = @'
                    <Text style={[
                      styles.subtitleItemText,
                      (item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && styles.subtitleItemTextActive
                    ]}>
'@
  $new = @'
                    <Text style={[
                      styles.subtitleItemText,
                      (item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && styles.subtitleItemTextActive
                    ]}
                    numberOfLines={2}>
'@
  if ($p.Contains($old)) {
    $p = $p.Replace($old, $new)
    Write-Host "[OK] 2d: picker text allows 2 lines" -ForegroundColor Green
  } else {
    Write-Host "[WARN] 2d anchor not found - non-fatal, picker still works" -ForegroundColor DarkYellow
  }

  # 2e: enrich picker item rendering - append filename hint to displayed label
  # Find the block that renders the langName inside the picker; safest: find
  # the closest langName render inside a subtitleItem and wrap it.
  $old = @'
                      styles.subtitleItemText,
                      (item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && styles.subtitleItemTextActive
                    ]}
                    numberOfLines={2}>
                      {item.langName}
'@
  $new = @'
                      styles.subtitleItemText,
                      (item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && styles.subtitleItemTextActive
                    ]}
                    numberOfLines={2}>
                      {item.langName}{(item as any).filename ? '  ·  ' + String((item as any).filename).slice(-40) : ''}{_v407AutoMatchRef.current && _v407AutoMatchRef.current.url === item.url ? '  (auto)' : ''}
'@
  if ($p.Contains($old)) {
    $p = $p.Replace($old, $new)
    Write-Host "[OK] 2e: picker rows show filename hint + auto tag" -ForegroundColor Green
  } else {
    Write-Host "[WARN] 2e anchor not found - non-fatal, no filename shown in picker" -ForegroundColor DarkYellow
  }

  [System.IO.File]::WriteAllText($pAbs, $p)
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V407 frontend applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  On playback: subs auto-enable to the best release-matched" -ForegroundColor Cyan
Write-Host "  English track. Open the CC picker to see filenames listed" -ForegroundColor Cyan
Write-Host "  with '(auto)' tag on the current pick. Off / manual pick" -ForegroundColor Cyan
Write-Host "  still works as before." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
