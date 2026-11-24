package com.privastream.cinema

import android.app.ActivityManager
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import android.view.Display

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class PrivastreamDeviceCapabilitiesModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PrivastreamDeviceCapabilities"

    // V788T16J_PRE_DISPLAY_LIVE_TV_PROBE
    //
    // Network work is always off the React Native module thread.
    private val liveTvProbeCoordinator =
        Executors.newSingleThreadExecutor()

    private val liveTvProbeWorkers =
        Executors.newFixedThreadPool(8)

    private data class LiveTvProbeInput(
        val key: String,
        val url: String,
        val headers: Map<String, String>
    )

    private data class LiveTvProbeOutcome(
        val playable: Boolean,
        val reason: String
    )

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


    // V788T16J_PRE_DISPLAY_LIVE_TV_PROBE
    private fun hlsBodyHasMedia(
        body: String
    ): Boolean {
        val lines =
            body
                .replace("\r\n", "\n")
                .replace("\r", "\n")
                .split("\n")
                .map { it.trim() }
                .filter { it.isNotEmpty() }

        if (
            lines.isEmpty() ||
            lines.first() != "#EXTM3U"
        ) {
            return false
        }

        for (line in lines.drop(1)) {
            if (!line.startsWith("#")) {
                return true
            }

            val upper =
                line.uppercase()

            if (
                upper.startsWith("#EXT-X-PART:") &&
                upper.contains("URI=\"")
            ) {
                return true
            }

            if (
                upper.startsWith(
                    "#EXT-X-I-FRAME-STREAM-INF:"
                ) &&
                upper.contains("URI=\"")
            ) {
                return true
            }
        }

        return false
    }

    private fun probeLiveTvUrl(
        candidate: LiveTvProbeInput,
        timeoutMs: Int,
        hostCache: ConcurrentHashMap<String, Boolean>
    ): LiveTvProbeOutcome {
        var connection: HttpURLConnection? = null

        try {
            val parsed =
                URL(candidate.url)

            val protocol =
                parsed.protocol
                    ?.trim()
                    ?.lowercase()
                    ?: ""

            if (
                protocol != "http" &&
                protocol != "https"
            ) {
                return LiveTvProbeOutcome(
                    false,
                    "unsupported_scheme"
                )
            }

            val host =
                parsed.host
                    ?.trim()
                    ?.lowercase()
                    ?: ""

            if (host.isEmpty()) {
                return LiveTvProbeOutcome(
                    false,
                    "missing_host"
                )
            }

            val hostReachable =
                hostCache[host]
                    ?: run {
                        val resolved =
                            try {
                                InetAddress.getByName(host)
                                true
                            } catch (_: Throwable) {
                                false
                            }

                        hostCache[host] =
                            resolved

                        resolved
                    }

            if (!hostReachable) {
                return LiveTvProbeOutcome(
                    false,
                    "dns_failure"
                )
            }

            val opened =
                parsed.openConnection()

            if (opened !is HttpURLConnection) {
                return LiveTvProbeOutcome(
                    false,
                    "not_http_connection"
                )
            }

            connection = opened

            connection.instanceFollowRedirects = true
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.requestMethod = "GET"
            connection.useCaches = false

            for (
                (name, value)
                in candidate.headers
            ) {
                if (
                    name.isNotBlank() &&
                    value.isNotBlank()
                ) {
                    try {
                        connection.setRequestProperty(
                            name,
                            value
                        )
                    } catch (_: Throwable) {
                    }
                }
            }

            if (
                candidate.headers.keys.none {
                    it.equals(
                        "User-Agent",
                        ignoreCase = true
                    )
                }
            ) {
                connection.setRequestProperty(
                    "User-Agent",
                    "PrivastreamCinema/1.7.2 AndroidTV"
                )
            }

            connection.setRequestProperty(
                "Accept",
                "*/*"
            )

            val code =
                connection.responseCode

            if (code !in 200..299) {
                return LiveTvProbeOutcome(
                    false,
                    "http_" + code
                )
            }

            if (code == 204) {
                return LiveTvProbeOutcome(
                    false,
                    "zero_body"
                )
            }

            val contentType =
                (connection.contentType ?: "")
                    .trim()
                    .lowercase()

            val buffer =
                ByteArray(32768)

            var total = 0

            connection.inputStream.use {
                input ->

                while (total < buffer.size) {
                    val read =
                        input.read(
                            buffer,
                            total,
                            buffer.size - total
                        )

                    if (read <= 0) {
                        break
                    }

                    total += read
                }
            }

            if (total <= 0) {
                return LiveTvProbeOutcome(
                    false,
                    "zero_body"
                )
            }

            val preview =
                String(
                    buffer,
                    0,
                    total,
                    Charsets.UTF_8
                ).trimStart()

            val lowerPath =
                parsed.path
                    ?.lowercase()
                    ?: ""

            val looksLikeHls =
                lowerPath.endsWith(".m3u8") ||
                contentType.contains("mpegurl") ||
                preview.startsWith("#EXTM3U")

            if (looksLikeHls) {
                return if (
                    hlsBodyHasMedia(preview)
                ) {
                    LiveTvProbeOutcome(
                        true,
                        "hls_media"
                    )
                } else {
                    LiveTvProbeOutcome(
                        false,
                        "hls_empty"
                    )
                }
            }

            if (
                contentType.contains("text/html") ||
                contentType.contains("application/json") ||
                contentType.contains("text/json") ||
                contentType.contains("application/xml") ||
                contentType.contains("text/xml") ||
                preview.startsWith("<!DOCTYPE", true) ||
                preview.startsWith("<html", true) ||
                preview.startsWith("{") ||
                preview.startsWith("[")
            ) {
                return LiveTvProbeOutcome(
                    false,
                    "non_media_body"
                )
            }

            return LiveTvProbeOutcome(
                true,
                "media_bytes"
            )

        } catch (error: Throwable) {
            return LiveTvProbeOutcome(
                false,
                error.javaClass.simpleName
                    .ifBlank {
                        "probe_error"
                    }
            )
        } finally {
            try {
                connection?.disconnect()
            } catch (_: Throwable) {
            }
        }
    }

    @ReactMethod
    fun probeLiveTvCandidates(
        candidates: ReadableArray,
        requestedTimeoutMs: Int,
        promise: Promise
    ) {
        try {
            val grouped =
                linkedMapOf<
                    String,
                    MutableList<LiveTvProbeInput>
                >()

            // BU23IE: a fifth distinct URL cannot be ignored for terminal proof.
            val truncatedKeys = hashSetOf<String>()
            val maxRows =
                minOf(
                    candidates.size(),
                    512
                )

            for (index in 0 until maxRows) {
                val row =
                    try {
                        candidates.getMap(index)
                    } catch (_: Throwable) {
                        null
                    }
                    ?: continue

                val key =
                    try {
                        row.getString("key")
                            ?.trim()
                            .orEmpty()
                    } catch (_: Throwable) {
                        ""
                    }

                val url =
                    try {
                        row.getString("url")
                            ?.trim()
                            .orEmpty()
                    } catch (_: Throwable) {
                        ""
                    }

                if (
                    key.isEmpty() ||
                    url.isEmpty()
                ) {
                    continue
                }

                val headers =
                    linkedMapOf<String, String>()

                val headerMap =
                    try {
                        if (
                            row.hasKey("headers") &&
                            !row.isNull("headers")
                        ) {
                            row.getMap("headers")
                        } else {
                            null
                        }
                    } catch (_: Throwable) {
                        null
                    }

                if (headerMap != null) {
                    try {
                        val iterator =
                            headerMap.keySetIterator()

                        while (
                            iterator.hasNextKey()
                        ) {
                            val headerName =
                                iterator.nextKey()

                            val headerValue =
                                try {
                                    headerMap.getString(
                                        headerName
                                    )
                                } catch (_: Throwable) {
                                    null
                                }

                            if (
                                !headerName.isNullOrBlank() &&
                                !headerValue.isNullOrBlank()
                            ) {
                                headers[
                                    headerName
                                ] = headerValue
                            }
                        }
                    } catch (_: Throwable) {
                    }
                }

                val bucket =
                    grouped.getOrPut(key) {
                        mutableListOf()
                    }

                if (
                    bucket.size < 4 &&
                    bucket.none {
                        it.url == url
                    }
                ) {
                    bucket.add(
                        LiveTvProbeInput(
                            key,
                            url,
                            headers
                        )
                    )
                } else if (
                    bucket.size >= 4 &&
                    bucket.none { it.url == url }
                ) {
                    truncatedKeys.add(key)
                }

                if (grouped.size >= 256) {
                    break
                }
            }

            val timeoutMs =
                requestedTimeoutMs
                    .coerceIn(
                        500,
                        4000
                    )

            liveTvProbeCoordinator.execute {
                try {
                    val hostCache =
                        ConcurrentHashMap<
                            String,
                            Boolean
                        >()

                    val tasks =
                        grouped.map {
                            (key, rows) ->

                            Callable {
                                var outcome =
                                    LiveTvProbeOutcome(
                                        false,
                                        "no_candidate"
                                    )
                                // BU23IE: every alternative URL must have a definitive
                                // missing-resource response before this KEY is terminal.
                                var allCandidatesGone = rows.isNotEmpty()
                                var testedCandidates = 0

                                for (
                                    candidate
                                    in rows.take(4)
                                ) {
                                    val current =
                                        probeLiveTvUrl(
                                            candidate,
                                            timeoutMs,
                                            hostCache
                                        )

                                    outcome =
                                        current
                                    testedCandidates += 1
                                    // A timeout, 429, 401/403, invalid body, or DNS
                                    // failure is NOT proof that an add-on is down.
                                    if (current.reason != "http_404" &&
                                        current.reason != "http_410") {
                                        allCandidatesGone = false
                                    }

                                    if (
                                        current.playable
                                    ) {
                                        break
                                    }
                                }

                                Triple(
                                    key,
                                    outcome,
                                    !outcome.playable && allCandidatesGone &&
                                        testedCandidates == rows.take(4).size &&
                                        !truncatedKeys.contains(key)
                                )
                            }
                        }

                    val futures =
                        liveTvProbeWorkers.invokeAll(
                            tasks
                        )

                    val playableKeys =
                        Arguments.createArray()

                    val failedKeys =
                        Arguments.createArray()
                    // BU23IE: additive fields; legacy callers remain compatible.
                    val terminalFailedKeys = Arguments.createArray()
                    val inconclusiveKeys = Arguments.createArray()

                    val resultMap =
                        Arguments.createMap()

                    var playableCount = 0
                    var failedCount = 0

                    for (future in futures) {
                        val pair =
                            future.get()

                        val key =
                            pair.first

                        val outcome =
                            pair.second

                        val detail =
                            Arguments.createMap()

                        detail.putBoolean(
                            "playable",
                            outcome.playable
                        )

                        detail.putString(
                            "reason",
                            outcome.reason
                        )
                        detail.putBoolean(
                            "terminalMissing",
                            pair.third
                        )

                        resultMap.putMap(
                            key,
                            detail
                        )

                        if (
                            outcome.playable
                        ) {
                            playableKeys.pushString(
                                key
                            )
                            playableCount += 1
                        } else {
                            failedKeys.pushString(
                                key
                            )
                            if (pair.third) {
                                terminalFailedKeys.pushString(key)
                            } else {
                                inconclusiveKeys.pushString(key)
                            }
                            failedCount += 1
                        }
                    }

                    val result =
                        Arguments.createMap()

                    result.putArray(
                        "playableKeys",
                        playableKeys
                    )

                    result.putArray(
                        "failedKeys",
                        failedKeys
                    )

                    result.putMap(
                        "results",
                        resultMap
                    )
                    result.putArray(
                        "terminalFailedKeys",
                        terminalFailedKeys
                    )
                    result.putArray(
                        "inconclusiveKeys",
                        inconclusiveKeys
                    )
                    // Truncated native batches cannot establish a complete
                    // negative inventory for automatic guide hiding.
                    result.putBoolean(
                        "complete",
                        candidates.size() < 512 && grouped.size < 256 &&
                            truncatedKeys.isEmpty()
                    )

                    result.putInt(
                        "checked",
                        grouped.size
                    )

                    result.putInt(
                        "playable",
                        playableCount
                    )

                    result.putInt(
                        "failed",
                        failedCount
                    )

                    Log.i(
                        "PrivastreamLiveTVProbe",
                        "[V788T16J PREFLIGHT] checked=" +
                            grouped.size +
                            " playable=" +
                            playableCount +
                            " failed=" +
                            failedCount
                    )

                    promise.resolve(result)

                } catch (error: Throwable) {
                    Log.e(
                        "PrivastreamLiveTVProbe",
                        "[V788T16J PREFLIGHT] failure",
                        error
                    )

                    promise.reject(
                        "V788T16J_PREFLIGHT_FAILED",
                        error.message
                            ?: "Live TV preflight failed.",
                        error
                    )
                }
            }

        } catch (error: Throwable) {
            promise.reject(
                "V788T16J_PREFLIGHT_INPUT_FAILED",
                error.message
                    ?: "Unable to prepare Live TV preflight.",
                error
            )
        }
    }


    // W121ZOD118A_NATIVE_OD_RANGE_PROBE
    //
    // OD delivery/readiness measurements must originate from the
    // playback device itself. React Native XMLHttpRequest is not
    // authoritative for byte-range behavior on the Premiumize CDN.
    private val odRangeProbeExecutor =
        Executors.newSingleThreadExecutor()

    @ReactMethod
    fun probeOdRange(
        rawUrl: String,
        requestedStartByte: Double,
        requestedSampleBytes: Int,
        requestedTimeoutMs: Int,
        promise: Promise
    ) {
        val url =
            rawUrl.trim()

        if (
            url.isEmpty() ||
            !requestedStartByte.isFinite() ||
            requestedStartByte < 0.0
        ) {
            promise.reject(
                "OD_RANGE_INVALID_INPUT",
                "Invalid OD Range probe input."
            )
            return
        }

        val startByte =
            requestedStartByte.toLong()

        val sampleBytes =
            requestedSampleBytes.coerceIn(
                64 * 1024,
                4 * 1024 * 1024
            )

        val timeoutMs =
            requestedTimeoutMs.coerceIn(
                1000,
                8000
            )

        odRangeProbeExecutor.execute {
            var connection: HttpURLConnection? = null

            try {
                val parsed =
                    URL(url)

                val protocol =
                    parsed.protocol
                        ?.trim()
                        ?.lowercase()
                        ?: ""

                if (
                    protocol != "http" &&
                    protocol != "https"
                ) {
                    promise.reject(
                        "OD_RANGE_INVALID_SCHEME",
                        "Only HTTP/HTTPS OD media URLs are supported."
                    )
                    return@execute
                }

                val opened =
                    parsed.openConnection()

                if (opened !is HttpURLConnection) {
                    promise.reject(
                        "OD_RANGE_CONNECTION_TYPE",
                        "OD media URL did not create an HTTP connection."
                    )
                    return@execute
                }

                connection = opened

                val endByte =
                    startByte +
                    sampleBytes.toLong() -
                    1L

                connection.instanceFollowRedirects = true
                connection.connectTimeout = timeoutMs
                connection.readTimeout = timeoutMs
                connection.requestMethod = "GET"
                connection.useCaches = false

                connection.setRequestProperty(
                    "Range",
                    "bytes=$startByte-$endByte"
                )

                connection.setRequestProperty(
                    "Accept",
                    "*/*"
                )

                connection.setRequestProperty(
                    "Accept-Encoding",
                    "identity"
                )

                connection.setRequestProperty(
                    "User-Agent",
                    "PrivastreamCinema/1.7.2 AndroidTV"
                )

                val startedAtNs =
                    System.nanoTime()

                val code =
                    connection.responseCode

                val contentRange =
                    (
                        connection.getHeaderField(
                            "Content-Range"
                        )
                            ?: ""
                    ).trim()

                if (
                    code != HttpURLConnection.HTTP_PARTIAL ||
                    !contentRange.startsWith(
                        "bytes $startByte-",
                        ignoreCase = true
                    )
                ) {
                    promise.reject(
                        "OD_RANGE_RANGE_UNSUPPORTED",
                        "HTTP $code Content-Range=$contentRange"
                    )
                    return@execute
                }

                var totalBytes = 0

                val buffer =
                    ByteArray(
                        minOf(
                            sampleBytes,
                            64 * 1024
                        )
                    )

                connection.inputStream.use { input ->
                    while (totalBytes < sampleBytes) {
                        val remaining =
                            sampleBytes - totalBytes

                        val read =
                            input.read(
                                buffer,
                                0,
                                minOf(
                                    buffer.size,
                                    remaining
                                )
                            )

                        if (read < 0) {
                            break
                        }

                        if (read == 0) {
                            continue
                        }

                        totalBytes += read
                    }
                }

                val elapsedMs =
                    maxOf(
                        1.0,
                        (
                            System.nanoTime() -
                            startedAtNs
                        ).toDouble() /
                            1_000_000.0
                    )

                if (totalBytes < sampleBytes) {
                    promise.reject(
                        "OD_RANGE_SHORT_READ",
                        "Expected $sampleBytes bytes, received $totalBytes."
                    )
                    return@execute
                }

                val mbps =
                    (
                        totalBytes.toDouble() *
                        8.0
                    ) /
                        (
                            elapsedMs /
                            1000.0
                        ) /
                        1_000_000.0

                val result =
                    Arguments.createMap()

                result.putDouble(
                    "bytes",
                    totalBytes.toDouble()
                )

                result.putDouble(
                    "elapsedMs",
                    elapsedMs
                )

                result.putDouble(
                    "mbps",
                    mbps
                )

                result.putInt(
                    "status",
                    code
                )

                result.putString(
                    "contentRange",
                    contentRange
                )

                Log.i(
                    "PrivastreamODRange",
                    "start=$startByte bytes=$totalBytes elapsedMs=${"%.1f".format(elapsedMs)} mbps=${"%.2f".format(mbps)}"
                )

                promise.resolve(result)
            } catch (
                error: java.net.SocketTimeoutException
            ) {
                promise.reject(
                    "OD_RANGE_TIMEOUT",
                    error.message
                        ?: "Native OD Range probe timed out.",
                    error
                )
            } catch (
                error: java.net.UnknownHostException
            ) {
                promise.reject(
                    "OD_RANGE_DNS",
                    error.message
                        ?: "Native OD Range probe DNS failure.",
                    error
                )
            } catch (error: Throwable) {
                promise.reject(
                    "OD_RANGE_NETWORK_ERROR",
                    (
                        error.javaClass.simpleName +
                        ":" +
                        (
                            error.message
                                ?: ""
                        )
                    ),
                    error
                )
            } finally {
                try {
                    connection?.disconnect()
                } catch (_: Throwable) {
                }
            }
        }
    }

    // W121ZOD117C_NATIVE_PROFILE_STORE
    //
    // Device capability ownership belongs here, below JS.
    // The first native module initialization on this device
    // performs the expensive codec/display/audio detection.
    // Later processes return the committed profile directly.
    private val deviceProfilePrefs by lazy {
        reactApplicationContext.getSharedPreferences(
            "privastream_device_playback_profile_native_v1",
            Context.MODE_PRIVATE
        )
    }

    private fun deviceProfileFingerprint(): String =
        listOf(
            Build.MANUFACTURER,
            Build.MODEL,
            Build.DEVICE,
            Build.PRODUCT,
            Build.VERSION.SDK_INT.toString(),
            Build.FINGERPRINT
        ).joinToString("|")

    private fun jsonArrayToList(
        array: JSONArray
    ): List<Any> {
        val result = mutableListOf<Any>()

        for (index in 0 until array.length()) {
            val value = jsonToNativeValue(
                array.opt(index)
            )

            if (value != null) {
                result.add(value)
            }
        }

        return result
    }

    private fun jsonObjectToMap(
        obj: JSONObject
    ): Map<String, Any> {
        val result = linkedMapOf<String, Any>()
        val keys = obj.keys()

        while (keys.hasNext()) {
            val key = keys.next()
            val value = jsonToNativeValue(
                obj.opt(key)
            )

            if (value != null) {
                result[key] = value
            }
        }

        return result
    }

    private fun jsonToNativeValue(
        value: Any?
    ): Any? =
        when (value) {
            null -> null
            JSONObject.NULL -> null
            is JSONObject -> jsonObjectToMap(value)
            is JSONArray -> jsonArrayToList(value)
            else -> value
        }

    private fun loadStoredDeviceProfile(): Map<String, Any>? {
        return try {
            val schema =
                deviceProfilePrefs.getInt(
                    "schema",
                    0
                )

            if (schema != 1) {
                return null
            }

            val expectedFingerprint =
                deviceProfileFingerprint()

            val storedFingerprint =
                deviceProfilePrefs.getString(
                    "fingerprint",
                    null
                )

            if (
                storedFingerprint.isNullOrBlank() ||
                storedFingerprint != expectedFingerprint
            ) {
                return null
            }

            val raw =
                deviceProfilePrefs.getString(
                    "profile_json",
                    null
                )

            if (raw.isNullOrBlank()) {
                return null
            }

            val profile =
                jsonObjectToMap(
                    JSONObject(raw)
                )

            if (
                profile["model"]?.toString() != Build.MODEL ||
                profile["device"]?.toString() != Build.DEVICE ||
                profile["product"]?.toString() != Build.PRODUCT
            ) {
                null
            } else {
                profile
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun storeDeviceProfile(
        profile: Map<String, Any>
    ): Boolean {
        return try {
            val raw =
                JSONObject(profile).toString()

            // commit(), not apply(): first-run provisioning must
            // be durable before the process can be stopped.
            deviceProfilePrefs
                .edit()
                .putInt("schema", 1)
                .putString(
                    "fingerprint",
                    deviceProfileFingerprint()
                )
                .putString(
                    "profile_json",
                    raw
                )
                .commit()
        } catch (_: Throwable) {
            false
        }
    }

    override fun getConstants(): Map<String, Any> {
        val storedProfile =
            loadStoredDeviceProfile()

        if (storedProfile != null) {
            Log.i(
                "PrivastreamDeviceProfile",
                "[W121ZOD117C DEVICE PROFILE] source=stored model=" +
                    Build.MODEL +
                    " device=" +
                    Build.DEVICE
            )

            return storedProfile
        }

        Log.i(
            "PrivastreamDeviceProfile",
            "[W121ZOD117C DEVICE PROFILE] source=detect-start model=" +
                Build.MODEL +
                " device=" +
                Build.DEVICE
        )

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

        val detectedProfile = linkedMapOf<String, Any>(
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

        val persisted =
            storeDeviceProfile(
                detectedProfile
            )

        Log.i(
            "PrivastreamDeviceProfile",
            "[W121ZOD117C DEVICE PROFILE] source=detected-stored persisted=" +
                persisted.toString() +
                " model=" +
                Build.MODEL +
                " device=" +
                Build.DEVICE
        )

        return detectedProfile
    }
}
