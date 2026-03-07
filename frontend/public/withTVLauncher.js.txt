const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Makes the app appear in the TV app row on Google TV, Fire TV, etc.
 * - Adds LEANBACK_LAUNCHER category to MainActivity intent filter
 * - Declares leanback and touchscreen features
 */
const withTVLauncher = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest["uses-feature"]) {
      manifest["uses-feature"] = [];
    }
    const features = manifest["uses-feature"];

    // Leanback feature (not required - works on both TV and mobile)
    if (!features.some((f) => f.$?.["android:name"] === "android.software.leanback")) {
      features.push({
        $: { "android:name": "android.software.leanback", "android:required": "false" },
      });
    }

    // Touchscreen not required
    if (!features.some((f) => f.$?.["android:name"] === "android.hardware.touchscreen")) {
      features.push({
        $: { "android:name": "android.hardware.touchscreen", "android:required": "false" },
      });
    }

    // Add LEANBACK_LAUNCHER to main activity
    const application = manifest.application?.[0];
    const activities = application?.activity || [];
    for (const activity of activities) {
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
