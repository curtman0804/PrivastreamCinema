@echo off
REM deploy_ota.bat ? merges v253 tar-based zip with v416 Expect-header curl fix
setlocal enabledelayedexpansion
set "FRONTEND_DIR=%~dp0"
cd /d "%FRONTEND_DIR%"

if "%PRIVASTREAM_OTA_TOKEN%"=="" (
  echo [ERROR] PRIVASTREAM_OTA_TOKEN env var not set.
  exit /b 1
)

echo === [1/3] Exporting JS bundle ===
if exist dist rmdir /s /q dist
call npx expo export --platform android --output-dir dist
if errorlevel 1 (
  echo [ERROR] expo export failed.
  exit /b 1
)

echo.
echo === [2/3] Zipping dist -^> ota.zip (tar, forward-slash paths) ===
if exist ota.zip del /q ota.zip
pushd dist
tar -a -c -f "..\ota.zip" *
if errorlevel 1 (
  echo [ERROR] tar zip failed.
  popd
  exit /b 1
)
popd
for %%I in (ota.zip) do echo Built ota.zip = %%~zI bytes

echo.
echo === [3/3] Uploading (curl, primary) ===
curl --show-error --http1.1 --tlsv1.2 -H "Expect:" --max-time 180 -X POST ^
  -H "Authorization: Bearer %PRIVASTREAM_OTA_TOKEN%" ^
  -H "x-runtime-version: 1.1.0" ^
  -H "x-platform: android" ^
  -F "file=@ota.zip" ^
  "https://api.privastreamsolutions.com/api/expo-updates/upload"
if not errorlevel 1 (
  echo.
  echo [OK] Upload via curl succeeded
  goto :done
)

echo.
echo [WARN] curl failed, retrying with PowerShell HttpClient fallback...
powershell -NoProfile -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try {" ^
  "  Add-Type -AssemblyName System.Net.Http;" ^
  "  $client = New-Object System.Net.Http.HttpClient;" ^
  "  $client.Timeout = [TimeSpan]::FromSeconds(180);" ^
  "  $client.DefaultRequestHeaders.ExpectContinue = $false;" ^
  "  $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $env:PRIVASTREAM_OTA_TOKEN);" ^
  "  $client.DefaultRequestHeaders.Add('x-runtime-version','1.1.0');" ^
  "  $client.DefaultRequestHeaders.Add('x-platform','android');" ^
  "  $content = New-Object System.Net.Http.MultipartFormDataContent;" ^
  "  $fs = [System.IO.File]::OpenRead((Resolve-Path 'ota.zip'));" ^
  "  $fc = New-Object System.Net.Http.StreamContent($fs);" ^
  "  $fc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/zip');" ^
  "  $content.Add($fc,'file','ota.zip');" ^
  "  $resp = $client.PostAsync('https://api.privastreamsolutions.com/api/expo-updates/upload',$content).GetAwaiter().GetResult();" ^
  "  $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();" ^
  "  Write-Host ('[PS] ' + [int]$resp.StatusCode + ' ' + $body);" ^
  "  $fs.Close();" ^
  "  if (-not $resp.IsSuccessStatusCode) { exit 1 }" ^
  "} catch { Write-Host ('[FAIL] ' + $_.Exception.Message); exit 1 }"

if errorlevel 1 (
  echo [FAIL] Both curl and PowerShell upload failed
  exit /b 1
)

:done
echo.
echo === DONE ===
echo Force-close + reopen the app on the Firestick.
endlocal
