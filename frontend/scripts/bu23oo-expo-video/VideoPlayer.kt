package expo.modules.video.player

import android.content.Context
import android.media.MediaMetadataRetriever
import androidx.media3.common.C
import android.webkit.URLUtil
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Player.STATE_BUFFERING
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.sharedobjects.SharedObject
import expo.modules.video.IntervalUpdateClock
import expo.modules.video.IntervalUpdateEmitter
import expo.modules.video.VideoManager
import expo.modules.video.Bu23nrAudioEvidence
import expo.modules.video.Bu23nrRecoveryGate
import expo.modules.video.buildExpoVideoMediaSource
import expo.modules.video.delegates.IgnoreSameSet
import expo.modules.video.enums.AudioMixingMode
import expo.modules.video.enums.PlayerStatus
import expo.modules.video.enums.PlayerStatus.*
import expo.modules.video.getPlaybackServiceErrorMessage
import expo.modules.video.playbackService.ExpoVideoPlaybackService
import expo.modules.video.playbackService.PlaybackServiceConnection
import expo.modules.video.records.BufferOptions
import expo.modules.video.records.PlaybackError
import expo.modules.video.records.TimeUpdate
import expo.modules.video.records.VideoSource
import expo.modules.video.utils.MutableWeakReference
import expo.modules.video.records.VideoTrack
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import java.io.FileInputStream
import java.lang.ref.WeakReference

// https://developer.android.com/guide/topics/media/media3/getting-started/migration-guide#improvements_in_media3
@UnstableApi
class VideoPlayer(val context: Context, appContext: AppContext, source: VideoSource?) : AutoCloseable, SharedObject(appContext), IntervalUpdateEmitter {
  // This improves the performance of playing DRM-protected content
  private var renderersFactory = DefaultRenderersFactory(context)
    .forceEnableMediaCodecAsynchronousQueueing()
    .setEnableDecoderFallback(true)
  private var listeners: MutableList<WeakReference<VideoPlayerListener>> = mutableListOf()
  private var currentPlayerView = MutableWeakReference<PlayerView?>(null)
  val loadControl: VideoPlayerLoadControl = VideoPlayerLoadControl()
  val subtitles: VideoPlayerSubtitles = VideoPlayerSubtitles(this)
  val audioTracks: VideoPlayerAudioTracks = VideoPlayerAudioTracks(this)
  val trackSelector = DefaultTrackSelector(context)

  val player = ExoPlayer
    .Builder(context, renderersFactory)
    .setLooper(context.mainLooper)
    .setLoadControl(loadControl)
    .build()

  private val firstFrameEventGenerator = createFirstFrameEventGenerator()
  val serviceConnection = PlaybackServiceConnection(WeakReference(this), appContext)
  val intervalUpdateClock = IntervalUpdateClock(this)

  var hasRenderedAFrameOfVideoSource = false
  var playing by IgnoreSameSet(false) { new, old ->
    sendEvent(PlayerEvent.IsPlayingChanged(new, old))
  }

  var uncommittedSource: VideoSource? = source
  private var commitedSource by IgnoreSameSet<VideoSource?>(null) { new, old ->
    sendEvent(PlayerEvent.SourceChanged(new, old))
  }

  // Volume of the player if there was no mute applied.
  var userVolume = 1f
  var status: PlayerStatus = IDLE
  var requiresLinearPlayback = false
  var staysActiveInBackground = false
    set(value) {
      field = value
      if (value) {
        startPlaybackService()
      }
    }
  var preservesPitch = false
    set(preservesPitch) {
      field = preservesPitch
      playbackParameters = applyPitchCorrection(playbackParameters)
    }
  var showNowPlayingNotification = false
    set(value) {
      field = value
      serviceSetShowNotification(value)
    }
  var duration = 0f
  var isLive = false

  var volume: Float by IgnoreSameSet(1f) { new: Float, old: Float ->
    player.volume = if (muted) 0f else new
    userVolume = volume
    sendEvent(PlayerEvent.VolumeChanged(new, old))
  }

