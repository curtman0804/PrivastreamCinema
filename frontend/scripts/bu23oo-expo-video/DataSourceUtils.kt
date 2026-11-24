package expo.modules.video

import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.hls.HlsMediaSource
import expo.modules.video.enums.ContentType
import expo.modules.video.records.VideoSource
import okhttp3.OkHttpClient
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.util.TimestampAdjuster
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsMediaChunkExtractor
import androidx.media3.extractor.ExtractorInput
import java.io.IOException
import androidx.media3.exoplayer.hls.playlist.DefaultHlsPlaylistParserFactory
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParserFactory
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.upstream.ParsingLoadable
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.DiscardingTrackOutput
import androidx.media3.common.util.ParsableByteArray

@OptIn(UnstableApi::class)
fun buildBaseDataSourceFactory(context: Context, videoSource: VideoSource): DataSource.Factory {
  return if (videoSource.uri?.scheme?.startsWith("http") == true) {
    buildOkHttpDataSourceFactory(context, videoSource)
  } else {
    DefaultDataSource.Factory(context)
  }
}

@OptIn(UnstableApi::class)
fun buildOkHttpDataSourceFactory(context: Context, videoSource: VideoSource): OkHttpDataSource.Factory {
  val client = OkHttpClient.Builder().build()

  // If the application name has ANY non-ASCII characters, we need to strip them out. This is because using non-ASCII characters
  // in the User-Agent header can cause issues with getting the media to play.
  val applicationName = getApplicationName(context).filter { it.code in 0..127 }

  val defaultUserAgent = Util.getUserAgent(context, applicationName)

  return OkHttpDataSource.Factory(client).apply {
    val headers = videoSource.headers
    headers?.takeIf { it.isNotEmpty() }?.let {
      setDefaultRequestProperties(it)
    }
    val userAgent = headers?.get("User-Agent") ?: defaultUserAgent
    setUserAgent(userAgent)
  }
}

@OptIn(UnstableApi::class)
fun buildCacheDataSourceFactory(context: Context, videoSource: VideoSource): DataSource.Factory {
  return CacheDataSource.Factory().apply {
    setCache(VideoManager.cache.instance)
    setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    setUpstreamDataSourceFactory(buildBaseDataSourceFactory(context, videoSource))
  }
}

fun buildMediaSourceFactory(context: Context, dataSourceFactory: DataSource.Factory): MediaSource.Factory {
  return DefaultMediaSourceFactory(context).setDataSourceFactory(dataSourceFactory)
}

@OptIn(UnstableApi::class)
fun buildExpoVideoMediaSource(context: Context, videoSource: VideoSource): MediaSource =
  buildExpoVideoMediaSource(context, videoSource, null)

@OptIn(UnstableApi::class)
internal fun buildExpoVideoMediaSource(context: Context, videoSource: VideoSource,
  audioEvidence: Bu23nrAudioEvidence?): MediaSource {
  val dataSourceFactory = if (videoSource.useCaching) {
    buildCacheDataSourceFactory(context, videoSource)
  } else {
    buildBaseDataSourceFactory(context, videoSource)
  }
  val mediaItem = videoSource.toMediaItem(context)
  // BU23NN: permit manifest-based preparation only for known Pluto HLS.
  // Media3 still falls back to segment inspection when codec declarations are insufficient.
  val uri = videoSource.uri
  val host = uri?.host?.lowercase(java.util.Locale.ROOT) ?: ""
  val path = uri?.path ?: ""
  val knownPluto = (uri?.scheme == "https" || uri?.scheme == "http") &&
    (host == "pluto.tv" || host.endsWith(".pluto.tv") ||
      (host == "api.privastreamsolutions.com" && path == "/api/live/pluto/master.m3u8"))
  val plutoHls = knownPluto && (videoSource.contentType == ContentType.HLS ||
    (videoSource.contentType == ContentType.AUTO && path.endsWith(".m3u8", ignoreCase = true)))
  if (plutoHls) {
    android.util.Log.i("BU23NN", "pluto_hls allowChunklessPreparation=true")
    val audioRoles = Bu23ofAudioRoles()
    return HlsMediaSource.Factory(dataSourceFactory)
      .setAllowChunklessPreparation(true)
      .setPlaylistParserFactory(audioRoles)
      .setExtractorFactory(Bu23npPlutoExtractor(null, audioEvidence, audioRoles = audioRoles))
      .createMediaSource(mediaItem)
  }
  // BU23E3: HLS only. Let Media3 inspect segments rather than relying on
  // multivariant-playlist track declarations (especially at ad join).
  // Non-HLS sources retain their original media source construction.
  if (videoSource.contentType == ContentType.HLS) {
    android.util.Log.i("BU23E3_HLS", "segment-based HLS preparation enabled")
    return HlsMediaSource.Factory(dataSourceFactory)
      .setAllowChunklessPreparation(false)
      .createMediaSource(mediaItem)
  }
  val mediaSourceFactory = buildMediaSourceFactory(context, dataSourceFactory)
  return mediaSourceFactory.createMediaSource(mediaItem)
}

