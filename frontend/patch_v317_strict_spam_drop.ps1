# patch_v317_strict_spam_drop.ps1
# V317 - Strict watermark drop policy.  See full rationale in V317 commit
# notes.  This version uses ASCII-only anchors (no em-dashes) to survive
# PowerShell 5.1 codepage decoding.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'

if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else {
    Write-Host '[v317] ERROR: cannot find id.tsx at either app\details\[type]\[id].tsx or app\details\id.tsx'
    exit 1
  }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V317_STRICT_SPAM_DROP') {
  Write-Host '[v317] already patched, skipping'
  exit 0
}

# ---------- 1) Expand top-of-function watermark regex ----------
$bad1 = @'
  const _V292_WATERMARK_RE = /(1xbet|melbet|mostbet|parimatch|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
'@
$good1 = @'
  // V317_STRICT_SPAM_DROP - expanded affiliate list seen on Torrentio.
  const _V292_WATERMARK_RE = /(1xbet|1xstavka|melbet|mostbet|parimatch|4rabet|dafabet|betway|bet365|22bet|stake\.com|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
'@
if (-not $s.Contains($bad1)) { Write-Host '[v317] ERROR: top regex anchor not found'; exit 2 }
$s = $s.Replace($bad1, $good1)

# ---------- 2) Include stream.url in the watermark blob ----------
$bad2 = @'
  const _v296_isWatermark = (s: any): boolean => {
    const blob = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''}`;
    return _V292_WATERMARK_RE.test(blob) || _V292_CAM_RE.test(blob);
  };
'@
$good2 = @'
  const _v296_isWatermark = (s: any): boolean => {
    // V317_STRICT_SPAM_DROP - also scan stream.url to catch spam URLs.
    const blob = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''} ${s?.url || ''}`;
    return _V292_WATERMARK_RE.test(blob) || _V292_CAM_RE.test(blob);
  };
'@
if (-not $s.Contains($bad2)) { Write-Host '[v317] ERROR: _v296_isWatermark anchor not found'; exit 3 }
$s = $s.Replace($bad2, $good2)

# ---------- 3) Flip the hard-drop condition (any-clean instead of clean+cached) ----------
# This is a SMALL, em-dash-free anchor that only replaces the boolean
# check itself.  The surrounding if/else block (which contains em-dashes
# in comments) is left untouched, but its semantics now mean "any-clean".
$bad3 = @'
  const _v296_hasCleanCached = _v296_cleanStreams.some((s: any) => {
    if (!s || !s.infoHash) return false;
    return _v296_cacheMap.get(String(s.infoHash).toLowerCase()) === true;
  });
'@
$good3 = @'
  // V317_STRICT_SPAM_DROP - was a per-stream cached-check via some().
  // Now: any clean stream qualifies for the hard-drop (cached or not).
  // Renamed semantically (still uses _v296_hasCleanCached var so the
  // existing if/else block keeps compiling) - now means "hasCleanAny".
  const _v296_hasCleanCached = _v296_cleanStreams.length > 0;
'@
if (-not $s.Contains($bad3)) { Write-Host '[v317] ERROR: V317 boolean anchor not found'; exit 4 }
$s = $s.Replace($bad3, $good3)

# ---------- 4) Strengthen per-stream watermark soft penalty in computeScore ----------
$bad4 = @'
    {
      const _v296wmBlob = `${(stream as any)?.title || ''} ${(stream as any)?.name || ''} ${(stream as any)?.filename || ''}`;
      const _V296_WM_RE = /(1xbet|melbet|mostbet|parimatch|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
      const _V296_CAM_RE = /\b(cam|ts|tc)\b.*\b(rip|new|source)\b|\b(rip|new|source)\b.*\b(cam|ts|tc)\b/i;
      if (_V296_WM_RE.test(_v296wmBlob) || _V296_CAM_RE.test(_v296wmBlob)) s -= 1500;
    }
'@
$good4 = @'
    {
      // V317_STRICT_SPAM_DROP - blob now includes stream.url; penalty
      // bumped from -1500 to -12000 so a watermarked stream can never
      // outrank a clean one even when it has every other bonus stacked.
      const _v296wmBlob = `${(stream as any)?.title || ''} ${(stream as any)?.name || ''} ${(stream as any)?.filename || ''} ${(stream as any)?.url || ''}`;
      const _V296_WM_RE = /(1xbet|1xstavka|melbet|mostbet|parimatch|4rabet|dafabet|betway|bet365|22bet|stake\.com|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
      const _V296_CAM_RE = /\b(cam|ts|tc)\b.*\b(rip|new|source)\b|\b(rip|new|source)\b.*\b(cam|ts|tc)\b/i;
      if (_V296_WM_RE.test(_v296wmBlob) || _V296_CAM_RE.test(_v296wmBlob)) s -= 12000;
    }
'@
if (-not $s.Contains($bad4)) { Write-Host '[v317] ERROR: V296 score penalty anchor not found'; exit 5 }
$s = $s.Replace($bad4, $good4)

Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host ''
Write-Host '[v317] id.tsx patched - V317_STRICT_SPAM_DROP marker now present'
Write-Host '[v317] After deploy_ota.bat + app restart, on a freshly-released title you should see:'
Write-Host '[v317]   [v296] CLEAN+CACHED available --- dropped N watermarked streams'
Write-Host '[v317] in logcat (the old log line still fires; only the trigger condition changed).'
