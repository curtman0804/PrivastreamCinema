/* V540_PSTV_SCROLL — Fire TV / Android TV: a ReactScrollView subclass whose
   computeScrollDeltaToGetChildRectOnScreen() returns 0, so Android NEVER
   auto-scrolls to bring a newly-focused child "just into view".

   Root cause it fixes (proven by device logcat: one D-pad press = exactly one
   key event + one focus change): on a single press Android's ReactScrollView
   scrolled the focused card to "just visible" (small hop) and THEN the JS
   title-to-top anchor scrolled again (big hop) = the two-step "double move".
   RN 0.81.5 does this unconditionally (requestChildFocus -> scrollToChild),
   and scrollEnabled=false does NOT stop it — only a native override does.

   Scoped: registered as a NEW component "PSTVScrollView" and used ONLY by the
   Discover vertical list, so every other screen's ScrollView keeps normal
   focus-scroll behavior. Programmatic scrollTo is unaffected (that path does
   not use computeScrollDeltaToGetChildRectOnScreen).

   Injected during `expo prebuild`, so it survives rebuild.bat (prebuild
   --clean). OTA cannot ship native code. */
const { withDangerousMod, withMainApplication } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PKG = "com.privastream.cinema";
const PKG_PATH = PKG.split(".");

const FILES = {
  "PSTVScrollView.kt": `package ${PKG}

import android.content.Context
import android.graphics.Rect
import android.util.Log
import com.facebook.react.views.scroll.ReactScrollView

/**
 * V540_PSTV_SCROLL - ReactScrollView that never auto-scrolls to reveal a newly
 * focused child. Returning 0 removes Android's competing "just-visible" scroll
 * on Fire TV so Discover's JS title-to-top anchor is the ONLY scroll = one
 * smooth move per D-pad press. Programmatic scrollTo(x, y) is unaffected.
 */
class PSTVScrollView(context: Context) : ReactScrollView(context) {
  init {
    Log.d("PSTV", "PSTVScrollView created - native focus auto-scroll suppressed (V540)")
  }

  override fun computeScrollDeltaToGetChildRectOnScreen(rect: Rect?): Int = 0
}
`,
  "PSTVScrollViewManager.kt": `package ${PKG}

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewManager

/**
 * V540_PSTV_SCROLL - reuses every prop/command/event of the core vertical
 * ScrollView manager, but hands back a PSTVScrollView instance. Exposed to JS
 * under the name "PSTVScrollView".
 */
class PSTVScrollViewManager : ReactScrollViewManager() {
  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ReactScrollView =
      PSTVScrollView(context)

  companion object {
    const val REACT_CLASS: String = "PSTVScrollView"
  }
}
`,
  "PSTVScrollViewPackage.kt": `package ${PKG}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class PSTVScrollViewPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      emptyList()

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      listOf(PSTVScrollViewManager())
}
`,
};

const withNativeFiles = (config) =>
  withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const dir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "java",
        ...PKG_PATH
      );
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, contents] of Object.entries(FILES)) {
        fs.writeFileSync(path.join(dir, name), contents, "utf8");
      }
      console.log("  \u2714 withPSTVScrollView: wrote PSTVScrollView native files (V540)");
      return config;
    },
  ]);

const withPackageRegistration = (config) =>
  withMainApplication(config, (config) => {
    let src = config.modResults.contents;
    if (src.includes("PSTVScrollViewPackage()")) return config; // idempotent

    const addLine = "add(" + PKG + ".PSTVScrollViewPackage())";
    const applyAnchor = "PackageList(this).packages.apply {";
    const valAnchor = "val packages = PackageList(this).packages";

    if (src.includes(applyAnchor)) {
      // Expo SDK 54 form: PackageList(this).packages.apply { ... }
      src = src.replace(
        applyAnchor,
        applyAnchor + "\n              " + addLine
      );
    } else if (src.includes(valAnchor)) {
      // Older form: val packages = PackageList(this).packages; ...; return packages
      src = src.replace(valAnchor, valAnchor + "\n      packages." + addLine);
    } else {
      console.warn(
        "  \u26A0 withPSTVScrollView: could not find a PackageList anchor in MainApplication — PSTVScrollView NOT registered."
      );
    }
    config.modResults.contents = src;
    return config;
  });

const withPSTVScrollView = (config) => {
  config = withNativeFiles(config);
  config = withPackageRegistration(config);
  return config;
};

module.exports = withPSTVScrollView;
