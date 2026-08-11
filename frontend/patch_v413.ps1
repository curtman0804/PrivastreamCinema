# ============================================================================
# patch_v413.ps1 - Frontend: use OS.com REST API's foreign_parts_only flag.
#
# The v411 auto-loader used filename regex to detect "Forced" subs.  With
# backend v413 the REST API returns an authoritative boolean flag, so we
# switch to that.  100% precise; no more filename guesswork.
#
# Also the sub URLs now point to /api/subtitles/link/<file_id> (backend
# proxies the OS.com download endpoint).  Frontend `fetch()` follows
# the 302 redirect automatically - no code change needed to load them.
#
# REQUIRES: v411 applied + backend v413 live on Hetzner. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V413  Use foreign_parts_only flag" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V411_FORCED_PREFERRED')) {
  Write-Host "[FATAL] v411 not applied first" -ForegroundColor Red; exit 1
}
if ($p.Contains('V413_FLAG_BASED')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

# Swap the filename-regex forced detection for the REST API flag.
$old = @'
            const _v411_isForced = (fn: any) => {
              const _f = String(fn || '');
              return /(?:^|[._\-\s])(?:forced|foreign[._\-\s]*parts?[._\-\s]*only|foreign[._\-\s]*only)/i.test(_f);
            };
            const _v411_forced = (response.subtitles || []).find((s: any) => (
              (s.lang === 'eng' || s.lang === 'en') && _v411_isForced((s as any).filename)
            ));
'@
$new = @'
            /* V413_FLAG_BASED - use the REST API's authoritative
               foreign_parts_only boolean instead of filename regex.
               Falls back to filename regex if the flag is absent
               (e.g. Stremio fallback path). */
            const _v411_isForced = (fn: any) => {
              const _f = String(fn || '');
              return /(?:^|[._\-\s])(?:forced|foreign[._\-\s]*parts?[._\-\s]*only|foreign[._\-\s]*only)/i.test(_f);
            };
            const _v411_forced = (response.subtitles || []).find((s: any) => {
              const _langOk = (s.lang === 'eng' || s.lang === 'en');
              if (!_langOk) return false;
              if ((s as any).foreign_parts_only === true) return true;
              return _v411_isForced((s as any).filename);
            });
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor missing (v411 forced detection)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host "[OK] forced-sub detection now uses foreign_parts_only flag" -ForegroundColor Green
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V413 frontend applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Expected: SP picks release-matched English sub with proper" -ForegroundColor Cyan
Write-Host "  timing.  Shang-Chi still auto-captions Mandarin (via the" -ForegroundColor Cyan
Write-Host "  foreign_parts_only flag now, not filename guessing)." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