  var muted: Boolean by IgnoreSameSet(false) { new: Boolean, old: Boolean ->
    player.volume = if (new) 0f else userVolume
    sendEvent(PlayerEvent.MutedChanged(new, old))
  }

  var playbackParameters by IgnoreSameSet(
    PlaybackParameters.DEFAULT,
    propertyMapper = { applyPitchCorrection(it) }
  ) { new: PlaybackParameters, old: PlaybackParameters ->
    player.playbackParameters = new

    if (old.speed != new.speed) {
      sendEvent(PlayerEvent.PlaybackRateChanged(new.speed, old.speed))
    }
  }

  val currentOffsetFromLive: Float?
    get() {
      return if (player.currentLiveOffset == C.TIME_UNSET) {
        null
      } else {
        player.currentLiveOffset / 1000f
      }
    }

  val currentLiveTimestamp: Long?
    get() {
      val window = Timeline.Window()
      if (!player.currentTimeline.isEmpty) {
        player.currentTimeline.getWindow(player.currentMediaItemIndex, window)
      }
      if (window.windowStartTimeMs == C.TIME_UNSET) {
        return null
      }
      return window.windowStartTimeMs + player.currentPosition
    }

  var bufferOptions: BufferOptions = BufferOptions()
    set(value) {
      field = value
      loadControl.applyBufferOptions(value)
    }

  val bufferedPosition: Double
    get() {
      if (player.currentMediaItem == null) {
        return -1.0
      }
      if (player.playbackState == STATE_BUFFERING) {
        return 0.0
      }
      return player.bufferedPosition / 1000.0
    }

  var audioMixingMode: AudioMixingMode = AudioMixingMode.AUTO
    set(value) {
      val old = field
      field = value
      sendEvent(PlayerEvent.AudioMixingModeChanged(value, old))
    }

  var isLoadingNewSource = false
    private set

  var currentVideoTrack: VideoTrack? = null
    private set(value) {
      val old = field
      field = value
      sendEvent(PlayerEvent.VideoTrackChanged(value, old))
    }

  var availableVideoTracks: List<VideoTrack> = emptyList()
    private set

  var keepScreenOnWhilePlaying by VideoPlayerKeepAwake(this, appContext)

  private val playerListener = object : Player.Listener {
    override fun onIsPlayingChanged(isPlaying: Boolean) {
      this@VideoPlayer.playing = isPlaying
    }

    override fun onTracksChanged(tracks: Tracks) {
      if (bu23nhEligible && !bu23nhClosed) bu23nlReport("tracks_changed", tracks)
      val oldSubtitleTracks = ArrayList(subtitles.availableSubtitleTracks)
      val oldAudioTracks = ArrayList(audioTracks.availableAudioTracks)
      val oldCurrentTrack = subtitles.currentSubtitleTrack
      val oldCurrentAudioTrack = audioTracks.currentAudioTrack

      // Emit the tracks change event to update the subtitles
      sendEvent(PlayerEvent.TracksChanged(tracks))

      val newSubtitleTracks = subtitles.availableSubtitleTracks
      val newAudioTracks = audioTracks.availableAudioTracks
      val newCurrentSubtitleTrack = subtitles.currentSubtitleTrack
      val newCurrentAudioTrack = audioTracks.currentAudioTrack
      availableVideoTracks = tracks.toVideoTracks()

      if (isLoadingNewSource) {
        sendEvent(
          PlayerEvent.VideoSourceLoaded(
            commitedSource,
            this@VideoPlayer.player.duration / 1000.0,
            availableVideoTracks,
            newSubtitleTracks,
            newAudioTracks
          )
        )
        isLoadingNewSource = false
      }

      if (!oldSubtitleTracks.toArray().contentEquals(newSubtitleTracks.toArray())) {
        sendEvent(PlayerEvent.AvailableSubtitleTracksChanged(newSubtitleTracks, oldSubtitleTracks))
      }
      if (!oldAudioTracks.toArray().contentEquals(newAudioTracks.toArray())) {
        sendEvent(PlayerEvent.AvailableAudioTracksChanged(newAudioTracks, oldAudioTracks))
      }
      if (oldCurrentTrack != newCurrentSubtitleTrack) {
        sendEvent(PlayerEvent.SubtitleTrackChanged(newCurrentSubtitleTrack, oldCurrentTrack))
      }
      if (oldCurrentAudioTrack != newCurrentAudioTrack) {
        sendEvent(PlayerEvent.AudioTrackChanged(newCurrentAudioTrack, oldCurrentAudioTrack))
      }
      super.onTracksChanged(tracks)
    }

    override fun onTrackSelectionParametersChanged(parameters: TrackSelectionParameters) {
      val oldTrack = subtitles.currentSubtitleTrack
      val oldAudioTrack = audioTracks.currentAudioTrack
      sendEvent(PlayerEvent.TrackSelectionParametersChanged(parameters))

      val newTrack = subtitles.currentSubtitleTrack
      val newAudioTrack = audioTracks.currentAudioTrack
      sendEvent(PlayerEvent.SubtitleTrackChanged(newTrack, oldTrack))
      sendEvent(PlayerEvent.AudioTrackChanged(newAudioTrack, oldAudioTrack))
      super.onTrackSelectionParametersChanged(parameters)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) {
        sendEvent(PlayerEvent.PlayedToEnd())
      } else {
        // New playback info is set in the onPlaybackStateChanged event, which occurs after mediaItemTransition.
        // The onPlaybackStateChanged is not triggered if the video repeats (since the state remains STATE_READY)
        // That is why the playback info is not reset when the transition reason is MEDIA_ITEM_TRANSITION_REASON_REPEAT.
        resetPlaybackInfo()
      }
      subtitles.setSubtitlesEnabled(false)
      hasRenderedAFrameOfVideoSource = false
      super.onMediaItemTransition(mediaItem, reason)
    }

