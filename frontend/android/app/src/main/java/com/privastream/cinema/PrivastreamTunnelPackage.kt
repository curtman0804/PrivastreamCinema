package com.privastream.cinema

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * V739A_PRIVASTREAM_TUNNEL
 */
class PrivastreamTunnelPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> =
        listOf(
            PrivastreamTunnelModule(
                reactContext
            )
        )

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> =
        emptyList()
}
