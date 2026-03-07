const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that adds Android TV / Google TV launcher support.
 * - Adds LEANBACK_LAUNCHER category to MainActivity intent filter
 * - Declares android.software.leanback as optional
 * - Declares touchscreen as not required (TVs have no touchscreen)
 * - Adds banner attribute for TV launcher icon
 * - Copies tv_banner.png to Android drawable resources
 *
 * This makes the app appear in the TV app row on Google TV, Fire TV, etc.
 */
const withTVLauncher = (config) => {
  // Step 1: Modify AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Add uses-feature declarations
    if (!manifest["uses-feature"]) {
      manifest["uses-feature"] = [];
    }

    const features = manifest["uses-feature"];

    // Add leanback feature (required=false so it works on both TV and mobile)
    const hasLeanback = features.some(
      (f) => f.$?.["android:name"] === "android.software.leanback"
    );
    if (!hasLeanback) {
      features.push({
        $: {
          "android:name": "android.software.leanback",
          "android:required": "false",
        },
      });
    }

    // Declare touchscreen not required (TVs don't have touchscreens)
    const hasTouchscreen = features.some(
      (f) => f.$?.["android:name"] === "android.hardware.touchscreen"
    );
    if (!hasTouchscreen) {
      features.push({
        $: {
          "android:name": "android.hardware.touchscreen",
          "android:required": "false",
        },
      });
    }

    // Add banner to the application element
    const application = manifest.application?.[0];
    if (application) {
      application.$["android:banner"] = "@drawable/tv_banner";
    }

    // Add LEANBACK_LAUNCHER category to MainActivity's intent filter
    const activities = application?.activity || [];
    for (const activity of activities) {
      const intentFilters = activity["intent-filter"] || [];
      for (const filter of intentFilters) {
        const categories = filter.category || [];
        const hasLauncher = categories.some(
          (c) => c.$?.["android:name"] === "android.intent.category.LAUNCHER"
        );

        if (hasLauncher) {
          const hasLeanbackLauncher = categories.some(
            (c) =>
              c.$?.["android:name"] ===
              "android.intent.category.LEANBACK_LAUNCHER"
          );
          if (!hasLeanbackLauncher) {
            categories.push({
              $: {
                "android:name": "android.intent.category.LEANBACK_LAUNCHER",
              },
            });
            filter.category = categories;
          }
        }
      }
    }

    config.modResults.manifest = manifest;
    return config;
  });

  // Step 2: Copy tv_banner.png to Android drawable folder
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcBanner = path.join(
        projectRoot,
        "assets",
        "images",
        "tv_banner.png"
      );
      const drawableDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "res",
        "drawable"
      );
      const destBanner = path.join(drawableDir, "tv_banner.png");

      // Create drawable directory if it doesn't exist
      if (!fs.existsSync(drawableDir)) {
        fs.mkdirSync(drawableDir, { recursive: true });
      }

      // Copy the banner image
      if (fs.existsSync(srcBanner)) {
        fs.copyFileSync(srcBanner, destBanner);
        console.log("[withTVLauncher] Copied tv_banner.png to drawable");
      } else {
        console.warn(
          "[withTVLauncher] tv_banner.png not found at:",
          srcBanner
        );
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withTVLauncher;