    override fun onPlaybackStateChanged(@Player.State playbackState: Int) {
      if (playbackState == Player.STATE_IDLE && player.playerError != null) {
        return
      }
      if (playbackState == Player.STATE_READY) {
        refreshPlaybackInfo()
      }
      setStatus(playerStateToPlayerStatus(playbackState), null)
      super.onPlaybackStateChanged(playbackState)
    }

    override fun onVolumeChanged(volume: Float) {
      if (!muted) {
        this@VideoPlayer.volume = volume
      }
    }

    override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
      this@VideoPlayer.playbackParameters = playbackParameters
      super.onPlaybackParametersChanged(playbackParameters)
    }

    override fun onPlayerErrorChanged(error: PlaybackException?) {
      error?.let {
        resetPlaybackInfo()
        setStatus(ERROR, error)
      } ?: run {
        setStatus(playerStateToPlayerStatus(player.playbackState), null)
      }

      super.onPlayerErrorChanged(error)
    }
  }

  // BU23NH: recover only a confirmed Pluto video-output stall after an audio discontinuity.
  private val bu23nhHandler = android.os.Handler(context.mainLooper)
  private var bu23nhClosed = false
  private var bu23nhEligible = false
  private var bu23nhUsed = false
  private var bu23nhDeadline = 0L
  private var bu23nhLastFrames = -1
  private var bu23nhLastProgress = 0L
  private var bu23noUsed = false
  private var bu23noFrames = -1
  private var bu23noFrameSince = 0L
  private var bu23noOutsideSince = 0L
  private var bu23noAttemptAt = 0L
  private var bu23noAttemptFrames = -1
  private var bu23nlLastState = ""
  private var bu23nlLastLog = 0L
  private var bu23nrEvidence: Bu23nrAudioEvidence? = null
  private var bu23nrGate = Bu23nrRecoveryGate()

  // BU23NL: passive observation of the actual selected HLS source, not a second request.
  private fun bu23nlReport(reason: String, tracks: Tracks = player.currentTracks) {
    if (bu23nhClosed || !bu23nhEligible) return
    val groups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
    val count = groups.sumOf { it.length }
    val supported = groups.sumOf { group -> (0 until group.length).count { group.isTrackSupported(it) } }
    val selected = groups.sumOf { group -> (0 until group.length).count { group.isTrackSelected(it) } }
    val manifest = player.currentManifest as? androidx.media3.exoplayer.hls.HlsManifest
    val audioRenditions = manifest?.multivariantPlaylist?.audios?.size ?: -1
    val variants = manifest?.multivariantPlaylist?.variants?.size ?: -1
    val muxed = manifest?.multivariantPlaylist?.muxedAudioFormat != null
    val counters = player.videoDecoderCounters
    counters?.ensureUpdated()
    val frames = counters?.renderedOutputBufferCount ?: -1
    val state = "audioGroups=${groups.size} audioTracks=$count supported=$supported selected=$selected " +
      "manifestAudio=$audioRenditions variants=$variants muxedAudio=$muxed " +
      "audioDisabled=${player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO)} " +
      "live=${player.isCurrentMediaItemLive} seekable=${player.isCurrentMediaItemSeekable} " +
      "state=${player.playbackState} playWhenReady=${player.playWhenReady}"
    val now = android.os.SystemClock.elapsedRealtime()
    val watch = bu23nhDeadline > now && !bu23nhUsed
    if (reason == "tracks_changed" || state != bu23nlLastState ||
      ((count == 0 || watch) && now - bu23nlLastLog >= 5000L)) {
      android.util.Log.i("BU23NL", "$reason $state frames=$frames position=${player.currentPosition} buffered=${player.bufferedPosition} duration=${player.duration} seekCommand=${player.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)}")
      bu23nlLastState = state
      bu23nlLastLog = now
    }
  }

  private val bu23nlSample = object : Runnable {
    override fun run() {
      if (bu23nhClosed || !bu23nhEligible) return
      bu23nlReport("sample")
      bu23nhHandler.postDelayed(this, 5000L)
    }
  }

  private fun bu23nhReset(source: VideoSource?) {
    bu23nhHandler.removeCallbacksAndMessages(null)
    bu23nhUsed = false
    bu23nhDeadline = 0L
    bu23nhLastFrames = -1
    bu23noUsed = false
    bu23noFrames = -1
    bu23noFrameSince = 0L
    bu23noOutsideSince = 0L
    bu23noAttemptAt = 0L
    bu23noAttemptFrames = -1
    val uri = source?.uri
    val host = uri?.host?.lowercase(java.util.Locale.ROOT) ?: ""
    bu23nhEligible = (uri?.scheme == "https" || uri?.scheme == "http") &&
      (host == "pluto.tv" || host.endsWith(".pluto.tv") ||
        (host == "api.privastreamsolutions.com" && uri?.path == "/api/live/pluto/master.m3u8"))
    bu23nlLastState = ""
    bu23nlLastLog = 0L
    if (bu23nhEligible) {
      android.util.Log.i("BU23NH", "pluto_source_eligible=true")
      bu23nhHandler.postDelayed(bu23nlSample, 1000L)
      bu23nhHandler.postDelayed(bu23noCheck, 1000L)
      bu23nhHandler.postDelayed(bu23nrCheck, 1000L)
      android.util.Log.i("BU23NO", "outside_window_watch_enabled")
    }
  }

  // BU23NR: recover late audio track discovery, not absent source audio.
  // New HLS MediaPeriod required; seeking an existing period cannot rebuild its track groups.
  private val bu23nrCheck = object : Runnable {
    override fun run() {
      if (bu23nhClosed || !bu23nhEligible || bu23nrGate.used) return
      val evidence = bu23nrEvidence
      val source = commitedSource
      val now = android.os.SystemClock.elapsedRealtime()
      val missing = evidence != null && source != null && source.uri != null && source.drm == null &&
        uncommittedSource == null && !isLoadingNewSource &&
        player.currentMediaItem?.localConfiguration?.uri == source.uri &&
        player.isCurrentMediaItemLive && player.playbackState == Player.STATE_READY &&
        player.isPlaying && player.playWhenReady && !muted && player.volume > 0f &&
        !player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO) &&
        player.currentTracks.groups.none { it.type == C.TRACK_TYPE_AUDIO }
      val last = evidence?.lastSampleMs ?: -1L
      if (bu23nrGate.shouldReprepare(now, missing, last) && source != null) {
        try {
          val freshEvidence = Bu23nrAudioEvidence()
          val freshSource = buildExpoVideoMediaSource(context, source, freshEvidence)
          android.util.Log.w("BU23NR", "confirmed_late_aac_no_tracks action=reprepare_same_url_at_live_default sampleAgeMs=${now - last}")
          bu23nrEvidence = freshEvidence
          // Reset the existing freeze monitors, but retain the used audio gate.
          // No JS source resolution, no new app-level channel/session request.
          bu23nhReset(source)
          player.setMediaSource(freshSource, true)
          player.prepare()
          android.util.Log.i("BU23NR", "reprepare_requested one_attempt_per_source=true")
        } catch (e: Exception) {
          android.util.Log.e("BU23NR", "reprepare_failed type=${e.javaClass.simpleName}")
        }
        return
      }
      bu23nhHandler.postDelayed(this, 1000L)
    }
  }

  // BU23NO: independent of audio-sink errors. Only recover a stalled Pluto HLS
  // player whose playback position has fallen outside its moving live window.
  private val bu23noCheck = object : Runnable {
    override fun run() {
      if (bu23nhClosed || !bu23nhEligible) return
      val now = android.os.SystemClock.elapsedRealtime()
      val counters = player.videoDecoderCounters
      counters?.ensureUpdated()
      val frames = counters?.renderedOutputBufferCount ?: -1
      val position = player.currentPosition
      val active = player.playWhenReady && player.playerError == null &&
        player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE &&
        (player.playbackState == Player.STATE_READY || player.playbackState == Player.STATE_BUFFERING) &&
        player.isCurrentMediaItemLive && player.isCurrentMediaItemSeekable &&
        player.currentManifest is androidx.media3.exoplayer.hls.HlsManifest &&
        player.duration > 0L && currentPlayerView.get()?.player === player &&
        player.isCommandAvailable(Player.COMMAND_SEEK_TO_DEFAULT_POSITION)
      if (bu23noAttemptAt > 0L && now - bu23noAttemptAt >= 15000L) {
        android.util.Log.i("BU23NO", "post_seek_observation frames=$frames previousFrames=$bu23noAttemptFrames position=$position state=${player.playbackState}")
        bu23noAttemptAt = 0L
      }
      if (!active || frames <= 0) {
        bu23noFrames = -1
        bu23noFrameSince = 0L
        bu23noOutsideSince = 0L
      } else {
        if (frames != bu23noFrames || bu23noFrameSince == 0L) {
          bu23noFrames = frames
          bu23noFrameSince = now
        }
        if (position > -5000L) {
          bu23noOutsideSince = 0L
        } else if (bu23noOutsideSince == 0L) {
          bu23noOutsideSince = now
          android.util.Log.i("BU23NO", "outside_window position=$position frames=$frames")
        }
        if (!bu23noUsed && bu23noOutsideSince > 0L &&
          now - bu23noOutsideSince >= 2000L && now - bu23noFrameSince >= 8000L) {
          bu23noUsed = true
          bu23nhUsed = true
          bu23nhHandler.removeCallbacks(bu23nhCheck)
          bu23noAttemptAt = now
          bu23noAttemptFrames = frames
          android.util.Log.w("BU23NO", "confirmed_outside_window_stall action=seek_default_position frames=$frames position=$position buffered=${player.bufferedPosition} stallMs=${now - bu23noFrameSince}")
          try {
            // No new MediaItem, URL resolution, or player re-creation.
            player.seekToDefaultPosition()
          } catch (error: Exception) {
            android.util.Log.w("BU23NO", "seek_failed type=" + error.javaClass.simpleName)
          }
        }
      }
      bu23nhHandler.postDelayed(this, 1000L)
    }
  }

  private val bu23nhCheck = object : Runnable {
    override fun run() {
      val now = android.os.SystemClock.elapsedRealtime()
      if (bu23nhClosed || !bu23nhEligible || bu23nhUsed || now >= bu23nhDeadline) return
      if (!player.playWhenReady || !player.isCurrentMediaItemLive ||
        player.playerError != null || player.playbackState == Player.STATE_IDLE ||
        player.playbackState == Player.STATE_ENDED) {
        bu23nhLastFrames = -1
        bu23nhLastProgress = now
      } else {
        val counters = player.videoDecoderCounters
        counters?.ensureUpdated()
        val frames = counters?.renderedOutputBufferCount ?: -1
        if (frames <= 0 || frames != bu23nhLastFrames) {
          bu23nhLastFrames = frames
          bu23nhLastProgress = now
        } else if (now - bu23nhLastProgress >= 8000L &&
          player.isCurrentMediaItemSeekable &&
          player.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)) {
          // Retain the same MediaItem and ad session. Never fetch a new stream URL.
          // Move slightly forward rather than resetting to the start of a rolling window.
          val position = player.currentPosition
          val duration = player.duration
          val target = position + 500L
          if (position >= 0 && duration != C.TIME_UNSET && target < duration &&
            target <= player.bufferedPosition) {
            bu23nhUsed = true
            android.util.Log.w("BU23NH", "confirmed_frame_stall action=same_source_seek deltaMs=500")
            try {
              player.seekTo(target)
            } catch (error: Exception) {
              android.util.Log.w("BU23NH", "seek_failed type=" + error.javaClass.simpleName)
            }
            return
          }
        }
      }
      bu23nhHandler.postDelayed(this, 1000L)
    }
  }

  private fun bu23nlLoad(kind: String, info: androidx.media3.exoplayer.source.LoadEventInfo,
    data: androidx.media3.exoplayer.source.MediaLoadData) {
    if (bu23nhClosed || !bu23nhEligible) return
    val manifest = player.currentManifest as? androidx.media3.exoplayer.hls.HlsManifest
    val isAudioPlaylist = manifest?.multivariantPlaylist?.audios?.any {
      it.url == info.uri || it.url == info.dataSpec.uri
    } == true
    if (data.trackType == C.TRACK_TYPE_AUDIO || isAudioPlaylist ||
      data.dataType == C.DATA_TYPE_MANIFEST || kind.startsWith("error")) {
      android.util.Log.i("BU23NL", "load=$kind id=${info.loadTaskId} type=${data.dataType} track=${data.trackType} audioPlaylist=$isAudioPlaylist bytes=${info.bytesLoaded} durationMs=${info.loadDurationMs}")
    }
  }

  private val analyticsListener = object : AnalyticsListener {
    override fun onLoadCompleted(eventTime: AnalyticsListener.EventTime,
      loadEventInfo: androidx.media3.exoplayer.source.LoadEventInfo,
      mediaLoadData: androidx.media3.exoplayer.source.MediaLoadData) {
      bu23nlLoad("completed", loadEventInfo, mediaLoadData)
    }
    override fun onLoadCanceled(eventTime: AnalyticsListener.EventTime,
      loadEventInfo: androidx.media3.exoplayer.source.LoadEventInfo,
      mediaLoadData: androidx.media3.exoplayer.source.MediaLoadData) {
      bu23nlLoad("canceled", loadEventInfo, mediaLoadData)
    }
    override fun onLoadError(eventTime: AnalyticsListener.EventTime,
      loadEventInfo: androidx.media3.exoplayer.source.LoadEventInfo,
      mediaLoadData: androidx.media3.exoplayer.source.MediaLoadData,
      error: java.io.IOException, wasCanceled: Boolean) {
      bu23nlLoad("error_" + error.javaClass.simpleName + "_canceled=" + wasCanceled, loadEventInfo, mediaLoadData)
    }
    override fun onAudioSinkError(eventTime: AnalyticsListener.EventTime, audioSinkError: Exception) {
      if (bu23nhClosed || !bu23nhEligible || bu23nhUsed ||
        audioSinkError !is androidx.media3.exoplayer.audio.AudioSink.UnexpectedDiscontinuityException) return
      if (bu23nhDeadline > android.os.SystemClock.elapsedRealtime()) return
      val now = android.os.SystemClock.elapsedRealtime()
      bu23nhDeadline = now + 240000L
      bu23nhLastFrames = -1
      bu23nhLastProgress = now
      android.util.Log.w("BU23NH", "audio_discontinuity observed; monitoring_video_output")
      bu23nhHandler.removeCallbacks(bu23nhCheck)
      bu23nhHandler.post(bu23nhCheck)
    }

    override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
      currentVideoTrack = availableVideoTracks.firstOrNull { it.format?.id == format.id }
      super.onVideoInputFormatChanged(eventTime, format, decoderReuseEvaluation)
    }
  }

  init {
    player.addListener(playerListener)
    player.addAnalyticsListener(analyticsListener)
    VideoManager.registerVideoPlayer(this)

    // ExoPlayer will enable subtitles automatically at the start, we want them disabled by default
    appContext.mainQueue.launch {
      subtitles.setSubtitlesEnabled(false)
    }
  }

  @kotlin.OptIn(DelicateCoroutinesApi::class)
  override fun close() {
    bu23nhClosed = true
    bu23nrEvidence = null
    bu23nhHandler.removeCallbacksAndMessages(null)
    if (serviceConnection.isConnected) {
      appContext?.reactContext?.unbindService(serviceConnection)
    }
    serviceConnection.playbackServiceBinder?.service?.unregisterPlayer(player)
    VideoManager.unregisterVideoPlayer(this@VideoPlayer)

    // Run on global scope (not appContext.mainQueue) so that reloading doesn't cancel the release process
    // https://github.com/expo/expo/blob/cdf592a7fea56fc01b0149e9b2e5dbd294bcdc4c/packages/expo-modules-core/android/src/main/java/expo/modules/kotlin/AppContext.kt#L277-L279
    GlobalScope.launch(Dispatchers.Main) {
      player.removeListener(playerListener)
      player.release()
    }
    uncommittedSource = null
    commitedSource = null
    // Releases the listeners from VideoPlayerKeepAwake
    keepScreenOnWhilePlaying = false
  }

  override fun sharedObjectDidRelease() {
    super.sharedObjectDidRelease()
    close()
  }

  /**
   * Used to notify the player that is has been disconnected from the player view by another player.
   */
  fun hasBeenDisconnectedFromPlayerView() {
    if (currentPlayerView.get()?.player == this.player) {
      throw IllegalStateException("The player has been notified of disconnection from the player view, even though it's still connected.")
    }
    currentPlayerView.set(null)
  }

  fun changePlayerView(playerView: PlayerView?) {
    PlayerView.switchTargetView(player, currentPlayerView.get(), playerView)
    currentPlayerView.set(playerView)
  }

  fun prepare() {
    availableVideoTracks = listOf()
    currentVideoTrack = null

    val newSource = uncommittedSource
    bu23nrGate = Bu23nrRecoveryGate()
    bu23nrEvidence = null
    bu23nhReset(newSource)
    val mediaSource = newSource?.let { next ->
      if (bu23nhEligible && next.uri != null && next.drm == null) {
        val evidence = Bu23nrAudioEvidence()
        bu23nrEvidence = evidence
        buildExpoVideoMediaSource(context, next, evidence)
      } else {
        next.toMediaSource(context)
      }
    }

    mediaSource?.let {
      player.setMediaSource(it)
      player.prepare()
      commitedSource = newSource
      uncommittedSource = null
      isLoadingNewSource = true
    } ?: run {
      player.clearMediaItems()
      player.prepare()
      isLoadingNewSource = false
    }
  }

  private fun applyPitchCorrection(playbackParameters: PlaybackParameters): PlaybackParameters {
    val speed = playbackParameters.speed
    val pitch = if (preservesPitch) 1f else speed
    return PlaybackParameters(speed, pitch)
  }

  private fun playerStateToPlayerStatus(@Player.State state: Int): PlayerStatus {
    return when (state) {
      Player.STATE_IDLE -> IDLE
      Player.STATE_BUFFERING -> LOADING
      Player.STATE_READY -> READY_TO_PLAY
      Player.STATE_ENDED -> {
        // When an error occurs, the player state changes to ENDED.
        if (player.playerError != null) {
          ERROR
        } else {
          IDLE
        }
      }

      else -> IDLE
    }
  }

  private fun setStatus(status: PlayerStatus, error: PlaybackException?) {
    val oldStatus = this.status
    this.status = status

    val playbackError = error?.let {
      PlaybackError(it)
    }

    if (playbackError == null && player.playbackState == Player.STATE_ENDED) {
      sendEvent(PlayerEvent.PlayedToEnd())
    }

    if (this.status != oldStatus) {
      sendEvent(PlayerEvent.StatusChanged(status, oldStatus, playbackError))
    }
  }

  private fun refreshPlaybackInfo() {
    duration = player.duration / 1000f
    isLive = player.isCurrentMediaItemLive
  }

  private fun resetPlaybackInfo() {
    duration = 0f
    isLive = false
  }

  private fun startPlaybackService(): Boolean {
    if (serviceConnection.playbackServiceBinder?.service != null) {
      // PlaybackService already running.
      return true
    }
    val appContext = appContext ?: throw Exceptions.AppContextLost()
    val serviceStarted = ExpoVideoPlaybackService.startService(appContext, context, serviceConnection)

    if (!serviceStarted) {
      appContext.jsLogger?.error(
        getPlaybackServiceErrorMessage("Expo-video has failed to bind with the playback service binder")
      )
    }
    return serviceStarted
  }

  private fun serviceSetShowNotification(showNotification: Boolean) {
    if (showNotification) {
      startPlaybackService()
    }
    serviceConnection.playbackServiceBinder?.service?.setShowNotification(showNotification, this.player)
  }

  fun addListener(videoPlayerListener: VideoPlayerListener) {
    if (listeners.all { it.get() != videoPlayerListener }) {
      listeners.add(WeakReference(videoPlayerListener))
    }
  }

  fun removeListener(videoPlayerListener: VideoPlayerListener) {
    listeners.removeAll { it.get() == videoPlayerListener }
  }

  private fun sendEvent(event: PlayerEvent) {
    // Emits to the native listeners
    val listenersSnapshot = listeners.toList().mapNotNull { it.get() }

    event.emit(this, listenersSnapshot)

    // Emits to the JS side
    if (event.emitToJS) {
      emit(event.name, event.jsEventPayload)
    }
  }

  private fun createFirstFrameEventGenerator(): FirstFrameEventGenerator {
    return FirstFrameEventGenerator(player, currentPlayerView) {
      hasRenderedAFrameOfVideoSource = true
      sendEvent(PlayerEvent.RenderedFirstFrame())
    }
  }

  // IntervalUpdateEmitter
  override fun emitTimeUpdate() {
    appContext?.mainQueue?.launch {
      val updatePayload = TimeUpdate(player.currentPosition / 1000.0, currentOffsetFromLive, currentLiveTimestamp, bufferedPosition)
      sendEvent(PlayerEvent.TimeUpdated(updatePayload))
    }
  }

  fun toMetadataRetriever(): MediaMetadataRetriever {
    val source = uncommittedSource ?: commitedSource
    val uri = source?.uri ?: throw IllegalStateException("Video source is not set")
    val stringUri = uri.toString()

    val mediaMetadataRetriever = MediaMetadataRetriever()
    if (URLUtil.isFileUrl(stringUri)) {
      mediaMetadataRetriever.setDataSource(stringUri.replace("file://", ""))
    } else if (URLUtil.isContentUrl(stringUri)) {
      context.contentResolver.openFileDescriptor(uri, "r")?.use { parcelFileDescriptor ->
        FileInputStream(parcelFileDescriptor.fileDescriptor).use { inputStream ->
          mediaMetadataRetriever.setDataSource(inputStream.fd)
        }
      }
    } else {
      mediaMetadataRetriever.setDataSource(stringUri, source.headers ?: emptyMap())
    }
    return mediaMetadataRetriever
  }
}

// Extension functions

@OptIn(UnstableApi::class)
private fun Tracks.toVideoTracks(): List<VideoTrack> {
  val videoTracks = mutableListOf<VideoTrack?>()
  for (group in this.groups) {
    for (i in 0 until group.length) {
      val format = group.getTrackFormat(i)
      val isSupported = group.isTrackSupported(i)

      if (!MimeTypes.isVideo(format.sampleMimeType)) {
        continue
      }
      videoTracks.add(VideoTrack.fromFormat(format, isSupported))
    }
  }
  return videoTracks.filterNotNull()
}
