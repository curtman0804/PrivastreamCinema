const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Makes the app appear in the TV app row on Google TV, Fire TV, etc.
 * Also explicitly sets the app label to ensure correct display name.
 */
const withTVLauncher = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest["uses-feature"]) {
      manifest["uses-feature"] = [];
    }
    const features = manifest["uses-feature"];

    if (!features.some((f) => f.$?.["android:name"] === "android.software.leanback")) {
      features.push({
        $: { "android:name": "android.software.leanback", "android:required": "false" },
      });
    }

    if (!features.some((f) => f.$?.["android:name"] === "android.hardware.touchscreen")) {
      features.push({
        $: { "android:name": "android.hardware.touchscreen", "android:required": "false" },
      });
    }

    // Explicitly set application label to ensure correct name on TV launchers
    const application = manifest.application?.[0];
    if (application) {
      application.$["android:label"] = "Privastream Cinema";
    }

    // Add LEANBACK_LAUNCHER to main activity and set its label too
    const activities = application?.activity || [];
    for (const activity of activities) {
      // Set activity label explicitly
      if (activity.$?.["android:name"] === ".MainActivity") {
        activity.$["android:label"] = "Privastream Cinema";
      }
      
      const intentFilters = activity["intent-filter"] || [];
      for (const filter of intentFilters) {
        const categories = filter.category || [];
        const hasLauncher = categories.some(
          (c) => c.$?.["android:name"] === "android.intent.category.LAUNCHER"
        );
        if (hasLauncher) {
          if (!categories.some((c) => c.$?.["android:name"] === "android.intent.category.LEANBACK_LAUNCHER")) {
            categories.push({
              $: { "android:name": "android.intent.category.LEANBACK_LAUNCHER" },
            });
            filter.category = categories;
          }
        }
      }
    }

    config.modResults.manifest = manifest;
    return config;
  });
};

module.exports = withTVLauncher;