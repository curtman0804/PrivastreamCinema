package com.privastream.cinema

import android.app.ActivityManager
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.view.Display

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class PrivastreamDeviceCapabilitiesModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PrivastreamDeviceCapabilities"

    private val codecInfos: Array<MediaCodecInfo> by lazy {
        try {
            MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
        } catch (_: Throwable) {
            emptyArray()
        }
    }

    private fun decodersFor(mime: String): List<Pair<MediaCodecInfo, String>> {
        val result = mutableListOf<Pair<MediaCodecInfo, String>>()

        for (info in codecInfos) {
            try {
                if (info.isEncoder) continue

                val type = info.supportedTypes.firstOrNull {
                    it.equals(mime, ignoreCase = true)
                } ?: continue

                result.add(info to type)
            } catch (_: Throwable) {
            }
        }

        return result
    }

    private fun hasDecoder(mime: String): Boolean =
        decodersFor(mime).isNotEmpty()

    private fun videoSupport(mime: String): Map<String, Any> {
        var supports1080p30 = false
        var supports4k30 = false
        var supports4k60 = false
        var hevcMain10 = false

        val names = mutableListOf<String>()
        val decoders = decodersFor(mime)

        for ((info, supportedType) in decoders) {
            try {
                names.add(info.name)

                val caps = info.getCapabilitiesForType(supportedType)
                val video = caps.videoCapabilities

                if (video != null) {
                    try {
                        if (video.areSizeAndRateSupported(1920, 1080, 30.0)) {
                            supports1080p30 = true
                        }
                    } catch (_: Throwable) {}

                    try {
                        if (video.areSizeAndRateSupported(3840, 2160, 30.0)) {
                            supports4k30 = true
                        }
                    } catch (_: Throwable) {}

                    try {
                        if (video.areSizeAndRateSupported(3840, 2160, 60.0)) {
                            supports4k60 = true
                        }
                    } catch (_: Throwable) {}
                }

                if (mime.equals("video/hevc", ignoreCase = true)) {
                    for (pl in caps.profileLevels) {
                        // Android HEVC profiles:
                        // Main10 = 2
                        // Main10 HDR10 = 4096
                        // Main10 HDR10+ = 8192
                        if (
                            pl.profile == 2 ||
                            pl.profile == 4096 ||
                            pl.profile == 8192
                        ) {
                            hevcMain10 = true
                        }
                    }
                }
            } catch (_: Throwable) {
            }
        }

        return linkedMapOf(
            "decoderCount" to decoders.size,
            "decoderNames" to names,
            "supports1080p30" to supports1080p30,
            "supports4k30" to supports4k30,
            "supports4k60" to supports4k60,
            "main10" to hevcMain10
        )
    }

    override fun getConstants(): Map<String, Any> {
        val context = reactApplicationContext

        val activityManager =
            context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager

        val uiModeManager =
            context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager

        val displayManager =
            context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager

        val display = try {
            displayManager.getDisplay(Display.DEFAULT_DISPLAY)
        } catch (_: Throwable) {
            null
        }

        var maxDisplayWidth = 0
        var maxDisplayHeight = 0
        var maxRefreshRate = 0.0

        try {
            display?.supportedModes?.forEach { mode ->
                val pixels = mode.physicalWidth.toLong() * mode.physicalHeight.toLong()
                val currentPixels =
                    maxDisplayWidth.toLong() * maxDisplayHeight.toLong()

                if (pixels > currentPixels) {
                    maxDisplayWidth = mode.physicalWidth
                    maxDisplayHeight = mode.physicalHeight
                }

                if (mode.refreshRate.toDouble() > maxRefreshRate) {
                    maxRefreshRate = mode.refreshRate.toDouble()
                }
            }
        } catch (_: Throwable) {
        }

        var hdr10 = false
        var hlg = false
        var dolbyVision = false
        var hdr10Plus = false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                val hdrTypes =
                    display?.hdrCapabilities?.supportedHdrTypes ?: intArrayOf()

                for (type in hdrTypes) {
                    when (type) {
                        Display.HdrCapabilities.HDR_TYPE_HDR10 ->
                            hdr10 = true

                        Display.HdrCapabilities.HDR_TYPE_HLG ->
                            hlg = true

                        Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION ->
                            dolbyVision = true

                        4 ->
                            hdr10Plus = true
                    }
                }
            } catch (_: Throwable) {
            }
        }

        val video = linkedMapOf<String, Any>(
            "h264" to videoSupport("video/avc"),
            "hevc" to videoSupport("video/hevc"),
            "vp9" to videoSupport("video/x-vnd.on2.vp9"),
            "av1" to videoSupport("video/av01")
        )

        val audio = linkedMapOf<String, Any>(
            "aac" to hasDecoder("audio/mp4a-latm"),
            "ac3" to hasDecoder("audio/ac3"),
            "eac3" to hasDecoder("audio/eac3"),
            "eac3Joc" to hasDecoder("audio/eac3-joc"),
            "opus" to hasDecoder("audio/opus"),
            "dts" to hasDecoder("audio/vnd.dts"),
            "dtsHd" to hasDecoder("audio/vnd.dts.hd"),
            "trueHd" to hasDecoder("audio/true-hd")
        )

        val displayMap = linkedMapOf<String, Any>(
            "maxWidth" to maxDisplayWidth,
            "maxHeight" to maxDisplayHeight,
            "maxRefreshRate" to maxRefreshRate,
            "hdr10" to hdr10,
            "hdr10Plus" to hdr10Plus,
            "hlg" to hlg,
            "dolbyVision" to dolbyVision
        )

        return linkedMapOf(
            "manufacturer" to Build.MANUFACTURER,
            "model" to Build.MODEL,
            "device" to Build.DEVICE,
            "product" to Build.PRODUCT,
            "sdkInt" to Build.VERSION.SDK_INT,
            "isTelevision" to
                (uiModeManager.currentModeType ==
                    Configuration.UI_MODE_TYPE_TELEVISION),
            "memoryClassMb" to activityManager.memoryClass,
            "largeMemoryClassMb" to activityManager.largeMemoryClass,
            "lowRam" to activityManager.isLowRamDevice,
            "display" to displayMap,
            "video" to video,
            "audio" to audio
        )
    }
}
