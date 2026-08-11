# patch_v415.ps1 - Defensive reset: force selectedSubtitle to null on
# every player mount and log both the boot and every sub state change to
# the backend devlog. If the "Matt talking" overlay still appears after
# this, we can grep the backend and see who's calling setSelectedSubtitle.

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "========================================="
Write-Host "  V415  Force-null sub state on mount"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V415_DEFENSIVE_RESET')) {
  Write-Host "[SKIP] already applied"; exit 0
}

$old = @'
  const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);
'@
$new = @'
  const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);
  /* V415_DEFENSIVE_RESET - on every player mount, forcibly clear any
     lingering sub selection AND log the state transition to the backend
     so we can see what code path (if any) later flips it back to a URL.
     If a "Matt talking" overlay still shows after this, we'll see the
     setter call in devlog and know which line to kill. */
  useEffect(() => {
    setSelectedSubtitle(null);
    try {
      fetch((process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api/devlog', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: 'V415_BOOT clear selectedSubtitle=null',
      }).catch(() => {});
    } catch (_) {}
  }, []);
  useEffect(() => {
    try {
      fetch((process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api/devlog', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: 'V415_SUB_CHANGE url=' + (selectedSubtitle || 'null'),
      }).catch(() => {});
    } catch (_) {}
  }, [selectedSubtitle]);
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor missing"; exit 1 }
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] defensive reset + devlog trace installed"
Write-Host ""
Write-Host "Then deploy_ota.bat and retest South Park."
Write-Host "After playback attempt, on Hetzner run:"
Write-Host "  docker logs privastream-app --tail 200 | grep V415"