// BU23NR: each HLS preparation owns its own evidence. Old loader threads
// can only update their retired instance, never the current source.
internal class Bu23nrAudioEvidence {
  @Volatile var lastSampleMs = -1L
    private set
  @Synchronized fun mark(now: Long) {
    if (now > lastSampleMs) lastSampleMs = now
  }
}

internal class Bu23nrRecoveryGate {
  private var missingSince = -1L
  private var firstFresh = -1L
  var used = false
    private set

  fun shouldReprepare(now: Long, missingWhilePlaying: Boolean, lastAudio: Long): Boolean {
    if (used) return false
    if (!missingWhilePlaying) {
      missingSince = -1L
      firstFresh = -1L
      return false
    }
    if (missingSince < 0L) missingSince = now
    // Require real sample activity after the missing-track state began.
    // A single old/buffered sample burst cannot trigger a restart.
    if (lastAudio < missingSince || lastAudio > now || now - lastAudio > 8000L) {
      firstFresh = -1L
      return false
    }
    if (firstFresh < 0L) firstFresh = lastAudio
    if (now - missingSince < 6000L || lastAudio - firstFresh < 3000L) return false
    used = true
    return true
  }
}

private fun getApplicationName(context: Context): String {
  val applicationInfo: ApplicationInfo = context.applicationInfo
  val stringId = applicationInfo.labelRes
  return if (stringId == 0) applicationInfo.nonLocalizedLabel.toString() else context.getString(stringId)
}

// BU23NP: Trust the actual transport stream when a video-only manifest codec
// hint contradicts its PMT. No new HTTP request, URL change, or synthetic track.
@OptIn(UnstableApi::class)
private class Bu23npPlutoExtractor(
  private val captureDir: java.io.File?,
  private val audioEvidence: Bu23nrAudioEvidence?,
  private val delegate: DefaultHlsExtractorFactory = DefaultHlsExtractorFactory(),
  private val audioRoles: Bu23ofAudioRoles? = null
) : HlsExtractorFactory by delegate {
  private var reports = 0

  override fun createExtractor(
    uri: Uri,
    format: Format,
    muxedCaptionFormats: List<Format>?,
    timestampAdjuster: TimestampAdjuster,
    responseHeaders: Map<String, List<String>>,
    sniffingExtractorInput: ExtractorInput,
    playerId: PlayerId
  ): HlsMediaChunkExtractor {
    val codecs = format.codecs
    val videoOnly = !codecs.isNullOrBlank() &&
      Util.getCodecCountOfType(codecs, C.TRACK_TYPE_VIDEO) > 0 &&
      Util.getCodecCountOfType(codecs, C.TRACK_TYPE_AUDIO) == 0
    var effective = format
    if (videoOnly) {
      // A small, bounded peek of the existing extractor input. Require
      // a structurally valid PAT and PMT with an AAC elementary stream.
      val prefix = ByteArray(188 * 20)
      val aac = try {
        sniffingExtractorInput.resetPeekPosition()
        sniffingExtractorInput.peekFully(prefix, 0, prefix.size, true) &&
          bu23npHasAacPmt(prefix)
      } catch (_: IOException) {
        false
      } finally {
        sniffingExtractorInput.resetPeekPosition()
      }
      if (aac) {
        // DefaultHlsExtractorFactory otherwise sets FLAG_IGNORE_AAC_STREAM
        // for a nonempty codec string lacking AAC. Clear only its hint;
        // actual samples determine the format and no track is fabricated.
        effective = format.buildUpon().setCodecs(null).build()
        android.util.Log.i("BU23NP", "aac_pmt_confirmed action=allow_segment_audio_discovery")
      } else if (reports++ < 8) {
        android.util.Log.i("BU23NP", "video_only_hint aac_pmt_not_verified action=unchanged")
      }
    } else if (reports++ < 8) {
      android.util.Log.i("BU23NP", "codec_hint_unchanged hasAudioCodec=" +
        (Util.getCodecCountOfType(codecs, C.TRACK_TYPE_AUDIO) > 0))
    }
    // Only the external stereo audio rendition from this exact master can use
    // the provisional AAC queue. Never classify an ordinary video variant by URL.
    val eligibleAudio = audioRoles?.matches(format) == true && format.drmInitData == null &&
      bu23ofIsTransportStream(sniffingExtractorInput)
    val inner = delegate.createExtractor(uri, effective, muxedCaptionFormats,
      timestampAdjuster, responseHeaders, sniffingExtractorInput, playerId)
    val identity = bu23nqNextId.incrementAndGet()
    android.util.Log.i("BU23NQ", "extractor id=$identity manifestMime=${format.sampleMimeType} codecs=${format.codecs} channels=${format.channelCount} height=${format.height} packed=${inner.isPackedAudioExtractor()} reusable=${inner.isReusable()}")
    val observed = Bu23nqObservedExtractor(inner, if (format.drmInitData == null) captureDir else null, identity,
      if (format.drmInitData == null) audioEvidence else null)
    return if (eligibleAudio && !inner.isPackedAudioExtractor()) {
      android.util.Log.i("BU23OF", "external_stereo_ts_audio_rendition=true")
      Bu23ofStableAudioExtractor(observed)
    } else observed
  }
}

