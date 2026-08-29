/* V575_GLIDE — tune Glide for the Fire TV / Android TV build.

   Root cause it fixes (confirmed in device logcat): while holding D-pad DOWN,
   dozens of posters requested decode at once, the Glide decode QUEUE backed up
   to ~290ms, the device hit lowmemorykiller, GC stalled, and rows "did not load
   quick enough".

   Approach: DO NOT add a second AppGlideModule (that caused a duplicate
   `GeneratedAppGlideModuleImpl` at :app:mergeDexRelease). Glide allows exactly
   ONE @GlideModule per app, and expo-image already ships one
   (`ExpoImageAppGlideModule`). So this plugin edits THAT single module in place
   — adding RGB_565 decode, override(255,388), priority(LOW), a capped decode
   executor, and trimmed caches — leaving expo-image's Glide integrations
   (okhttp / avif / animation) fully intact.

   It runs during `expo prebuild` (idempotent), so the fix survives `rebuild.bat`
   (prebuild --clean) and is re-applied on every native rebuild. OTA cannot ship
   native code. */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "V575_GLIDE";

const TUNED_MODULE = `package expo.modules.image

import android.content.Context
import android.util.Log
import com.bumptech.glide.GlideBuilder
import com.bumptech.glide.Priority
import com.bumptech.glide.annotation.GlideModule
import com.bumptech.glide.load.DecodeFormat
import com.bumptech.glide.load.engine.bitmap_recycle.LruBitmapPool
import com.bumptech.glide.load.engine.cache.LruResourceCache
import com.bumptech.glide.load.engine.cache.MemorySizeCalculator
import com.bumptech.glide.load.engine.executor.GlideExecutor
import com.bumptech.glide.module.AppGlideModule
import com.bumptech.glide.request.RequestOptions

/**
 * ${MARKER} - expo-image's single AppGlideModule, tuned for the low-RAM Fire TV
 * / Android TV build. Edited in place by plugins/withGlideThrottle.js so there
 * is exactly ONE @GlideModule in the app (no duplicate GeneratedAppGlideModuleImpl).
 * Requires a full native rebuild - OTA cannot ship native code.
 */
@GlideModule
class ExpoImageAppGlideModule : AppGlideModule() {
  override fun applyOptions(context: Context, builder: GlideBuilder) {
    super.applyOptions(context, builder)

    builder.setLogLevel(
      if (BuildConfig.ALLOW_GLIDE_LOGS) {
        Log.VERBOSE
      } else {
        Log.ERROR
      }
    )

    // ${MARKER} 1) Default request options for every decode:
    //    - RGB_565 (2 bytes/px) instead of ARGB_8888 (4 bytes/px). Posters do
    //      not need alpha; biggest single lever against memory pressure / GC.
    //    - override(255, 388): decode straight to poster size, never full-res,
    //      so a fast DOWN hold cannot decode oversized art.
    //    - priority(LOW): posters never jump the decode queue ahead of focus.
    builder.setDefaultRequestOptions(
      RequestOptions()
        .format(DecodeFormat.PREFER_RGB_565)
        .override(255, 388)
        .priority(Priority.LOW)
    )

    // ${MARKER} 2) Cap concurrent SOURCE (decode) threads so a fast DOWN hold
    //    cannot flood the decode pipeline; fewer steadier threads = smoother
    //    throughput on the weak Fire TV CPU.
    builder.setSourceExecutor(
      GlideExecutor.newSourceBuilder()
        .setThreadCount(2)
        .setName("privastream-glide-source")
        .build()
    )

    // ${MARKER} 3) Trim in-memory caches for the low-RAM Fire TV so the bitmap
    //    cache itself does not push the app into lowmemorykiller territory.
    val calc = MemorySizeCalculator.Builder(context)
      .setMemoryCacheScreens(1.5f)
      .setBitmapPoolScreens(2.0f)
      .build()
    builder.setMemoryCache(LruResourceCache(calc.memoryCacheSize.toLong()))
    builder.setBitmapPool(LruBitmapPool(calc.bitmapPoolSize.toLong()))
  }
}
`;

function resolveExpoImageModuleFile(projectRoot) {
  // Robustly locate expo-image (handles hoisted node_modules).
  let pkgJson;
  try {
    pkgJson = require.resolve("expo-image/package.json", {
      paths: [projectRoot],
    });
  } catch (e) {
    // Fallback to the conventional local path.
    pkgJson = path.join(projectRoot, "node_modules", "expo-image", "package.json");
  }
  const expoImageDir = path.dirname(pkgJson);
  return path.join(
    expoImageDir,
    "android",
    "src",
    "main",
    "java",
    "expo",
    "modules",
    "image",
    "ExpoImageAppGlideModule.kt"
  );
}

const withGlideThrottle = (config) =>
  withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const file = resolveExpoImageModuleFile(projectRoot);

      if (!fs.existsSync(file)) {
        console.warn(
          "  \u26A0 withGlideThrottle: could not find ExpoImageAppGlideModule.kt at " +
            file +
            " — skipping (image throttle NOT applied)."
        );
        return config;
      }

      const current = fs.readFileSync(file, "utf8");
      if (current.includes(MARKER)) {
        console.log("  \u2714 withGlideThrottle: expo-image Glide module already tuned (" + MARKER + ")");
        return config;
      }
      if (!current.includes("class ExpoImageAppGlideModule")) {
        console.warn(
          "  \u26A0 withGlideThrottle: unexpected ExpoImageAppGlideModule.kt contents — skipping to be safe."
        );
        return config;
      }

      fs.writeFileSync(file, TUNED_MODULE, "utf8");
      console.log("  \u2714 withGlideThrottle: tuned expo-image Glide module (" + MARKER + ")");
      return config;
    },
  ]);

module.exports = withGlideThrottle;
