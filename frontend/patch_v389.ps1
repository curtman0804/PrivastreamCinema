# ============================================================================
# patch_v389.ps1 - back from player always lands on episode info (OTA)
#
# ROOT CAUSE (from backpopup.log): the Play-Next binge fast-path runs
# dismiss(2) + replace('/player') - it pops BOTH the old player AND the
# episode details page. After a binge advance the stack is just
# [Discover, player], so every plain router.back() (hardware back,
# on-screen back, end-of-episode auto-back, popup "Go Back") lands
# straight on Discover.
#
# FIX: shared _v389SmartBack() - inspect the nav stack; if a details
# screen sits directly beneath the player, normal pop. Otherwise route to
# the CURRENT episode's info page. Chains with V386: episode info ->
# series root -> Discover, exactly the hierarchy the user expects.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V389 Player Smart Back" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V389_SMART_BACK')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}

# --- 1: import useNavigation ---
$old = @'
import { useLocalSearchParams, useRouter } from 'expo-router';
'@
$new = @'
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: import" -ForegroundColor Green

# --- 2: shared smart-back helper ---
$old = @'
  // ============================================================
  // BACK_BUTTON_INTERCEPTOR_V2 (Stremio-style binge-stack killer)
'@
$new = @'
  /* V389_SMART_BACK - the binge fast-path (dismiss(2) + replace) leaves NO
     details page beneath the player, so a plain router.back() lands on
     Discover. If a details screen sits directly beneath us, pop normally;
     otherwise route to the CURRENT episode's info page. */
  const _v389Nav = useNavigation();
  const _v389SmartBack = useCallback((): boolean => {
    try {
      const _st: any = (_v389Nav as any)?.getState ? (_v389Nav as any).getState() : null;
      const _routes: any[] = (_st && _st.routes) ? _st.routes : [];
      const _idx = (typeof _st?.index === 'number') ? _st.index : (_routes.length - 1);
      const _prev = _idx > 0 ? _routes[_idx - 1] : null;
      const _prevName = _prev ? String(_prev.name || '') : '';
      if (_prevName.indexOf('details') !== -1) { router.back(); return true; }
      let target: string | null = null;
      if (seriesId && season && episode) {
        target = `/details/series/${seriesId}:${season}:${episode}`;
      } else if (contentId) {
        const cid = String(contentId);
        const base = cid.includes(':') ? cid.split(':')[0] : cid;
        target = `/details/${(contentType as string) || 'movie'}/${base}`;
      }
      if (target) {
        console.log('[V389_BACK] no details beneath player - routing to ' + target);
        router.replace(target as any);
        return true;
      }
      router.back();
      return true;
    } catch (_) {
      try { router.back(); } catch (__) {}
      return true;
    }
  }, [_v389Nav, seriesId, season, episode, contentId, contentType, router]);

  // ============================================================
  // BACK_BUTTON_INTERCEPTOR_V2 (Stremio-style binge-stack killer)
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: helper" -ForegroundColor Green

# --- 3: hardware back uses smart back ---
$old = @'
    const sub = BackHandler.addEventListener('hardwareBackPress', () => false);
'@
$new = @'
    const sub = BackHandler.addEventListener('hardwareBackPress', () => _v389SmartBack()); /* V389_SMART_BACK */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: hardware back" -ForegroundColor Green

# --- 4: end-of-episode auto-back (status handler) ---
$old = @'
        } else if (!showNextEpisodeModal) {
          // Modal was dismissed or never shown, go back
          router.back();
        }
'@
$new = @'
        } else if (!showNextEpisodeModal) {
          // Modal was dismissed or never shown, go back
          _v389SmartBack(); /* V389_SMART_BACK */
        }
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 4 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 4: end-of-episode auto-back" -ForegroundColor Green

# --- 5: handlePlaybackEnd fallback ---
$old = @'
    } else if (!showNextEpisodeModal) {
      // No next episode or popup was dismissed - go back
      router.back();
    }
'@
$new = @'
    } else if (!showNextEpisodeModal) {
      // No next episode or popup was dismissed - go back
      _v389SmartBack(); /* V389_SMART_BACK */
    }
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 5 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 5: playback-end fallback" -ForegroundColor Green

# --- 6: popup "Go Back" button ---
$old = @'
    setShowNextEpisodeModal(false);
    router.back();
  };
'@
$new = @'
    setShowNextEpisodeModal(false);
    _v389SmartBack(); /* V389_SMART_BACK */
  };
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 6 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 6: popup Go Back" -ForegroundColor Green

# --- 7: on-screen back button ---
$old = @'
  const handleBack = () => {
    router.back();
  };
'@
$new = @'
  const handleBack = () => {
    _v389SmartBack(); /* V389_SMART_BACK */
  };
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 7 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 7: on-screen back" -ForegroundColor Green

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host ""
Write-Host "[DONE] player.tsx written. Run deploy_ota.bat, relaunch twice." -ForegroundColor Green
Write-Host ""