// Conservative single-packet PSI parser: no guessing, no encrypted PSI,
// no multi-packet table reconstruction. Unknown layouts pass through.
private fun bu23npHasAacPmt(data: ByteArray): Boolean {
  if (data.size < 188 * 5 || data.size % 188 != 0) return false
  fun u(i: Int) = data[i].toInt() and 255
  val pmtPids = mutableSetOf<Int>()
  fun sectionStart(offset: Int): Int? {
    if (u(offset) != 0x47 || (u(offset + 1) and 0xC0) != 0x40 ||
      (u(offset + 3) and 0xC0) != 0) return null
    val afc = (u(offset + 3) shr 4) and 3
    if (afc != 1 && afc != 3) return null
    var pos = offset + 4
    if (afc == 3) pos += 1 + u(pos)
    if (pos >= offset + 188) return null
    pos += 1 + u(pos)
    if (pos + 3 > offset + 188) return null
    return pos
  }
  fun endOfSection(pos: Int, offset: Int): Int? {
    if ((u(pos + 1) and 0x80) == 0) return null
    val end = pos + 3 + (((u(pos + 1) and 15) shl 8) or u(pos + 2))
    if (end > offset + 188 || end < pos + 12) return null
    return end
  }
  // Require correct 188-byte packet alignment throughout the sample.
  for (offset in data.indices step 188) if (u(offset) != 0x47) return false
  for (offset in data.indices step 188) {
    val pid = ((u(offset + 1) and 31) shl 8) or u(offset + 2)
    if (pid != 0) continue
    val pos = sectionStart(offset) ?: continue
    val end = endOfSection(pos, offset) ?: continue
    if (u(pos) != 0 || (u(pos + 5) and 1) == 0) continue
    var p = pos + 8
    while (p + 4 <= end - 4) {
      if ((u(p) shl 8 or u(p + 1)) != 0)
        pmtPids.add(((u(p + 2) and 31) shl 8) or u(p + 3))
      p += 4
    }
  }
  for (offset in data.indices step 188) {
    val pid = ((u(offset + 1) and 31) shl 8) or u(offset + 2)
    if (pid !in pmtPids) continue
    val pos = sectionStart(offset) ?: continue
    val end = endOfSection(pos, offset) ?: continue
    if (u(pos) != 2 || end < pos + 16 || (u(pos + 5) and 1) == 0) continue
    var p = pos + 12 + (((u(pos + 10) and 15) shl 8) or u(pos + 11))
    while (p + 5 <= end - 4) {
      val streamType = u(p)
      val infoLength = ((u(p + 3) and 15) shl 8) or u(p + 4)
      if (p + 5 + infoLength > end - 4) break
      if (streamType == 0x0F || streamType == 0x11) return true
      p += 5 + infoLength
    }
  }
  return false
}

