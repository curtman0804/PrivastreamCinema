# patch_v416.ps1 - CC-mask + on-screen build stamp
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V416  CC mask + build stamp"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V416_CC_MASK')) { Write-Host "[SKIP] already applied"; exit 0 }

# --- 1. Add state for build stamp visibility ---
$anchor1 = "const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);"
$inject1 = @'
const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);
  /* V416_CC_MASK - build stamp + CC-region mask flag */
  const [_v416Stamp, _setV416Stamp] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => _setV416Stamp(false), 6000);
    return () => clearTimeout(t);
  }, []);
'@
if (-not $p.Contains($anchor1)) { Write-Host "[FATAL] anchor1 missing"; exit 1 }
$p = $p.Replace($anchor1, $inject1)

# --- 2. Add mask + stamp overlays right after the <Video/> component ---
$anchor2 = "            </Pressable>"
$inject2 = @'
            </Pressable>

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

            {/* V416_STAMP - visible boot pill so we can confirm the OTA
                bundle actually reached the Firestick. Auto-hides after 6s. */}
            {_v416Stamp && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 12, right: 12,
                  paddingHorizontal: 10, paddingVertical: 6,
                  backgroundColor: '#E53935',
                  borderRadius: 6,
                  zIndex: 999,
                }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>
                  OTA v416
                </Text>
              </View>
            )}
'@
if (-not $p.Contains($anchor2)) { Write-Host "[FATAL] anchor2 missing"; exit 1 }
$idx = $p.IndexOf($anchor2)
$p = $p.Substring(0, $idx) + $inject2 + $p.Substring($idx + $anchor2.Length)

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v416 patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
