# patch_v417_frontend.ps1 - Pass stream release/filename to sub endpoint
# so backend can match subs to the actual stream being played.
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V417  Frontend: send release to subs API"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V417_RELEASE_MATCH')) { Write-Host "[SKIP] already applied"; exit 0 }

# 1. Rewrite fetchSubtitles signature to accept and forward release info.
$anchor1 = "const response = await api.subtitles.get(cType, cId);"
$inject1 = @'
/* V417_RELEASE_MATCH - forward the current stream's release/filename
   to the backend so it can rank subs by release-token match instead of
   just download count (which returns the wrong cut for many series). */
const _v417_release = (typeof filename === 'string' ? filename : '') || (typeof title === 'string' ? title : '') || '';
const _v417_streamName = (typeof streamUrl === 'string' ? streamUrl.split('/').pop() || '' : '');
const _v417_hint = encodeURIComponent(_v417_streamName || _v417_release);
const response = await api.subtitles.get(cType, cId + (_v417_hint ? ('?release=' + _v417_hint) : ''));
'@
if (-not $p.Contains($anchor1)) { Write-Host "[FATAL] anchor1 missing"; exit 1 }
$p = $p.Replace($anchor1, $inject1)

# 2. Remove the v416 mask (was pointless - CC isn't from ExoPlayer)
#    but KEEP the v416 build stamp so we can tell bundles apart.
$maskBlock = @'
            {/* V416_CC_MASK - hide embedded ExoPlayer CC track (baked-in
                CEA-608 that expo-av cannot disable). Only shown when the
                user has subs OFF; when they enable a track we lift the
                mask so our own overlay is visible. */}
            {!selectedSubtitle && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0, right: 0, bottom: 0,
                  height: '18%',
                  backgroundColor: 'black',
                  zIndex: 3,
                }}
              />
            )}

'@
if ($p.Contains($maskBlock)) {
  $p = $p.Replace($maskBlock, "")
  Write-Host "[OK] v416 mask removed"
}

# 3. Bump the build-stamp text so we can visually confirm this new bundle.
$p = $p.Replace("OTA v416", "OTA v417")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v417 frontend patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