// BU23NQ evidence-only observer. No extra network requests, no format changes,
// no seeks or source replacements. Capture only a contiguous prefix of bytes
// consumed by the original extractor, never HTTP headers, URLs or key requests.
private val bu23nqNextId = java.util.concurrent.atomic.AtomicInteger(0)
private val bu23nqCaptures = java.util.concurrent.atomic.AtomicInteger(0)

@OptIn(UnstableApi::class)
private class Bu23nqObservedExtractor(
  private val inner: HlsMediaChunkExtractor,
  private val dir: java.io.File?,
  private val id: Int,
  private val audioEvidence: Bu23nrAudioEvidence?
) : HlsMediaChunkExtractor by inner {
  private var lastInput: ExtractorInput? = null
  private var prefix: Bu23nqPrefix? = null
  private var lastCapture = -1L
  private var captureCount = 0

  override fun init(output: androidx.media3.extractor.ExtractorOutput) {
    inner.init(object : androidx.media3.extractor.ExtractorOutput by output {
      override fun track(trackId: Int, type: Int): androidx.media3.extractor.TrackOutput {
        val target = output.track(trackId, type)
        android.util.Log.i("BU23NQ", "track extractor=$id track=$trackId type=$type")
        return object : androidx.media3.extractor.TrackOutput by target {
          private var samples = 0L
          private var confirmedAac = false
          private var validSamples = 0L
          override fun format(format: Format) {
            target.format(format)
            confirmedAac = type == C.TRACK_TYPE_AUDIO &&
              format.sampleMimeType == "audio/mp4a-latm" && format.sampleRate > 0 &&
              format.channelCount > 0 && format.drmInitData == null
            validSamples = 0L
            android.util.Log.i("BU23NQ", "format extractor=$id track=$trackId type=$type mime=${format.sampleMimeType} codecs=${format.codecs} rate=${format.sampleRate} channels=${format.channelCount}")
          }
          override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int,
            cryptoData: androidx.media3.extractor.TrackOutput.CryptoData?) {
            target.sampleMetadata(timeUs, flags, size, offset, cryptoData)
            samples++
            if (confirmedAac && size > 0 && cryptoData == null && audioEvidence != null) {
              validSamples++
              if (validSamples == 8L || (validSamples > 8L && validSamples % 32L == 0L)) {
                audioEvidence.mark(android.os.SystemClock.elapsedRealtime())
              }
            }
            if (samples == 1L || (type == C.TRACK_TYPE_AUDIO && samples % 128L == 0L)) {
              android.util.Log.i("BU23NQ", "sample extractor=$id track=$trackId type=$type count=$samples size=$size ptsUs=$timeUs encrypted=${cryptoData != null}")
            }
          }
        }
      }
      override fun endTracks() {
        output.endTracks()
        android.util.Log.i("BU23NQ", "endTracks extractor=$id")
      }
    })
  }

  override fun read(input: ExtractorInput): Boolean {
    if (input !== lastInput) {
      prefix?.finish("next_input")
      prefix = null
      lastInput = input
      val now = android.os.SystemClock.elapsedRealtime()
      if (dir != null && captureCount < 8 &&
        (lastCapture < 0 || now - lastCapture >= 20000) &&
        bu23nqCaptures.incrementAndGet() <= 40) {
        captureCount++
        lastCapture = now
        prefix = Bu23nqPrefix(input, dir, id)
      }
    }
    val active = prefix
    val result = inner.read(active ?: input)
    if (!result) {
      active?.finish("extractor_end")
      prefix = null
    }
    return result
  }

  override fun recreate(): HlsMediaChunkExtractor =
    Bu23nqObservedExtractor(inner.recreate(), dir, bu23nqNextId.incrementAndGet(), audioEvidence)
}

