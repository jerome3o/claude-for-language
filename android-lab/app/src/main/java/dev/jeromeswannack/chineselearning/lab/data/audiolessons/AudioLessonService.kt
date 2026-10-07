package dev.jeromeswannack.chineselearning.lab.data.audiolessons

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.mp3.Mp3Extractor
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import dev.jeromeswannack.chineselearning.lab.MainActivity
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonChapter
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonMusic
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTimeline
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.io.File

/*
 * Audio lessons in the background (docs/AUDIO_LESSONS.md "The player"): the Lab app's player keeps
 * going with the screen off and the app closed. ExoPlayer inside a Media3 MediaSessionService — a
 * foreground media service with the notification / lock-screen controls (play / pause, ±10 s,
 * previous / next = chapters), headphone buttons, audio focus, "becoming noisy" (unplugged → pause)
 * and a partial wake lock. The sleep timer (fade the last 30 s, then pause; or the end of this
 * chapter) and the remembered position live HERE, in [AudioLessonEngine], not in the Compose screen,
 * so they keep working with the screen off.
 *
 * The screen talks to the engine in-process: it binds the service with a MediaController
 * ([AudioLessonPlayback.connect]) — that is what starts the service and lets Media3 promote it to the
 * foreground when playback starts — then drives [AudioLessonPlayback.engine] directly.
 */

/** What the player screen shows of the lesson loaded in the service. */
data class AudioLessonPlaybackState(
    val lessonId: String? = null,
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val speed: Double = 1.0,
    /** 0 = off, -1 = end of this chapter, else minutes. */
    val timerMinutes: Int = 0,
    /** SystemClock.elapsedRealtime() when a minutes timer ends. */
    val timerEndsAt: Long? = null,
    val ended: Boolean = false,
    /** True once the player knows the file (seekable). */
    val loaded: Boolean = false,
    /** The music bed under the lesson (docs/AUDIO_LESSONS.md "Music"): on / off for this lesson's format, and its volume. */
    val musicOn: Boolean = false,
    val musicVolume: Double = AudioLessonMusic.DEFAULT_VOLUME,
) {
    fun timerLeftMs(now: Long = SystemClock.elapsedRealtime()): Long = timerEndsAt?.let { (it - now).coerceAtLeast(0) } ?: 0
}

/** The process-wide handle on the running service's engine. */
object AudioLessonPlayback {
    private val _engine = MutableStateFlow<AudioLessonEngine?>(null)
    val engine: StateFlow<AudioLessonEngine?> = _engine.asStateFlow()

    internal fun attach(e: AudioLessonEngine) { _engine.value = e }
    internal fun detach(e: AudioLessonEngine) { if (_engine.value === e) _engine.value = null }

    /**
     * Binds the service (creating it, and with it the engine). Keep the returned controller while
     * the player screen is open and release it when it closes; playback carries on without it.
     */
    fun connect(context: Context): ListenableFuture<MediaController> =
        MediaController.Builder(context, SessionToken(context, ComponentName(context, AudioLessonService::class.java))).buildAsync()
}

/**
 * The player's previous / next are CHAPTERS (lock screen, notification, headphones): a lesson is one
 * media item, so the forwarding player advertises next / previous and turns them into chapter seeks
 * (previous within 3 s of a chapter's start → the chapter before, `previousChapterTarget`).
 */
@OptIn(UnstableApi::class)
class ChapterPlayer(private val exo: Player, private val chapters: () -> List<AudioLessonChapter>) : ForwardingSimpleBasePlayer(exo) {
    override fun getState(): State {
        val state = super.getState()
        if (state.playlist.isEmpty()) return state
        val commands = state.availableCommands.buildUpon()
            .addAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .build()
        return state.buildUpon().setAvailableCommands(commands).build()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val at = exo.currentPosition.toDouble()
        val target = when (seekCommand) {
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> AudioLessonTimeline.nextChapterTarget(chapters(), at) ?: return Futures.immediateVoidFuture()
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> AudioLessonTimeline.previousChapterTarget(chapters(), at)
            else -> return super.handleSeek(mediaItemIndex, positionMs, seekCommand)
        }
        exo.seekTo(target)
        return Futures.immediateVoidFuture()
    }
}

