# patch_v326_tos_gate.ps1
# V326 - Install ToSGate.tsx into src\components and wire it into the
# Addons tab so it appears on first entry.  Stores acceptance flag in
# AsyncStorage.  Sends audit-log POST to backend /api/legal/tos-accept.

$ErrorActionPreference = 'Stop'

# 1. Download ToSGate.tsx into src\components
$dst = 'src\components\ToSGate.tsx'
if (-not (Test-Path 'src\components')) {
  Write-Host '[v326] ERROR: src\components directory not found'
  exit 1
}
Invoke-WebRequest -Uri 'https://git-update-staging.preview.emergentagent.com/api/raw/ToSGate.tsx?bust=v326' -OutFile $dst -UseBasicParsing
Write-Host "[v326] wrote $dst"

# 2. Wire it into addons.tsx
$addons = 'app\(tabs)\addons.tsx'
if (-not (Test-Path -LiteralPath $addons)) { Write-Host '[v326] ERROR: addons.tsx not found'; exit 2 }
$a = Get-Content -Raw -LiteralPath $addons

if ($a -match 'V326_TOS_GATE') {
  Write-Host '[v326] addons.tsx already wired, skipping'
  exit 0
}

# Add import at the top (after existing react import)
$importBad = "import React"
$importGood = "import React  // V326_TOS_GATE`r`nimport { ToSGate, hasAcceptedToS } from '../../src/components/ToSGate';`r`nimport React"
# Use first occurrence only - PowerShell .Replace replaces ALL, so use regex with first-match.
$regex = [regex]"import React"
$a = $regex.Replace($a, "import { ToSGate, hasAcceptedToS } from '../../src/components/ToSGate';`r`nimport React", 1)

# Wrap the default-exported component's return in a Fragment with the gate.
# Look for "export default function" - inject state + effect at top of fn,
# and a <ToSGate ... /> at the start of the returned JSX.
# Anchor on the function body's first useState or first hook.
$markerBad = "export default function"
if (-not $a.Contains($markerBad)) { Write-Host '[v326] ERROR: export default function not found'; exit 3 }

# Inject a hook to manage gate visibility right after the function signature.
# We use a regex to find the first `{` after the export default function.
$pattern = [regex]"export default function\s+\w+\s*\([^)]*\)\s*\{"
$match = $pattern.Match($a)
if (-not $match.Success) { Write-Host '[v326] ERROR: addons function signature pattern not found'; exit 4 }
$insertPos = $match.Index + $match.Length
$gateState = @"

  // V326_TOS_GATE - one-time Terms of Service on first Addons entry
  const [_v326TosVisible, _setV326TosVisible] = React.useState(false);
  React.useEffect(() => {
    hasAcceptedToS().then((acked) => { if (!acked) _setV326TosVisible(true); });
  }, []);
"@
$a = $a.Substring(0, $insertPos) + $gateState + $a.Substring($insertPos)

# Append the ToSGate rendering just before the function's final closing brace.
# We use a hack: find the last `}` of the file and inject before the last `return (`.
# Simpler: wrap the return statement.  Find `return (` (first occurrence) inside the fn.
$retIdx = $a.IndexOf("return (", $insertPos)
if ($retIdx -lt 0) { Write-Host '[v326] ERROR: return ( not found in component'; exit 5 }
# Insert the gate just after the opening paren, as part of a Fragment.
# Find the matching first child of the return.
$openParen = $a.IndexOf("(", $retIdx)
# Insert: <><ToSGate visible=... onAccepted=... />  then the original child
# and we'll close </> right before the matching close.  Easier: just put
# the gate AT THE END inside the return.  Many existing top-level returns
# are a single <View>... so we sit alongside it via Fragment.
$gateJsx = @"

    <>
      <ToSGate visible={_v326TosVisible} onAccepted={() => _setV326TosVisible(false)} />

"@
# Insert <Fragment open + ToSGate after the `(` of `return (`
$a = $a.Substring(0, $openParen + 1) + $gateJsx + $a.Substring($openParen + 1)

# Find the matching close `)` of the return - count parens.  We assume
# the return is structured `return ( <View>...</View> );` so we add `</>`
# before the closing `)`.
$depth = 1
$i = $openParen + 1 + $gateJsx.Length
while ($i -lt $a.Length -and $depth -gt 0) {
  $ch = $a[$i]
  if ($ch -eq '(') { $depth++ }
  elseif ($ch -eq ')') { $depth-- }
  if ($depth -eq 0) { break }
  $i++
}
if ($depth -ne 0) { Write-Host '[v326] ERROR: could not find matching close paren'; exit 6 }
$a = $a.Substring(0, $i) + "`r`n    </>`r`n  " + $a.Substring($i)

Set-Content -LiteralPath $addons -Value $a -NoNewline -Encoding UTF8
Write-Host "[v326] wired ToSGate into $addons"
Write-Host '[v326] DONE - run deploy_ota.bat, restart app, navigate to Addons tab to test.'
