# ============================================================================
# patch_v385.ps1 - kill the loading-screen "takeover" flash (OTA)
#
# ROOT CAUSE (post-V384): the details autoplay overlay rendered its backdrop
# and logo with React Native's Image (Fresco cache) while the player's
# loading screen uses expo-image (Glide cache). Same URI, DIFFERENT cache:
# the player re-downloaded + re-decoded the backdrop on mount, producing a
# visible flash/fade that reads as "a second loading screen taking over".
#
# FIX: overlay now uses expo-image for backdrop + logo. Both screens share
# one image cache, so the player's loading screen paints the same pixels
# instantly from memory.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V385 Seamless Loading Handoff" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$dPath = Get-ChildItem -Path 'app' -Recurse -File | Where-Object { $_.Name -eq '[id].tsx' } | Select-Object -First 1
if (-not $dPath) { Write-Host "[FATAL] [id].tsx not found" -ForegroundColor Red; exit 1 }
$d = [System.IO.File]::ReadAllText($dPath.FullName)

if ($d.Contains('V385_SHARED_IMAGE_CACHE')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}

# --- 1: overlay backdrop RNImage -> expo-image ---
$old = @'
            <RNImage
              source={{ uri: (currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) as string }}
              style={StyleSheet.absoluteFillObject}
              blurRadius={8}
              resizeMode="cover"
            />
'@
$new = @'
            <Image
              /* V385_SHARED_IMAGE_CACHE - expo-image, same engine + cache as
                 the player's loading screen, so its backdrop paints
                 instantly from memory with zero flash on handoff. */
              source={{ uri: (currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) as string }}
              style={StyleSheet.absoluteFillObject}
              blurRadius={8}
              contentFit="cover"
            />
'@
if (-not $d.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$d = $d.Replace($old, $new)
Write-Host "[OK] 1: overlay backdrop -> expo-image" -ForegroundColor Green

# --- 2: overlay logo RNImage -> expo-image ---
$old = @'
            {content?.logo ? (
              <RNImage
                source={{ uri: content.logo }}
                style={{ width: 280, height: 90, marginBottom: 20 }}
                resizeMode="contain"
              />
'@
$new = @'
            {content?.logo ? (
              <Image
                source={{ uri: content.logo }}
                style={{ width: 280, height: 90, marginBottom: 20 }}
                contentFit="contain"
              />
'@
if (-not $d.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$d = $d.Replace($old, $new)
Write-Host "[OK] 2: overlay logo -> expo-image" -ForegroundColor Green

[System.IO.File]::WriteAllText($dPath.FullName, $d)
Write-Host ""
Write-Host "[DONE] [id].tsx written. Run deploy_ota.bat, relaunch twice." -ForegroundColor Green
Write-Host ""
