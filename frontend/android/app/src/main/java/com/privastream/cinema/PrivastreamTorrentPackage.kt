package com.privastream.cinema

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * V752_NATIVE_P2P_PROBE
 */
class PrivastreamTorrentPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> =
        listOf(
            PrivastreamTorrentModule(
                reactContext
            )
        )

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> =
        emptyList()
}