@OptIn(UnstableApi::class)
private class Bu23nqPrefix(
  input: ExtractorInput,
  private val dir: java.io.File,
  private val id: Int
) : androidx.media3.extractor.ForwardingExtractorInput(input) {
  private val buffer = java.io.ByteArrayOutputStream()
  private val limit = 512 * 1024
  private val start = input.position
  private var finished = false
  private fun add(bytes: ByteArray, offset: Int, count: Int) {
    if (finished || count <= 0) return
    val n = minOf(count, limit - buffer.size())
    if (n > 0) buffer.write(bytes, offset, n)
    if (buffer.size() >= limit) finish("prefix_limit")
  }
  fun finish(reason: String) {
    if (finished) return
    finished = true
    try {
      if (buffer.size() == 0) return
      // Cap retained local diagnostic files as well as per-process captures.
      if (!dir.exists() && !dir.mkdirs()) return
      if ((dir.listFiles()?.count { it.name.endsWith(".bin") } ?: 0) >= 48) {
        android.util.Log.i("BU23NQ", "capture_limit_reached")
        return
      }
      val name = "segment-${System.currentTimeMillis()}-$id-${java.util.UUID.randomUUID().toString().take(8)}.bin"
      val file = java.io.File(dir, name)
      file.writeBytes(buffer.toByteArray())
      android.util.Log.i("BU23NQ", "prefix extractor=$id file=$name bytes=${buffer.size()} start=$start reason=$reason")
    } catch (e: Exception) {
      android.util.Log.w("BU23NQ", "capture_failed type=${e.javaClass.simpleName}")
    } finally { buffer.reset() }
  }
  override fun read(target: ByteArray, offset: Int, length: Int): Int {
    val n = super.read(target, offset, length)
    if (n > 0) add(target, offset, n)
    if (n == C.RESULT_END_OF_INPUT) finish("input_end")
    return n
  }
  override fun readFully(target: ByteArray, offset: Int, length: Int, allowEndOfInput: Boolean): Boolean {
    val ok = super.readFully(target, offset, length, allowEndOfInput)
    if (ok) add(target, offset, length) else finish("input_end")
    return ok
  }
  override fun readFully(target: ByteArray, offset: Int, length: Int) {
    super.readFully(target, offset, length)
    add(target, offset, length)
  }
  override fun skip(length: Int): Int {
    val n = super.skip(length)
    if (n > 0) finish("before_gap")
    return n
  }
  override fun skipFully(length: Int, allowEndOfInput: Boolean): Boolean {
    val ok = super.skipFully(length, allowEndOfInput)
    if (ok && length > 0) finish("before_gap")
    return ok
  }
  override fun skipFully(length: Int) {
    super.skipFully(length)
    if (length > 0) finish("before_gap")
  }
}

// BU23OF: use Media3's own playlist parser. Do not edit playlists, URLs,
// encryption settings, keys, or the HTTP data source.
@OptIn(UnstableApi::class)
private class Bu23ofAudioRoles : HlsPlaylistParserFactory {
  private val base = DefaultHlsPlaylistParserFactory()
  @Volatile private var audioFormat: Format? = null
  override fun createPlaylistParser(): ParsingLoadable.Parser<HlsPlaylist> = wrap(base.createPlaylistParser())
  override fun createPlaylistParser(master: HlsMultivariantPlaylist,
    previous: HlsMediaPlaylist?): ParsingLoadable.Parser<HlsPlaylist> = wrap(base.createPlaylistParser(master, previous))
  private fun wrap(parser: ParsingLoadable.Parser<HlsPlaylist>): ParsingLoadable.Parser<HlsPlaylist> =
    ParsingLoadable.Parser { uri, input ->
      val playlist = parser.parse(uri, input)
      if (playlist is HlsMultivariantPlaylist) {
        val rendition = playlist.audios.singleOrNull()
        audioFormat = if (rendition != null && rendition.url != null &&
          rendition.format.id != null && rendition.format.channelCount == 2 &&
          rendition.format.drmInitData == null && playlist.sessionKeyDrmInitData.isEmpty() &&
          (rendition.format.codecs.isNullOrBlank() || rendition.format.codecs == "mp4a.40.2") &&
          playlist.variants.isNotEmpty() && playlist.variants.all {
            it.audioGroupId == rendition.groupId && it.url != rendition.url && it.format.id != rendition.format.id
          }) rendition.format else null
      }
      playlist
    }
  fun matches(format: Format): Boolean = audioFormat?.let { it == format } == true
}

@OptIn(UnstableApi::class)
private fun bu23ofIsTransportStream(input: ExtractorInput): Boolean {
  val prefix = ByteArray(188 * 3)
  return try {
    input.resetPeekPosition()
    input.peekFully(prefix, 0, prefix.size, true) &&
      (0..2).all { (prefix[it * 188].toInt() and 255) == 0x47 }
  } catch (_: IOException) { false }
  finally { input.resetPeekPosition() }
}

