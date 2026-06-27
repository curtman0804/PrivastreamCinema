# patch_v317_strict_spam_drop.ps1
# V317 - "I would rather get nothing than spam" treatment for watermarked
# torrents (1xbet, melbet, mostbet, parimatch, telesync, hdcam, ftcam, etc.).
#
# Root cause of bug
# -----------------
# Pre-V317 logic (V292/V296):
#   - Soft-penalize watermarked streams by -1500
#   - HARD-drop them ONLY if a clean+cached PM alternative existed
#   - Otherwise keep them as "fallback" so the user always gets SOMETHING
# Side effect:
#   - PM cached bonus is +5000.  Soft penalty is -1500.
#   - A watermarked CACHED stream beats a clean UNCACHED stream by ~3500 pts
#     even when both have identical quality.
#   - For new releases (Pressure 2025, Project Hail Mary) where PM has
#     only-cached the watermarked cam-rip, the auto-pick goes to the
#     1xbet rip.  User watches a sports-betting affiliate scam instead of
#     the movie.
#
# V317 fix
# --------
# 1. Drop watermarked whenever ANY clean stream exists (cached OR uncached).
#    PM can resolve an uncached clean torrent in 2-5 seconds; that small
#    delay is infinitely better than playing 1xbet content.
# 2. Bump watermark soft penalty from -1500 to -12000 so even if a stream
#    survives the hard-drop (no clean alternative), it can no longer
#    outrank quality or cached signals.
# 3. Add `stream.url` to the watermark blob so spam URLs (e.g. URL itself
#    contains "1xbet.com") are detected even if title/name look clean.
# 4. Expand the spam regex with a few additional known affiliates seen
#    in the wild (1xstavka, 4rabet, dafabet, etc.).
#
# Touches only app\details\[type]\[id].tsx (delivered as id.tsx in your
# local repo layout).

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'

if (-not (Test-Path -LiteralPath $f)) {
  # fallback layout
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

# ---------- 3a) Expand the watermark detection regex (top of fn) ----------
$bad1 = @'
  const _V292_WATERMARK_RE = /(1xbet|melbet|mostbet|parimatch|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
'@
$good1 = @'
  // V317_STRICT_SPAM_DROP - expanded affiliate list seen on Torrentio.
  const _V292_WATERMARK_RE = /(1xbet|1xstavka|melbet|mostbet|parimatch|4rabet|dafabet|betway|bet365|22bet|stake\.com|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
'@
if (-not $s.Contains($bad1)) {
  Write-Host '[v317] ERROR: V292 watermark regex anchor not found at top of sortStreamsByLanguage'
  exit 2
}
$s = $s.Replace($bad1, $good1)

# ---------- 3b) Include stream.url in the watermark blob ----------
$bad2 = @'
  const _v296_isWatermark = (s: any): boolean => {
    const blob = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''}`;
    return _V292_WATERMARK_RE.test(blob) || _V292_CAM_RE.test(blob);
  };
'@
$good2 = @'
  const _v296_isWatermark = (s: any): boolean => {
    // V317_STRICT_SPAM_DROP - also check stream.url so spam-only URLs
    // (e.g. proxy redirects through 1xbet.com) get caught even when
    // the torrent title looks innocent.
    const blob = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''} ${s?.url || ''}`;
    return _V292_WATERMARK_RE.test(blob) || _V292_CAM_RE.test(blob);
  };
'@
if (-not $s.Contains($bad2)) { Write-Host '[v317] ERROR: _v296_isWatermark anchor not found'; exit 3 }
$s = $s.Replace($bad2, $good2)

# ---------- 3c) Flip the hard-drop condition from "clean+cached" to "any clean" ----------
$bad3 = @'
  // V296 â€” check whether any CLEAN (non-watermarked) stream is known
  // PM-cached.  Only then is it safe to hard-drop the watermarked ones.
  // _v296_cacheMap is populated by the component's PM /cache/check effect.
  const _v296_cleanStreams = streams.filter((s: any) => !_v296_isWatermark(s));
  const _v296_hasCleanCached = _v296_cleanStreams.some((s: any) => {
    if (!s || !s.infoHash) return false;
    return _v296_cacheMap.get(String(s.infoHash).toLowerCase()) === true;
  });
  if (_v296_hasCleanCached) {
    const _before = streams.length;
    streams = _v296_cleanStreams;
    if (_before !== streams.length) {
      console.log('[v296] CLEAN+CACHED available â€” dropped', _before - streams.length, 'watermarked streams (of', _before + ')');
    }
  } else {
    // No clean+cached. Keep ALL streams (clean + watermarked) so the user
    // still gets playback â€” the score sort below ensures clean ranks
    // higher than watermarked.  This rescues titles like Project Hail Mary
    // whose only cached option is watermarked.
    const _wm = streams.filter(_v296_isWatermark).length;
    if (_wm > 0) {
      console.log('[v296] no clean+cached â€” keeping', _wm, 'watermarked stream(s) as fallback');
    }
  }
'@
$good3 = @'
  // V317_STRICT_SPAM_DROP - "rather nothing than spam" policy.
  // Hard-drop watermarked streams whenever ANY clean alternative exists,
  // cached or not.  PM can resolve a clean uncached torrent in 2-5s; that
  // small delay beats playing a 1xbet betting-affiliate cam-rip every time.
  // Only retain watermarked streams when LITERALLY no clean source exists
  // for the title (e.g. pre-release leaks), so the user can still choose
  // to play instead of getting "no streams available".
  const _v296_cleanStreams = streams.filter((s: any) => !_v296_isWatermark(s));
  if (_v296_cleanStreams.length > 0) {
    const _before = streams.length;
    streams = _v296_cleanStreams;
    if (_before !== streams.length) {
      console.log('[v317] strict-drop: removed', _before - streams.length, 'watermarked stream(s); kept', streams.length, 'clean');
    }
  } else {
    console.log('[v317] strict-drop: NO clean streams for this title - keeping', streams.length, 'watermarked as last-resort');
  }
'@
if (-not $s.Contains($bad3)) { Write-Host '[v317] ERROR: V296 hard-drop block anchor not found'; exit 4 }
$s = $s.Replace($bad3, $good3)

# ---------- 3d) Strengthen the per-stream watermark soft penalty inside computeScore ----------
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
      // V317_STRICT_SPAM_DROP - blob now includes stream.url; penalty bumped
      // from -1500 to -12000 so a watermarked stream can never outrank a
      // clean one even if the watermarked one has every other bonus.
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
Write-Host '[v317]   [v317] strict-drop: removed N watermarked stream(s); kept M clean'
Write-Host '[v317] in logcat.  Top pick should be a clean uncached torrent (PM resolves in ~3s).'
Write-Host '[v317] Last-resort fallback message appears ONLY when literally no clean source exists.'
