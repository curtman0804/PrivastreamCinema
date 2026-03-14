const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Makes the app appear in the TV app row on Google TV, Fire TV, etc.
 * Sets the app label, banner image, and LEANBACK_LAUNCHER category.
 * Also copies the tv_banner.png into the Android drawable directory.
 */
const withTVLauncher = (config) => {
  // Step 1: Modify the manifest
  config = withAndroidManifest(config, (config) => {
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

    // Explicitly set application label and banner for TV launchers
    const application = manifest.application?.[0];
    if (application) {
      application.$["android:label"] = "Privastream Cinema";
      application.$["android:banner"] = "@drawable/tv_banner";
    }

    // Add LEANBACK_LAUNCHER to main activity and set its label + banner
    const activities = application?.activity || [];
    for (const activity of activities) {
      if (activity.$?.["android:name"] === ".MainActivity") {
        activity.$["android:label"] = "Privastream Cinema";
        activity.$["android:banner"] = "@drawable/tv_banner";
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

  // Step 2: Copy tv_banner.png into drawable directory
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const bannerSrc = path.join(projectRoot, "assets", "images", "tv_banner.png");
      const drawableDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "res",
        "drawable"
      );

      // Ensure drawable directory exists
      if (!fs.existsSync(drawableDir)) {
        fs.mkdirSync(drawableDir, { recursive: true });
      }

      // Copy banner if source exists
      if (fs.existsSync(bannerSrc)) {
        const dest = path.join(drawableDir, "tv_banner.png");
        fs.copyFileSync(bannerSrc, dest);
        console.log(`  ✔ Copied tv_banner.png to drawable`);
      } else {
        console.warn(`  ⚠ tv_banner.png not found at ${bannerSrc}`);
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withTVLauncher;
