@echo off
rmdir /s /q android
npx expo prebuild --platform android --clean

REM Add usesCleartextTraffic to manifest
powershell -Command "(Get-Content 'android\app\src\main\AndroidManifest.xml') -replace 'android:name=\".MainApplication\"', 'android:name=\".MainApplication\" android:usesCleartextTraffic=\"true\"' | Set-Content 'android\app\src\main\AndroidManifest.xml'"

cd android
gradlew clean assembleRelease
cd ..
echo Build complete!