/** The lesson player: ExoPlayer + the music bed + the sleep timer + the remembered position + analytics. Main thread only. */
@OptIn(UnstableApi::class)
class AudioLessonEngine(private val context: Context, musicTrack: MusicTrack = ExoMusicTrack(context)) {
    private val prefs = AudioLessonPrefs(context)
    private val handler = Handler(Looper.getMainLooper())

    val exo: ExoPlayer = ExoPlayer.Builder(context)
        .setMediaSourceFactory(
            // Lesson MP3s mix 64 kbps speech with 8 kbps silence: index seeking lands exactly where the
            // chapter list / transcript says (a Xing TOC would be off by seconds), cheap for a local file.
            DefaultMediaSourceFactory(context, DefaultExtractorsFactory().setMp3ExtractorFlags(Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING)),
        )
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), /* handleAudioFocus = */ true)
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_LOCAL)
        .setSeekBackIncrementMs(10_000)
        .setSeekForwardIncrementMs(10_000)
        .build()

    private var lesson: AudioLessonDto? = null
    private var file: File? = null
    private var chapterShown = -1
    private var startedTracked = false
    private var lastSave = 0L

    val sessionPlayer = ChapterPlayer(exo) { lesson?.chapters.orEmpty() }

    /** The soft music under the lesson: plays while the lesson plays, fades with the sleep timer. */
    val music = LessonMusic(musicTrack).also { it.setVolume(prefs.musicVolume) }

    private val _state = MutableStateFlow(AudioLessonPlaybackState(speed = prefs.speed))
    val state: StateFlow<AudioLessonPlaybackState> = _state.asStateFlow()

    /** Set by the service: where a tap on the notification goes. */
    var onLessonChanged: (AudioLessonDto) -> Unit = {}

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _state.update { it.copy(playing = isPlaying, positionMs = exo.currentPosition) }
            music.update(isPlaying, musicFade())
            val l = lesson ?: return
            if (isPlaying) {
                if (!startedTracked) {
                    startedTracked = true
                    Analytics.track(
                        "audio_lesson.play",
                        mapOf("format" to l.format, "offline" to !online(), "resumed" to (exo.currentPosition > 1000)),
                    )
                }
            } else if (exo.playbackState != Player.STATE_ENDED) {
                savePosition()
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_READY -> _state.update { it.copy(loaded = true, durationMs = durationMs(), ended = false) }
                Player.STATE_ENDED -> {
                    val l = lesson ?: return
                    prefs.savePosition(l.id, 0)
                    _state.update { it.copy(playing = false, ended = true, timerMinutes = 0, timerEndsAt = null, positionMs = durationMs()) }
                    exo.volume = 1f
                    music.update(lessonPlaying = false)
                    Analytics.track("audio_lesson.complete", mapOf("format" to l.format, "duration_ms" to durationMs()))
                }
                else -> {}
            }
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            onTick()
            handler.postDelayed(this, TICK_MS)
        }
    }

    init {
        exo.addListener(listener)
        exo.playbackParameters = PlaybackParameters(prefs.speed.toFloat(), 1f)
        handler.post(tick)
    }

    private fun online(): Boolean = (context.applicationContext as? dev.jeromeswannack.chineselearning.lab.LabApp)?.online?.value ?: true

    private fun durationMs(): Long = lesson?.duration_ms?.takeIf { it > 0 } ?: exo.duration.takeIf { it != C.TIME_UNSET } ?: 0L

    /** Loads [l] from [f] (no-op when it is already loaded), at the remembered position. */
    fun load(l: AudioLessonDto, f: File) {
        if (lesson?.id == l.id && file == f) {
            lesson = l
            return
        }
        if (lesson != null) savePosition()
        lesson = l
        file = f
        chapterShown = -1
        startedTracked = false
        exo.setMediaItem(mediaItem(l, f, 0))
        exo.prepare()
        val duration = l.duration_ms ?: 0L
        val pos = prefs.position(l.id)
        if (pos > 0 && (duration == 0L || pos < duration - 5000)) exo.seekTo(pos)
        music.setOn(prefs.musicOn(l.format))
        _state.value = AudioLessonPlaybackState(
            lessonId = l.id,
            positionMs = exo.currentPosition,
            durationMs = duration,
            speed = prefs.speed,
            musicOn = music.on,
            musicVolume = music.volume,
        )
        onLessonChanged(l)
    }

    private fun mediaItem(l: AudioLessonDto, f: File, chapter: Int): MediaItem = MediaItem.Builder()
        .setMediaId(l.id)
        .setUri(Uri.fromFile(f))
        .setMimeType("audio/mpeg")
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(l.title)
                .setArtist(if (l.format == "sleep") "Sleep lesson" else "Audio lesson")
                .setAlbumTitle(l.chapters.getOrNull(chapter)?.title.orEmpty())
                .setDisplayTitle(l.title)
                .build(),
        )
        .build()

    fun toggle() = if (exo.isPlaying || exo.playWhenReady && exo.playbackState != Player.STATE_ENDED) pause() else play()

    fun play() {
        if (lesson == null) return
        if (exo.playbackState == Player.STATE_ENDED) exo.seekTo(0)
        if (exo.playbackState == Player.STATE_IDLE) exo.prepare()
        _state.update { it.copy(ended = false) }
        exo.play()
    }

    fun pause() {
        exo.pause()
        savePosition()
    }

    fun seekTo(ms: Long) {
        val d = durationMs()
        val to = if (d > 0) ms.coerceIn(0, d) else ms.coerceAtLeast(0)
        exo.seekTo(to)
        _state.update { it.copy(positionMs = to, ended = false) }
    }

    fun skip(deltaMs: Long) = seekTo(exo.currentPosition + deltaMs)

    fun nextChapter() {
        AudioLessonTimeline.nextChapterTarget(lesson?.chapters.orEmpty(), exo.currentPosition.toDouble())?.let { seekTo(it) }
    }

    fun previousChapter() = seekTo(AudioLessonTimeline.previousChapterTarget(lesson?.chapters.orEmpty(), exo.currentPosition.toDouble()))

    /** The speed chip: pitch kept (PlaybackParameters' pitch 1), remembered on the phone. */
    fun setSpeed(speed: Double) {
        prefs.speed = speed
        exo.playbackParameters = PlaybackParameters(speed.toFloat(), 1f)
        _state.update { it.copy(speed = speed) }
    }

    /** 🎵 on / off — remembered per format (on for sleep, off for dialogue until changed). */
    fun setMusicOn(on: Boolean) {
        val l = lesson ?: return
        prefs.setMusicOn(l.format, on)
        music.setOn(on)
        _state.update { it.copy(musicOn = on) }
        Analytics.track("audio_lesson.music", mapOf("on" to on, "format" to l.format, "volume_pct" to Math.round(music.volume * 100)))
    }

    /** The music's volume while the slider moves; [commit] (the finger lifted) remembers it. */
    fun setMusicVolume(volume: Double, commit: Boolean) {
        music.setVolume(volume)
        _state.update { it.copy(musicVolume = music.volume) }
        if (commit) {
            prefs.musicVolume = music.volume
            Analytics.track("audio_lesson.music", mapOf("on" to music.on, "format" to lesson?.format, "volume_pct" to Math.round(music.volume * 100)))
        }
    }

    /** The sleep timer's fade (1 when no minutes timer runs). */
    private fun musicFade(): Double {
        val ends = _state.value.timerEndsAt ?: return 1.0
        return AudioLessonTimeline.sleepFadeVolume((ends - SystemClock.elapsedRealtime()).toDouble())
    }

    /** 🌙: 0 = off, -1 = the end of this chapter, else minutes (the last 30 s fade out). */
    fun setSleepTimer(minutes: Int) {
        exo.volume = 1f
        _state.update { it.copy(timerMinutes = minutes, timerEndsAt = if (minutes > 0) SystemClock.elapsedRealtime() + minutes * 60_000L else null) }
        music.update(exo.isPlaying, musicFade())
        Analytics.track("audio_lesson.sleep_timer", mapOf("minutes" to minutes, "format" to lesson?.format))
    }

    private fun onTick() {
        val l = lesson ?: return
        val ms = exo.currentPosition
        val s = _state.value
        if (s.positionMs != ms || (s.durationMs == 0L && durationMs() > 0)) _state.update { it.copy(positionMs = ms, durationMs = durationMs()) }
        if (exo.isPlaying) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastSave > SAVE_EVERY_MS) {
                lastSave = now
                prefs.savePosition(l.id, ms)
            }
        }
        // The chapter on the lock screen / notification.
        val chapter = AudioLessonTimeline.chapterIndexAt(l.chapters, ms.toDouble())
        if (chapter != chapterShown && l.chapters.isNotEmpty()) {
            chapterShown = chapter
            file?.let { f -> if (exo.mediaItemCount > 0) exo.replaceMediaItem(0, mediaItem(l, f, chapter)) }
        }
        // The sleep timer (the web player's half-second interval, here in the service).
        if (s.timerMinutes == -1) {
            if (exo.isPlaying) {
                val next = AudioLessonTimeline.nextChapterTarget(l.chapters, ms.toDouble())
                if (next != null && ms >= next - 250) {
                    exo.pause()
                    savePosition()
                    _state.update { it.copy(timerMinutes = 0, timerEndsAt = null) }
                }
            }
        } else if (s.timerEndsAt != null) {
            val left = s.timerEndsAt - SystemClock.elapsedRealtime()
            val fade = AudioLessonTimeline.sleepFadeVolume(left.toDouble())
            exo.volume = fade.toFloat()
            music.update(exo.isPlaying, fade)
            if (left <= 0) {
                exo.pause()
                exo.volume = 1f
                savePosition()
                _state.update { it.copy(timerMinutes = 0, timerEndsAt = null) }
                music.update(lessonPlaying = false)
            }
        }
    }

    fun savePosition() {
        val l = lesson ?: return
        if (exo.playbackState == Player.STATE_ENDED) return
        prefs.savePosition(l.id, exo.currentPosition)
    }

    fun currentLessonId(): String? = lesson?.id

    fun release() {
        savePosition()
        handler.removeCallbacks(tick)
        exo.removeListener(listener)
        exo.release()
        music.release()
    }

    companion object {
        const val TICK_MS = 250L
        const val SAVE_EVERY_MS = 5000L
    }
}

/** The foreground media service (manifest: foregroundServiceType="mediaPlayback"). */
@OptIn(UnstableApi::class)
class AudioLessonService : MediaSessionService() {
    private var session: MediaSession? = null
    private var engine: AudioLessonEngine? = null

    override fun onCreate() {
        super.onCreate()
        val e = AudioLessonEngine(this)
        val s = MediaSession.Builder(this, e.sessionPlayer).setId("audio-lessons").build()
        e.onLessonChanged = { l -> s.setSessionActivity(openLesson(l.id)) }
        engine = e
        session = s
        AudioLessonPlayback.attach(e)
    }

    /** A tap on the notification / lock screen opens the lesson's player. */
    private fun openLesson(id: String): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(Intent.ACTION_VIEW, Uri.parse("chineselearning-lab:///audio-lessons/${Uri.encode(id)}"), this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        engine?.let { AudioLessonPlayback.detach(it); it.release() }
        session?.release()
        session = null
        engine = null
        super.onDestroy()
    }
}
