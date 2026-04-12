const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const application = androidManifest.manifest.application[0];
    
    // Force cleartext traffic
    application.$['android:usesCleartextTraffic'] = 'true';
    
    return config;
  });
};
Step 3: Update app.json to use the plugin:
{
  "expo": {
    "name": "Privastream Cinema",
    "slug": "privastreamcinema",
    "version": "1.7.1",
    "orientation": "default",
    "icon": "./assets/images/icon.png",
    "scheme": "privastreamcinema",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.privastream.cinema"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon-foreground.png",
        "monochromeImage": "./assets/images/adaptive-icon-monochrome.png",
        "backgroundColor": "#000000"
      },
      "splash": {
        "image": "./assets/images/logo.png",
        "resizeMode": "contain",
        "backgroundColor": "#000000"
      },
      "package": "com.privastream.cinema",
      "allowBackup": false,
      "versionCode": 20,
      "usesCleartextTraffic": true
    },
    "web": {
      "bundler": "metro",
      "output": "static",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/logo.png",
          "imageWidth": 300,
          "resizeMode": "contain",
          "backgroundColor": "#000000",
          "enableFullScreenImage_legacy": true
        }
      ],
      "expo-font",
      "./plugins/withTVKeyEvents",
      "./plugins/withTVLauncher",
      "./plugins/withCleartextTraffic",
      "expo-video"
    ],
    "experiments": {
      "typedRoutes": true
    },
    "extra": {
      "router": {},
      "eas": {
        "projectId": "734879b5-3cae-4195-b064-cc0c7617b7ae"
      },
      "backendUrl": "http://71.9.152.146:8001"
    },
    "owner": "choyt"
  }
}