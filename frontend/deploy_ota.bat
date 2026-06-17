@echo off
REM v251_deploy_ota.bat (v253-patched: uses `tar` instead of Compress-Archive)
REM
REM PowerShell's Compress-Archive mangles deeply nested paths (it breaks
REM `_expo\static\js\android\entry-*.hbc` on Linux extraction).  Using the
REM `tar` shipped with Windows 10/11 produces a clean cross-platform zip.
REM
REM One-command OTA deploy for Privastream Cinema.
REM Run this from C:\Users\Curtm\PrivastreamCinema\frontend whenever you want
REM to push a JS/asset change to every installed Firestick app within seconds.

setlocal enabledelayedexpansion
set "FRONTEND_DIR=%~dp0"
cd /d "%FRONTEND_DIR%"

REM ---- Token check ------------------------------------------------------------
if "%PRIVASTREAM_OTA_TOKEN%"=="" (
  echo [ERROR] PRIVASTREAM_OTA_TOKEN env var not set.
  echo Set it with:  setx PRIVASTREAM_OTA_TOKEN your-token-here
  echo Then open a NEW Command Prompt and re-run this script.
  exit /b 1
)

REM ---- 1. Export --------------------------------------------------------------
echo.
echo === [1/3] Exporting JS bundle (expo export --platform android) ===
if exist dist rmdir /s /q dist
call npx expo export --platform android --output-dir dist
if errorlevel 1 (
  echo [ERROR] expo export failed.
  exit /b 1
)

REM ---- 2. Zip with `tar` (preserves forward slashes) ---------------------------
echo.
echo === [2/3] Zipping dist -^> ota.zip (using tar for safe paths) ===
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

REM ---- 3. Upload --------------------------------------------------------------
echo.
echo === [3/3] Uploading to api.privastreamsolutions.com ===
curl --show-error -X POST "https://api.privastreamsolutions.com/api/expo-updates/upload" -H "Authorization: Bearer %PRIVASTREAM_OTA_TOKEN%" -H "x-runtime-version: 1.0.0" -H "x-platform: android" -F "file=@ota.zip"
if errorlevel 1 (
  echo.
  echo [ERROR] Upload failed.  Check token + network.
  exit /b 1
)

echo.
echo.
echo === DONE ===
echo Force-close + reopen the app on the Firestick.
echo It will silently download + apply this update on cold start.
echo.
endlocal
