package com.privastream.cinema

import android.os.Build
import android.util.Log

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

import com.frostwire.jlibtorrent.LibTorrent
import com.frostwire.jlibtorrent.SessionManager
import com.frostwire.jlibtorrent.Priority
import com.frostwire.jlibtorrent.Sha1Hash
import com.frostwire.jlibtorrent.TorrentHandle
import com.frostwire.jlibtorrent.TorrentInfo
import com.frostwire.jlibtorrent.swig.torrent_flags_t
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.File
import java.io.IOException
import java.io.InputStreamReader
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

/**
 * V752_NATIVE_P2P_PROBE
 *
 * JNI-load probe only.
 *
 * This module DOES NOT:
 * - start a SessionManager
 * - start DHT
 * - join a torrent swarm
 * - open a listening torrent port
 * - download or upload torrent data
 */
class PrivastreamTorrentModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val MODULE_NAME =
            "PrivastreamTorrent"

        private const val LOG_TAG =
            "V752P2P"
    }

    // V752_SESSION_CONSTRUCTED
    // Wrapper object only. start() is deliberately NOT called.
    private val sessionManager =
        SessionManager(false)

    override fun getName(): String =
        MODULE_NAME

    init {
        try {
            val jlibtorrentVersion =
                LibTorrent.jlibtorrentVersion()

            val libtorrentVersion =
                LibTorrent.version()

            Log.i(
                LOG_TAG,
                "[V752_NATIVE_PROBE] loaded=true " +
                    "jlibtorrent=$jlibtorrentVersion " +
                    "libtorrent=$libtorrentVersion " +
                    "abi=${Build.SUPPORTED_ABIS.joinToString(",")} " +
                    "sessionConstructed=true " +
                    "running=${sessionManager.isRunning()} " +
                    "dht=${sessionManager.isDhtRunning()} " +
                    "nativeSession=${sessionManager.swig() != null}"
            )
        } catch (error: Throwable) {
            Log.e(
                LOG_TAG,
                "[V752_NATIVE_PROBE] loaded=false " +
                    "type=${error.javaClass.name} " +
                    "message=${error.message ?: ""}",
                error
            )
        }
    }

    // V752_NATIVE_ENGINE_CORE
    //
    // Permanent on-demand libtorrent lifecycle.
    // No session is started merely by launching Privastream.
    private val engineExecutor =
        Executors.newSingleThreadExecutor()

    // ========================================================
    // V752_TORRENT_PREP
    //
    // On-demand only. This code runs only when JS explicitly
    // requests native P2P playback.
    // ========================================================

    @Volatile
    private var activeInfoHash = ""

    @Volatile
    private var activeTorrent: TorrentHandle? = null

    @Volatile
    private var activeTorrentInfo: TorrentInfo? = null

    @Volatile
    private var activeFileIndex = -1

    @Volatile
    private var activeFileSize = 0L

    @Volatile
    private var activeFilePath = ""

    @Volatile
    private var activeFileOffset = 0L

    @Volatile
    private var activePieceLength = 0

    // ========================================================
    // V753_LOCAL_RANGE_SERVER
    //
    // Loopback-only transport for the exact V752-selected file.
    // Nothing is exposed on LAN/Wi-Fi; the socket binds only to
    // 127.0.0.1 and requires a per-start random path token.
    // ========================================================

    @Volatile
    private var localPlaybackServer: ServerSocket? = null

    @Volatile
    private var localPlaybackPort = -1

    @Volatile
    private var localPlaybackToken = ""

    private val localPlaybackAcceptExecutor =
        Executors.newSingleThreadExecutor()

    private val localPlaybackClientExecutor =
        Executors.newCachedThreadPool()

    private fun torrentCacheDir(
        infoHash: String
    ): File {
        val root =
            File(
                reactApplicationContext.cacheDir,
                "v752-torrent"
            )

        if (!root.exists() && !root.mkdirs()) {
            throw IllegalStateException(
                "Unable to create V752 torrent cache root"
            )
        }

        val dir =
            File(root, infoHash)

        if (!dir.exists() && !dir.mkdirs()) {
            throw IllegalStateException(
                "Unable to create torrent cache directory"
            )
        }

        return dir
    }

    private fun normalizedTorrentPath(
        value: String
    ): String =
        value.trim().replace('\\', '/')

    private fun fileMatchesIdentity(
        torrentInfo: TorrentInfo,
        index: Int,
        requestedFilename: String
    ): Boolean {
        val files = torrentInfo.files()

        val requested =
            normalizedTorrentPath(requestedFilename)

        if (requested.isEmpty()) {
            return true
        }

        val requestedBase =
            requested.substringAfterLast('/')

        val actualPath =
            normalizedTorrentPath(
                files.filePath(index)
            )

        val actualName =
            files.fileName(index).trim()

        return actualPath.equals(
                requested,
                ignoreCase = true
            ) ||
            actualName.equals(
                requestedBase,
                ignoreCase = true
            )
    }

    private fun selectTorrentFile(
        torrentInfo: TorrentInfo,
        requestedIndex: Int,
        requestedFilename: String
    ): Int {
        val files = torrentInfo.files()
        val count = files.numFiles()

        if (count <= 0) {
            throw IllegalStateException(
                "Torrent contains no files"
            )
        }

        if (requestedIndex >= 0) {
            if (requestedIndex >= count) {
                throw IllegalArgumentException(
                    "Requested fileIdx is outside torrent file list"
                )
            }

            if (files.padFileAt(requestedIndex)) {
                throw IllegalArgumentException(
                    "Requested fileIdx is a pad file"
                )
            }

            if (
                requestedFilename.isNotBlank() &&
                !fileMatchesIdentity(
                    torrentInfo,
                    requestedIndex,
                    requestedFilename
                )
            ) {
                throw IllegalArgumentException(
                    "V752_FILE_IDENTITY_MISMATCH"
                )
            }

            return requestedIndex
        }

        if (requestedFilename.isNotBlank()) {
            val matches =
                ArrayList<Int>()

            for (i in 0 until count) {
                if (files.padFileAt(i)) {
                    continue
                }

                if (
                    fileMatchesIdentity(
                        torrentInfo,
                        i,
                        requestedFilename
                    )
                ) {
                    matches.add(i)
                }
            }

            if (matches.size == 1) {
                return matches[0]
            }

            if (matches.size > 1) {
                throw IllegalArgumentException(
                    "V752_FILE_IDENTITY_AMBIGUOUS"
                )
            }

            throw IllegalArgumentException(
                "V752_FILE_IDENTITY_NOT_FOUND"
            )
        }

        // A single-file torrent is unambiguous.
        if (count == 1 && !files.padFileAt(0)) {
            return 0
        }

        // Never guess a file in a multi-file torrent.
        throw IllegalArgumentException(
            "V752_FILE_IDENTITY_REQUIRED"
        )
    }


    private fun stopLocalPlaybackServer() {
        val server =
            localPlaybackServer

        localPlaybackServer = null
        localPlaybackPort = -1
        localPlaybackToken = ""

        if (server != null) {
            try {
                server.close()
            } catch (_: Throwable) {
            }
        }
    }

    private fun contentTypeForPath(
        path: String
    ): String {
        val lower =
            path.lowercase(Locale.US)

        return when {
            lower.endsWith(".mkv") ->
                "video/x-matroska"

            lower.endsWith(".webm") ->
                "video/webm"

            lower.endsWith(".mp4") ||
            lower.endsWith(".m4v") ->
                "video/mp4"

            lower.endsWith(".ts") ||
            lower.endsWith(".m2ts") ->
                "video/mp2t"

            lower.endsWith(".avi") ->
                "video/x-msvideo"

            else ->
                "application/octet-stream"
        }
    }

    private fun writeHttpHeaders(
        out: BufferedOutputStream,
        status: String,
        contentLength: Long,
        contentType: String,
        contentRange: String? = null,
        allow: String? = null
    ) {
        val builder =
            StringBuilder()

        builder
            .append("HTTP/1.1 ")
            .append(status)
            .append("\r\n")

        builder
            .append("Content-Length: ")
            .append(contentLength)
            .append("\r\n")

        builder
            .append("Content-Type: ")
            .append(contentType)
            .append("\r\n")

        builder.append(
            "Accept-Ranges: bytes\r\n"
        )

        builder.append(
            "Cache-Control: no-store\r\n"
        )

        if (contentRange != null) {
            builder
                .append("Content-Range: ")
                .append(contentRange)
                .append("\r\n")
        }

        if (allow != null) {
            builder
                .append("Allow: ")
                .append(allow)
                .append("\r\n")
        }

        builder.append(
            "Connection: close\r\n"
        )

        builder.append("\r\n")

        out.write(
            builder
                .toString()
                .toByteArray(
                    StandardCharsets.US_ASCII
                )
        )

        out.flush()
    }

    private fun boostPieceWindow(
        handle: TorrentHandle,
        firstPiece: Int,
        lastPiece: Int
    ) {
        if (
            firstPiece < 0 ||
            lastPiece < firstPiece
        ) {
            return
        }

        val windowEnd =
            minOf(
                lastPiece,
                firstPiece + 11
            )

        for (
            piece in
            firstPiece..windowEnd
        ) {
            try {
                handle.piecePriority(
                    piece,
                    Priority.SEVEN
                )

                handle.setPieceDeadline(
                    piece,
                    (piece - firstPiece) * 200
                )
            } catch (_: Throwable) {
            }
        }
    }

    private fun waitForPiece(
        handle: TorrentHandle,
        piece: Int,
        lastPiece: Int,
        token: String
    ) {
        var lastBoostAt = 0L

        while (true) {
            if (
                token != localPlaybackToken ||
                activeTorrent !== handle
            ) {
                throw IOException(
                    "V753_PLAYBACK_CANCELLED"
                )
            }

            try {
                if (handle.havePiece(piece)) {
                    return
                }
            } catch (error: Throwable) {
                throw IOException(
                    "V753_PIECE_STATUS_FAILED",
                    error
                )
            }

            val now =
                System.currentTimeMillis()

            if (
                now - lastBoostAt >= 1000L
            ) {
                boostPieceWindow(
                    handle,
                    piece,
                    lastPiece
                )

                lastBoostAt = now
            }

            Thread.sleep(100L)
        }
    }

    private fun waitForPlaybackFile(
        file: File,
        handle: TorrentHandle,
        token: String
    ) {
        while (!file.exists()) {
            if (
                token != localPlaybackToken ||
                activeTorrent !== handle
            ) {
                throw IOException(
                    "V753_PLAYBACK_CANCELLED"
                )
            }

            Thread.sleep(50L)
        }
    }

    private fun handleLocalPlaybackClient(
        socket: Socket,
        token: String
    ) {
        try {
            socket.use { client ->
                client.soTimeout = 15000

                val reader =
                    BufferedReader(
                        InputStreamReader(
                            client.getInputStream(),
                            StandardCharsets.US_ASCII
                        )
                    )

                val out =
                    BufferedOutputStream(
                        client.getOutputStream()
                    )

                val requestLine =
                    reader.readLine()
                        ?: return

                val parts =
                    requestLine
                        .trim()
                        .split(' ')

                if (parts.size < 2) {
                    writeHttpHeaders(
                        out,
                        "400 Bad Request",
                        0L,
                        "text/plain"
                    )

                    return
                }

                val method =
                    parts[0].uppercase(
                        Locale.US
                    )

                if (
                    method != "GET" &&
                    method != "HEAD"
                ) {
                    writeHttpHeaders(
                        out,
                        "405 Method Not Allowed",
                        0L,
                        "text/plain",
                        allow = "GET, HEAD"
                    )

                    return
                }

                val target =
                    parts[1]
                        .substringBefore('?')

                val expectedTarget =
                    "/v753/" +
                        token +
                        "/video"

                if (
                    token != localPlaybackToken ||
                    target != expectedTarget
                ) {
                    writeHttpHeaders(
                        out,
                        "404 Not Found",
                        0L,
                        "text/plain"
                    )

                    return
                }

                val headers =
                    HashMap<String, String>()

                while (true) {
                    val line =
                        reader.readLine()
                            ?: break

                    if (line.isEmpty()) {
                        break
                    }

                    val colon =
                        line.indexOf(':')

                    if (colon > 0) {
                        val name =
                            line
                                .substring(
                                    0,
                                    colon
                                )
                                .trim()
                                .lowercase(
                                    Locale.US
                                )

                        val value =
                            line
                                .substring(
                                    colon + 1
                                )
                                .trim()

                        headers[name] = value
                    }
                }

                Log.i(
                    LOG_TAG,
                    "[V755_HTTP_REQ] " +
                        "method=" +
                        method +
                        " target=" +
                        target +
                        " range=" +
                        (headers["range"] ?: "<none>")
                )

                val handle =
                    activeTorrent
                        ?: run {
                            writeHttpHeaders(
                                out,
                                "503 Service Unavailable",
                                0L,
                                "text/plain"
                            )

                            return
                        }

                val fileSize =
                    activeFileSize

                val fileOffset =
                    activeFileOffset

                val pieceLength =
                    activePieceLength

                val filePath =
                    activeFilePath

                if (
                    fileSize <= 0L ||
                    pieceLength <= 0 ||
                    filePath.isBlank()
                ) {
                    writeHttpHeaders(
                        out,
                        "503 Service Unavailable",
                        0L,
                        "text/plain"
                    )

                    return
                }

                var rangeStart = 0L
                var rangeEnd =
                    fileSize - 1L

                var partial = false

                val rangeHeader =
                    headers["range"]

                if (
                    rangeHeader != null &&
                    rangeHeader.isNotBlank()
                ) {
                    if (
                        !rangeHeader.startsWith(
                            "bytes=",
                            ignoreCase = true
                        ) ||
                        rangeHeader.contains(',')
                    ) {
                        writeHttpHeaders(
                            out,
                            "416 Range Not Satisfiable",
                            0L,
                            "text/plain",
                            "bytes */" + fileSize
                        )

                        return
                    }

                    val spec =
                        rangeHeader
                            .substringAfter('=')
                            .trim()

                    val dash =
                        spec.indexOf('-')

                    if (dash < 0) {
                        writeHttpHeaders(
                            out,
                            "416 Range Not Satisfiable",
                            0L,
                            "text/plain",
                            "bytes */" + fileSize
                        )

                        return
                    }

                    val left =
                        spec
                            .substring(
                                0,
                                dash
                            )
                            .trim()

                    val right =
                        spec
                            .substring(
                                dash + 1
                            )
                            .trim()

                    if (left.isEmpty()) {
                        val suffix =
                            right.toLongOrNull()

                        if (
                            suffix == null ||
                            suffix <= 0L
                        ) {
                            writeHttpHeaders(
                                out,
                                "416 Range Not Satisfiable",
                                0L,
                                "text/plain",
                                "bytes */" + fileSize
                            )

                            return
                        }

                        val amount =
                            minOf(
                                suffix,
                                fileSize
                            )

                        rangeStart =
                            fileSize - amount

                        rangeEnd =
                            fileSize - 1L
                    } else {
                        val parsedStart =
                            left.toLongOrNull()

                        if (
                            parsedStart == null ||
                            parsedStart < 0L ||
                            parsedStart >= fileSize
                        ) {
                            writeHttpHeaders(
                                out,
                                "416 Range Not Satisfiable",
                                0L,
                                "text/plain",
                                "bytes */" + fileSize
                            )

                            return
                        }

                        rangeStart =
                            parsedStart

                        if (right.isNotEmpty()) {
                            val parsedEnd =
                                right.toLongOrNull()

                            if (
                                parsedEnd == null ||
                                parsedEnd < rangeStart
                            ) {
                                writeHttpHeaders(
                                    out,
                                    "416 Range Not Satisfiable",
                                    0L,
                                    "text/plain",
                                    "bytes */" + fileSize
                                )

                                return
                            }

                            rangeEnd =
                                minOf(
                                    parsedEnd,
                                    fileSize - 1L
                                )
                        } else {
                            rangeEnd =
                                fileSize - 1L
                        }
                    }

                    partial = true
                }

                val responseLength =
                    rangeEnd -
                        rangeStart +
                        1L

                val contentType =
                    contentTypeForPath(
                        filePath
                    )

                val firstTorrentPiece =
                    (
                        (
                            fileOffset +
                                rangeStart
                        ) /
                            pieceLength
                    ).toInt()

                val lastTorrentPiece =
                    (
                        (
                            fileOffset +
                                rangeEnd
                        ) /
                            pieceLength
                    ).toInt()

                Log.i(
                    LOG_TAG,
                    "[V755_HTTP_RANGE] " +
                        "bytes=" +
                        rangeStart +
                        "-" +
                        rangeEnd +
                        "/" +
                        fileSize +
                        " pieces=" +
                        firstTorrentPiece +
                        "-" +
                        lastTorrentPiece +
                        " partial=" +
                        partial
                )

                if (method == "HEAD") {
                    writeHttpHeaders(
                        out,
                        if (partial) {
                            "206 Partial Content"
                        } else {
                            "200 OK"
                        },
                        responseLength,
                        contentType,
                        if (partial) {
                            "bytes " +
                                rangeStart +
                                "-" +
                                rangeEnd +
                                "/" +
                                fileSize
                        } else {
                            null
                        }
                    )

                    return
                }

                boostPieceWindow(
                    handle,
                    firstTorrentPiece,
                    lastTorrentPiece
                )

                val v755PieceWaitStarted =
                    System.currentTimeMillis()

                Log.i(
                    LOG_TAG,
                    "[V755_HTTP_WAIT] start " +
                        "piece=" +
                        firstTorrentPiece
                )

                waitForPiece(
                    handle,
                    firstTorrentPiece,
                    lastTorrentPiece,
                    token
                )

                Log.i(
                    LOG_TAG,
                    "[V755_HTTP_WAIT] ready " +
                        "piece=" +
                        firstTorrentPiece +
                        " waitMs=" +
                        (
                            System.currentTimeMillis() -
                                v755PieceWaitStarted
                        )
                )

                val file =
                    File(filePath)

                waitForPlaybackFile(
                    file,
                    handle,
                    token
                )

                writeHttpHeaders(
                    out,
                    if (partial) {
                        "206 Partial Content"
                    } else {
                        "200 OK"
                    },
                    responseLength,
                    contentType,
                    if (partial) {
                        "bytes " +
                            rangeStart +
                            "-" +
                            rangeEnd +
                            "/" +
                            fileSize
                    } else {
                        null
                    }
                )

                RandomAccessFile(
                    file,
                    "r"
                ).use { raf ->
                    val buffer =
                        ByteArray(
                            128 * 1024
                        )

                    var position =
                        rangeStart

                    while (
                        position <=
                            rangeEnd
                    ) {
                        if (
                            token !=
                                localPlaybackToken ||
                            activeTorrent !==
                                handle
                        ) {
                            throw IOException(
                                "V753_PLAYBACK_CANCELLED"
                            )
                        }

                        val torrentOffset =
                            fileOffset +
                                position

                        val piece =
                            (
                                torrentOffset /
                                    pieceLength
                            ).toInt()

                        boostPieceWindow(
                            handle,
                            piece,
                            lastTorrentPiece
                        )

                        waitForPiece(
                            handle,
                            piece,
                            lastTorrentPiece,
                            token
                        )

                        val pieceEndTorrent =
                            (
                                (
                                    piece.toLong() +
                                        1L
                                ) *
                                    pieceLength.toLong()
                            ) - 1L

                        val pieceEndFile =
                            minOf(
                                rangeEnd,
                                pieceEndTorrent -
                                    fileOffset
                            )

                        val remainingInPiece =
                            pieceEndFile -
                                position +
                                1L

                        val wanted =
                            minOf(
                                buffer.size.toLong(),
                                remainingInPiece
                            ).toInt()

                        if (wanted <= 0) {
                            throw IOException(
                                "V753_INVALID_PIECE_WINDOW"
                            )
                        }

                        raf.seek(
                            position
                        )

                        var read =
                            raf.read(
                                buffer,
                                0,
                                wanted
                            )

                        var readRetries = 0

                        while (
                            read <= 0 &&
                            readRetries < 100
                        ) {
                            if (
                                token !=
                                    localPlaybackToken ||
                                activeTorrent !==
                                    handle
                            ) {
                                throw IOException(
                                    "V753_PLAYBACK_CANCELLED"
                                )
                            }

                            Thread.sleep(50L)

                            raf.seek(
                                position
                            )

                            read =
                                raf.read(
                                    buffer,
                                    0,
                                    wanted
                                )

                            readRetries++
                        }

                        if (read <= 0) {
                            throw IOException(
                                "V753_FILE_READ_STALLED"
                            )
                        }

                        out.write(
                            buffer,
                            0,
                            read
                        )

                        position +=
                            read.toLong()
                    }

                    out.flush()
                }
            }
        } catch (error: Throwable) {
            if (
                token ==
                    localPlaybackToken
            ) {
                Log.w(
                    LOG_TAG,
                    "[V753_HTTP] client failure " +
                        "type=" +
                        error.javaClass.name +
                        " message=" +
                        (error.message ?: "")
                )
            }
        }
    }

    // V755_BOOTSTRAP_BUFFER
    //
    // V753 previously exposed the localhost URL immediately after
    // metadata/file selection.  Media3 could therefore connect
    // before even the first torrent piece existed and abandon the
    // socket before data became available.
    //
    // Give libtorrent a measured startup window before Media3 is
    // allowed to connect.  Also prioritize the tail so containers
    // that require end-of-file metadata can obtain it promptly.
    private fun bootstrapPlaybackPieces(
        handle: TorrentHandle,
        firstPiece: Int,
        lastPiece: Int,
        infoHash: String
    ) {
        val startedAt =
            System.currentTimeMillis()

        val maxWaitMs =
            20000L

        val tailStart =
            maxOf(
                firstPiece,
                lastPiece - 3
            )

        fun boostBootstrapWindow() {
            boostPieceWindow(
                handle,
                firstPiece,
                lastPiece
            )

            for (
                piece in
                tailStart..lastPiece
            ) {
                try {
                    handle.piecePriority(
                        piece,
                        Priority.SEVEN
                    )

                    handle.setPieceDeadline(
                        piece,
                        (
                            piece -
                                tailStart
                        ) * 200
                    )
                } catch (_: Throwable) {
                }
            }
        }

        boostBootstrapWindow()

        var lastLogAt =
            0L

        while (
            System.currentTimeMillis() -
                startedAt <
                maxWaitMs
        ) {
            if (
                activeTorrent !== handle ||
                activeInfoHash != infoHash
            ) {
                throw IllegalStateException(
                    "V755_BOOTSTRAP_CANCELLED"
                )
            }

            val headReady =
                try {
                    handle.havePiece(
                        firstPiece
                    )
                } catch (_: Throwable) {
                    false
                }

            val tailReady =
                try {
                    handle.havePiece(
                        lastPiece
                    )
                } catch (_: Throwable) {
                    false
                }

            val now =
                System.currentTimeMillis()

            val elapsed =
                now - startedAt

            if (headReady) {
                Log.i(
                    LOG_TAG,
                    "[V755_BOOTSTRAP] ready " +
                        "hash=" +
                        infoHash.take(8) +
                        " waitMs=" +
                        elapsed +
                        " firstPiece=" +
                        firstPiece +
                        " tailReady=" +
                        tailReady
                )

                return
            }

            if (
                elapsed -
                    lastLogAt >=
                    2000L
            ) {
                Log.i(
                    LOG_TAG,
                    "[V755_BOOTSTRAP] waiting " +
                        "hash=" +
                        infoHash.take(8) +
                        " waitMs=" +
                        elapsed +
                        " firstPiece=" +
                        firstPiece +
                        " lastPiece=" +
                        lastPiece +
                        " tailReady=" +
                        tailReady
                )

                boostBootstrapWindow()

                lastLogAt =
                    elapsed
            }

            Thread.sleep(
                100L
            )
        }

        Log.w(
            LOG_TAG,
            "[V755_BOOTSTRAP] window-expired " +
                "hash=" +
                infoHash.take(8) +
                " waitMs=" +
                (
                    System.currentTimeMillis() -
                        startedAt
                ) +
                " firstPiece=" +
                firstPiece
        )
    }

    private fun startLocalPlaybackServer(): String {
        if (activeTorrent == null) {
            throw IllegalStateException(
                "V753_ACTIVE_TORRENT_MISSING"
            )
        }

        if (
            activeFileSize <= 0L ||
            activePieceLength <= 0 ||
            activeFilePath.isBlank()
        ) {
            throw IllegalStateException(
                "V753_ACTIVE_FILE_INVALID"
            )
        }

        stopLocalPlaybackServer()

        val server =
            ServerSocket(
                0,
                16,
                InetAddress.getByName(
                    "127.0.0.1"
                )
            )

        val token =
            UUID
                .randomUUID()
                .toString()
                .replace(
                    "-",
                    ""
                )

        localPlaybackServer =
            server

        localPlaybackPort =
            server.localPort

        localPlaybackToken =
            token

        localPlaybackAcceptExecutor.execute {
            try {
                while (
                    !server.isClosed &&
                    localPlaybackServer ===
                        server
                ) {
                    val socket =
                        server.accept()

                    localPlaybackClientExecutor.execute {
                        handleLocalPlaybackClient(
                            socket,
                            token
                        )
                    }
                }
            } catch (error: Throwable) {
                if (!server.isClosed) {
                    Log.w(
                        LOG_TAG,
                        "[V753_HTTP] accept failure " +
                            "type=" +
                            error.javaClass.name +
                            " message=" +
                            (error.message ?: "")
                    )
                }
            }
        }

        val playbackUrl =
            "http://127.0.0.1:" +
                server.localPort +
                "/v753/" +
                token +
                "/video"

        Log.i(
            LOG_TAG,
            "[V753_HTTP] listening " +
                "port=" +
                server.localPort +
                " fileIdx=" +
                activeFileIndex +
                " size=" +
                activeFileSize
        )

        return playbackUrl
    }

    private fun clearActiveTorrent() {
        stopLocalPlaybackServer()

        val old = activeTorrent

        if (old != null) {
            try {
                sessionManager.remove(old)
            } catch (_: Throwable) {
            }
        }

        activeTorrent = null
        activeTorrentInfo = null
        activeInfoHash = ""
        activeFileIndex = -1
        activeFileSize = 0L
        activeFilePath = ""
        activeFileOffset = 0L
        activePieceLength = 0
    }

    @ReactMethod
    fun prepareTorrent(
        infoHash: String,
        magnet: String,
        fileIdx: Double,
        filename: String,
        promise: Promise
    ) {
        engineExecutor.execute {
            try {
                val hash =
                    infoHash.trim().lowercase()

                if (
                    !Regex("^[0-9a-f]{40}$")
                        .matches(hash)
                ) {
                    throw IllegalArgumentException(
                        "Invalid 40-character v1 infoHash"
                    )
                }

                if (!sessionManager.isRunning()) {
                    sessionManager.start()
                }

                // DHT is started only after explicit P2P preparation.
                if (!sessionManager.isDhtRunning()) {
                    sessionManager.startDht()
                }

                if (
                    activeInfoHash.isNotEmpty() &&
                    activeInfoHash != hash
                ) {
                    clearActiveTorrent()
                }

                val requestedIndex =
                    if (fileIdx >= 0.0) {
                        fileIdx.toInt()
                    } else {
                        -1
                    }

                val suppliedMagnet =
                    magnet.trim()

                val effectiveMagnet =
                    if (
                        suppliedMagnet.startsWith(
                            "magnet:",
                            ignoreCase = true
                        )
                    ) {
                        suppliedMagnet
                    } else {
                        "magnet:?xt=urn:btih:$hash"
                    }

                val saveDir =
                    torrentCacheDir(hash)

                Log.i(
                    LOG_TAG,
                    "[V752_PREP] add hash=${hash.take(8)}"
                )

                sessionManager.download(
                    effectiveMagnet,
                    saveDir,
                    torrent_flags_t()
                )

                val hashObject =
                    Sha1Hash(hash)

                val metadataDeadline =
                    System.currentTimeMillis() + 30000L

                var handle: TorrentHandle? = null
                var torrentInfo: TorrentInfo? = null

                while (
                    System.currentTimeMillis() <
                        metadataDeadline
                ) {
                    handle =
                        sessionManager.find(hashObject)

                    torrentInfo =
                        handle?.torrentFile()

                    if (
                        torrentInfo != null &&
                        torrentInfo.isValid()
                    ) {
                        break
                    }

                    Thread.sleep(150L)
                }

                val readyHandle =
                    handle
                        ?: throw IllegalStateException(
                            "V752_TORRENT_HANDLE_TIMEOUT"
                        )

                val readyInfo =
                    torrentInfo
                        ?: throw IllegalStateException(
                            "V752_METADATA_TIMEOUT"
                        )

                if (!readyInfo.isValid()) {
                    throw IllegalStateException(
                        "V752_METADATA_INVALID"
                    )
                }

                val selected =
                    selectTorrentFile(
                        readyInfo,
                        requestedIndex,
                        filename
                    )

                val files =
                    readyInfo.files()

                val priorities =
                    Priority.array(
                        Priority.IGNORE,
                        readyInfo.numFiles()
                    )

                priorities[selected] =
                    Priority.SEVEN

                readyHandle.prioritizeFiles(
                    priorities
                )

                val fileSize =
                    files.fileSize(selected)

                if (fileSize <= 0L) {
                    throw IllegalStateException(
                        "Selected torrent file has zero size"
                    )
                }

                val pieceLength =
                    readyInfo.pieceLength()

                if (pieceLength <= 0) {
                    throw IllegalStateException(
                        "Torrent piece length is invalid"
                    )
                }

                val fileOffset =
                    files.fileOffset(selected)

                val firstPiece =
                    (fileOffset / pieceLength)
                        .toInt()

                val lastPiece =
                    (
                        (fileOffset + fileSize - 1L) /
                            pieceLength
                    ).toInt()

                // Front-load enough pieces for player startup.
                val startupEnd =
                    minOf(
                        lastPiece,
                        firstPiece + 11
                    )

                for (piece in firstPiece..startupEnd) {
                    readyHandle.piecePriority(
                        piece,
                        Priority.SEVEN
                    )

                    readyHandle.setPieceDeadline(
                        piece,
                        (piece - firstPiece) * 200
                    )
                }

                activeInfoHash = hash
                activeTorrent = readyHandle
                activeTorrentInfo = readyInfo
                activeFileIndex = selected
                activeFileSize = fileSize
                activeFilePath =
                    files.filePath(
                        selected,
                        saveDir.absolutePath
                    )

                activeFileOffset =
                    fileOffset

                activePieceLength =
                    pieceLength

                bootstrapPlaybackPieces(
                    handle,
                    firstPiece,
                    lastPiece,
                    hash
                )

                val playbackUrl =
                    startLocalPlaybackServer()

                val status =
                    readyHandle.status(true)

                val result =
                    Arguments.createMap()

                result.putString(
                    "status",
                    "prepared"
                )

                result.putString(
                    "infoHash",
                    hash
                )

                result.putInt(
                    "fileIdx",
                    selected
                )

                result.putString(
                    "filename",
                    files.fileName(selected)
                )

                result.putString(
                    "filePath",
                    activeFilePath
                )

                result.putString(
                    "playbackUrl",
                    playbackUrl
                )

                result.putInt(
                    "playbackPort",
                    localPlaybackPort
                )

                result.putDouble(
                    "fileSize",
                    fileSize.toDouble()
                )

                result.putInt(
                    "pieceLength",
                    pieceLength
                )

                result.putInt(
                    "firstPiece",
                    firstPiece
                )

                result.putInt(
                    "lastPiece",
                    lastPiece
                )

                result.putInt(
                    "peers",
                    status.numPeers()
                )

                result.putDouble(
                    "downloadRate",
                    status.downloadRate().toDouble()
                )

                Log.i(
                    LOG_TAG,
                    "[V752_PREP] prepared " +
                        "hash=${hash.take(8)} " +
                        "file=$selected " +
                        "pieces=$firstPiece-$lastPiece " +
                        "size=$fileSize"
                )

                promise.resolve(result)

            } catch (error: Throwable) {
                Log.e(
                    LOG_TAG,
                    "[V752_PREP] failure " +
                        "type=${error.javaClass.name} " +
                        "message=${error.message ?: ""}",
                    error
                )

                promise.reject(
                    "V752_TORRENT_PREP_FAILED",
                    error.message
                        ?: "Unable to prepare torrent.",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun startEngine(
        promise: Promise
    ) {
        engineExecutor.execute {
            try {
                if (!sessionManager.isRunning()) {
                    sessionManager.start()
                }

                val result =
                    Arguments.createMap()

                result.putBoolean(
                    "running",
                    sessionManager.isRunning()
                )

                result.putBoolean(
                    "dhtRunning",
                    sessionManager.isDhtRunning()
                )

                result.putBoolean(
                    "nativeSessionPresent",
                    sessionManager.swig() != null
                )

                result.putInt(
                    "torrentCount",
                    sessionManager.getTorrentHandles().size
                )

                Log.i(
                    LOG_TAG,
                    "[V752_ENGINE] start " +
                        "running=${sessionManager.isRunning()} " +
                        "torrents=${sessionManager.getTorrentHandles().size}"
                )

                promise.resolve(result)

            } catch (error: Throwable) {
                promise.reject(
                    "V752_ENGINE_START_FAILED",
                    error.message ?: "Unable to start native torrent engine.",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun engineStatus(
        promise: Promise
    ) {
        engineExecutor.execute {
            try {
                val result =
                    Arguments.createMap()

                result.putBoolean(
                    "running",
                    sessionManager.isRunning()
                )

                result.putBoolean(
                    "dhtRunning",
                    sessionManager.isDhtRunning()
                )

                result.putBoolean(
                    "nativeSessionPresent",
                    sessionManager.swig() != null
                )

                result.putInt(
                    "torrentCount",
                    sessionManager.getTorrentHandles().size
                )

                promise.resolve(result)

            } catch (error: Throwable) {
                promise.reject(
                    "V752_ENGINE_STATUS_FAILED",
                    error.message ?: "Unable to read native torrent engine status.",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun stopEngine(
        promise: Promise
    ) {
        engineExecutor.execute {
            try {
                clearActiveTorrent()

                if (sessionManager.isRunning()) {
                    sessionManager.stop()
                }

                val result =
                    Arguments.createMap()

                result.putBoolean(
                    "running",
                    sessionManager.isRunning()
                )

                result.putBoolean(
                    "nativeSessionPresent",
                    sessionManager.swig() != null
                )

                Log.i(
                    LOG_TAG,
                    "[V752_ENGINE] stop " +
                        "running=${sessionManager.isRunning()}"
                )

                promise.resolve(result)

            } catch (error: Throwable) {
                promise.reject(
                    "V752_ENGINE_STOP_FAILED",
                    error.message ?: "Unable to stop native torrent engine.",
                    error
                )
            }
        }
    }
    @ReactMethod
    fun probe(
        promise: Promise
    ) {
        try {
            val result =
                Arguments.createMap()

            result.putBoolean(
                "loaded",
                true
            )

            result.putString(
                "jlibtorrentVersion",
                LibTorrent.jlibtorrentVersion()
            )

            result.putString(
                "libtorrentVersion",
                LibTorrent.version()
            )

            result.putString(
                "abi",
                Build.SUPPORTED_ABIS.joinToString(",")
            )

            result.putBoolean(
                "sessionConstructed",
                true
            )

            result.putBoolean(
                "sessionStarted",
                sessionManager.isRunning()
            )

            result.putBoolean(
                "dhtRunning",
                sessionManager.isDhtRunning()
            )

            result.putBoolean(
                "nativeSessionPresent",
                sessionManager.swig() != null
            )

            promise.resolve(
                result
            )
        } catch (error: Throwable) {
            promise.reject(
                "V752_NATIVE_LOAD_FAILED",
                error.message
                    ?: "Unable to load jlibtorrent native library.",
                error
            )
        }
    }
}