// Pure timestamp gate: only a completed, non-resumed input with no actual
// audio track or samples, and a bounded observed video timestamp span.
internal fun bu23ofSilenceTimes(first: Long, last: Long, count: Int,
  genuineAudio: Boolean, complete: Boolean, resumed: Boolean): LongArray {
  if (genuineAudio || !complete || resumed || count < 10 || first < 0 || last < first) return longArrayOf()
  val span = last - first
  if (span !in 500000L..12000000L) return longArrayOf()
  // Do not extend past the last observed video timestamp; no invented segment duration.
  val frames = (span * 48000L / 1024000000L).toInt()
  return LongArray(frames) { first + it.toLong() * 1024000000L / 48000L }
}

@OptIn(UnstableApi::class)
private class Bu23ofStableAudioExtractor(private val inner: HlsMediaChunkExtractor) : HlsMediaChunkExtractor by inner {
  private var queue: TrackOutput? = null
  private var genuineTrack = false
  private var genuineTrackId: Int? = null
  private var reserved = false
  private var sawVideo = false
  private var ended = false
  private var inputIdentity: ExtractorInput? = null
  private var resumed = false
  private var count = 0
  private var first = Long.MAX_VALUE
  private var last = Long.MIN_VALUE
  private var complete = false
  private val stableTrackId = 0x6f230001
  // AAC-LC 48 kHz stereo: independently generated silent access unit.
  private val silence = byteArrayOf(0x21, 0x10, 0x04, 0x60, 0x8c.toByte(), 0x1c)

  override fun init(output: ExtractorOutput) {
    inner.init(object : ExtractorOutput by output {
      override fun track(trackId: Int, type: Int): TrackOutput {
        if (type == C.TRACK_TYPE_AUDIO) {
          if (genuineTrackId != null && genuineTrackId != trackId) {
            // Media3 already maps one audio track per wrapper. Never merge two
            // independent elementary streams into the same reserved queue.
            return output.track(trackId, type)
          }
          genuineTrackId = trackId
          genuineTrack = true
          // Same queue ID for placeholder and actual AAC, even if the MPEG PID changes.
          val real = queue ?: output.track(stableTrackId, C.TRACK_TYPE_AUDIO).also { queue = it }
          return real
        }
        if (type == C.TRACK_TYPE_VIDEO) {
          sawVideo = true
          // This is an explicitly declared AUDIO rendition, not the selected video
          // variant. Discard its redundant video output, but observe its timestamps.
          val sink = DiscardingTrackOutput()
          return object : TrackOutput by sink {
            override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int,
              cryptoData: TrackOutput.CryptoData?) {
              if (size > 0 && cryptoData == null && timeUs >= 0 && timeUs != C.TIME_UNSET) {
                count++
                first = minOf(first, timeUs)
                last = maxOf(last, timeUs)
              }
            }
          }
        }
        return output.track(trackId, type)
      }
      override fun endTracks() {
        if (!ended && sawVideo && !genuineTrack) {
          val target = queue ?: output.track(stableTrackId, C.TRACK_TYPE_AUDIO).also { queue = it }
          target.format(Format.Builder().setId("pluto-provisional-stereo")
            .setSampleMimeType("audio/mp4a-latm").setCodecs("mp4a.40.2")
            .setSampleRate(48000).setChannelCount(2)
            .setInitializationData(listOf(byteArrayOf(0x11, 0x90.toByte()))).build())
          reserved = true
          android.util.Log.i("BU23OF", "audio_queue_reserved_before_endTracks provisional_aac_lc_48k_stereo=true")
        }
        ended = true
        output.endTracks()
      }
    })
  }

  override fun read(input: ExtractorInput): Boolean {
    if (inputIdentity !== input) {
      inputIdentity = input
      resumed = input.position != 0L
      count = 0
      first = Long.MAX_VALUE
      last = Long.MIN_VALUE
      complete = false
    }
    val more = inner.read(input)
    if (!more && !complete) {
      complete = true
      if (reserved && !genuineTrack) {
        val times = bu23ofSilenceTimes(first, last, count, genuineTrack, true, resumed)
        val target = queue
        if (target != null && times.isNotEmpty()) {
          for (pts in times) {
            target.sampleData(ParsableByteArray(silence), silence.size)
            target.sampleMetadata(pts, C.BUFFER_FLAG_KEY_FRAME, silence.size, 0, null)
          }
          android.util.Log.i("BU23OF", "completed_video_only_audio_rendition silence_frames=${times.size} spanUs=${last-first}")
        } else android.util.Log.i("BU23OF", "silence_not_emitted timestamp_or_completion_gate")
      }
    }
    return more
  }
  override fun recreate(): HlsMediaChunkExtractor = Bu23ofStableAudioExtractor(inner.recreate())
}
