# patch_v347_tos_focus_visible.ps1
# Fixes: "cant see the selector on i agree" — makes the ToS "I Agree" button
# visually prominent by default + adds a strong focused state that's
# unambiguous on Firestick's TV display.
#
# Run from: C:\Users\Curtm\PrivastreamCinema\frontend
# curl.exe -fsSL "https://git-update-staging.preview.emergentagent.com/api/raw/patch_v347_tos_focus_visible.ps1" -o patch_v347.ps1
# powershell -ExecutionPolicy Bypass -File .\patch_v347.ps1

$ErrorActionPreference = 'Stop'
$file = 'src\components\ToSGate.tsx'
if (-not (Test-Path $file)) {
  Write-Host "[V347] ERROR: $file not found. Run this from the frontend/ directory." -ForegroundColor Red
  exit 1
}

Write-Host "[V347] Patching ToSGate.tsx focus visibility..." -ForegroundColor Cyan

$content = Get-Content $file -Raw
Copy-Item $file "$file.bak.v347" -Force
Write-Host "  backup -> $file.bak.v347"

$patched = 0

# --- 1. agreeBtn base style: always show a visible white border + shadow ---
$old1 = "  agreeBtn: { marginTop: 16, backgroundColor: GOLD, borderRadius: 10, paddingVertical: 18, alignItems: 'center', borderWidth: 4, borderColor: 'transparent' },"
$new1 = "  agreeBtn: { marginTop: 16, backgroundColor: GOLD, borderRadius: 10, paddingVertical: 22, alignItems: 'center', borderWidth: 5, borderColor: '#ffffff', shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.85, shadowRadius: 20, elevation: 16, transform: [{ scale: 1.04 }] },"
if ($content.Contains($old1)) {
  $content = $content.Replace($old1, $new1)
  Write-Host "  patched agreeBtn base style" -ForegroundColor Green
  $patched++
} else {
  Write-Host "  WARN: agreeBtn base pattern not found (already patched?)" -ForegroundColor Yellow
}

# --- 2. agreeBtnFocused: bigger scale + brighter white glow ---
$old2 = "  agreeBtnFocused: { borderColor: '#ffffff', backgroundColor: GOLD_BRIGHT, shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 24, elevation: 18, transform: [{ scale: 1.04 }] },"
$new2 = "  agreeBtnFocused: { borderColor: '#ffffff', backgroundColor: GOLD_BRIGHT, shadowColor: '#ffffff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 44, elevation: 28, transform: [{ scale: 1.12 }] },"
if ($content.Contains($old2)) {
  $content = $content.Replace($old2, $new2)
  Write-Host "  patched agreeBtnFocused style" -ForegroundColor Green
  $patched++
} else {
  Write-Host "  WARN: agreeBtnFocused pattern not found" -ForegroundColor Yellow
}

# --- 3. agreeBtnText: bigger, bolder ---
$old3 = "  agreeBtnText: { color: BG, fontSize: 22, fontWeight: '800', letterSpacing: 1 },"
$new3 = "  agreeBtnText: { color: BG, fontSize: 28, fontWeight: '900', letterSpacing: 2 },"
if ($content.Contains($old3)) {
  $content = $content.Replace($old3, $new3)
  Write-Host "  patched agreeBtnText style" -ForegroundColor Green
  $patched++
} else {
  Write-Host "  WARN: agreeBtnText pattern not found" -ForegroundColor Yellow
}

# --- 4. Improve focus() reliability: retry 3 times, longer delays ---
$oldEffect = @'
  useEffect(() => {
    if (!reachedBottom) return;
    const t = setTimeout(() => {
      // @ts-ignore RN TV
      agreeBtnRef.current?.focus?.();
    }, 120);
    return () => clearTimeout(t);
  }, [reachedBottom]);
'@

$newEffect = @'
  useEffect(() => {
    if (!reachedBottom) return;
    // V347: multiple focus attempts — Firestick sometimes drops the first call
    const tries: ReturnType<typeof setTimeout>[] = [];
    [120, 350, 700, 1200].forEach((delay) => {
      tries.push(setTimeout(() => {
        // @ts-ignore RN TV
        agreeBtnRef.current?.focus?.();
      }, delay));
    });
    return () => { tries.forEach(clearTimeout); };
  }, [reachedBottom]);
'@

if ($content.Contains($oldEffect)) {
  $content = $content.Replace($oldEffect, $newEffect)
  Write-Host "  patched focus useEffect with retries" -ForegroundColor Green
  $patched++
} else {
  Write-Host "  WARN: focus useEffect pattern not found (line ending mismatch?)" -ForegroundColor Yellow
}

# --- Change button text to include a hint arrow for extra clarity ---
$oldText = @'
              <Text style={styles.agreeBtnText}>
                {submitting ? 'Recording…' : 'I Agree'}
              </Text>
'@

$newText = @'
              <Text style={styles.agreeBtnText}>
                {submitting ? 'Recording…' : '► I AGREE ◄'}
              </Text>
'@

if ($content.Contains($oldText)) {
  $content = $content.Replace($oldText, $newText)
  Write-Host "  patched I Agree label with arrow hints" -ForegroundColor Green
  $patched++
}

Set-Content -Path $file -Value $content -NoNewline

Write-Host ""
Write-Host "[V347] Done. Applied $patched patches to ToSGate.tsx" -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1) deploy_ota.bat"
Write-Host "  2) Force-close app on Firestick, reopen twice (once to fetch OTA, once to apply)"
Write-Host "  3) The 'I AGREE' button will now have a bright white border + arrows + glow"
