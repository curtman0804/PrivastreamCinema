/**
 * Expo Config Plugin for nodejs-mobile-react-native
 * Handles Android Gradle and manifest setup for embedding Node.js runtime
 */
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

function withNodejsMobile(config) {
  // Ensure BUILD_NATIVE_MODULES.txt is set to 0
  // Our nodejs-project has no native (.gyp) modules, so skip the native build
  // which requires a specific Node.js version that may not match the build environment
  config = withDangerousMod(config, ['android', (config) => {
    const buildNativeModulesFile = path.join(
      config.modRequest.projectRoot,
      'nodejs-assets',
      'BUILD_NATIVE_MODULES.txt'
    );
    const dir = path.dirname(buildNativeModulesFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(buildNativeModulesFile, '0\n');
    console.log('[nodejs-mobile plugin] BUILD_NATIVE_MODULES.txt set to 0');
    return config;
  }]);

  // Modify Android app/build.gradle
  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let contents = config.modResults.contents;
      
      // Add NDK ABI filters if not present
      if (!contents.includes('abiFilters')) {
        contents = contents.replace(
          'defaultConfig {',
          'defaultConfig {\n        ndk {\n            abiFilters "arm64-v8a", "armeabi-v7a", "x86", "x86_64"\n        }'
        );
      }
      
      // Add packaging options for Node.js native libs
      if (!contents.includes('pickFirst')) {
        contents = contents.replace(
          'android {',
          'android {\n    packagingOptions {\n        pickFirst "**/libc++_shared.so"\n        pickFirst "**/libnode.so"\n    }'
        );
      }
      
      config.modResults.contents = contents;
    }
    return config;
  });

  return config;
}

module.exports = withNodejsMobile;
