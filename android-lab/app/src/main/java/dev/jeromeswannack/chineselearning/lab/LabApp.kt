package dev.jeromeswannack.chineselearning.lab

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.DebugReporter
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.Repository
import dev.jeromeswannack.chineselearning.lab.data.SyncWorker
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSyncs
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.serialization.serializer
import dev.jeromeswannack.chineselearning.lab.fx.Haptics
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.fx.WordAudio
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The app's singletons (no DI framework — the graph is small). A WorkManager
 * [androidx.work.Configuration.Provider], so WorkManager can also start on demand (Robolectric
 * tests of the study session run the real app, which schedules its upload / hourly workers).
 */
class LabApp : Application(), androidx.work.Configuration.Provider {
    override val workManagerConfiguration: androidx.work.Configuration
        get() = androidx.work.Configuration.Builder().build()

    lateinit var prefs: Prefs
    lateinit var repo: Repository
    lateinit var sounds: Sounds
    lateinit var haptics: Haptics
    lateinit var audio: WordAudio
    lateinit var debugReports: DebugReporter
    /** Auto-audio: missing / broken clips made on the card, queued offline, backfilled after sync (data/audio/). */
    lateinit var noteAudio: dev.jeromeswannack.chineselearning.lab.data.audio.NoteAudioFixer
    /**
     * App-wide background work (sync follow-ups, widget refresh, audio fixer, debug reports…).
     * A failure in one of those jobs is recorded (CrashLog) and logged — it must never take
     * the whole app down at start-up.
     */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + kotlinx.coroutines.CoroutineExceptionHandler { _, e ->
        android.util.Log.e("LabApp", "background job failed", e)
        dev.jeromeswannack.chineselearning.lab.data.CrashLog.recordNonFatal(this, appVersionOrNull() ?: "unknown", e)
    })

    /** Offline store for feature data (data/platform/JsonCache.kt). */
    val cache: JsonCache get() = repo.platform.cache

    /** Offline writes, replayed in order during sync (data/platform/Outbox.kt). */
    val outbox: Outbox get() = repo.platform.outbox

    /**
     * Cache-first server data for a ViewModel (data/platform/CachedResource.kt):
     *   val readers = app.cachedResource<List<ReaderDto>>(viewModelScope, "readers/list", "readers") { readers() }
     */
    inline fun <reified T> cachedResource(scope: CoroutineScope, key: String, kind: String, maxAgeMs: Long = 0, noinline fetch: suspend Api.() -> T): CachedResource<T> =
        CachedResource(scope, cache, key, kind, cache.json.serializersModule.serializer<T>(), maxAgeMs, online = { online.value }) { repo.api.fetch() }

    private val _online = MutableStateFlow(true)
    val online: StateFlow<Boolean> = _online

    override fun onCreate() {
        super.onCreate()
        // First: a crash anywhere after this line is written down and reported (data/CrashLog.kt).
        // The handler POSTs the trace before the process dies; the last run's crash files and the
        // system's exit records (ANR thread dumps included) go up through a WorkManager job
        // (CrashUploadWorker: network constraint, retries with backoff); a watchdog reports a
        // frozen main thread (an ANR has no exception) — all before any UI.
        val version = appVersion()
        runCatching { dev.jeromeswannack.chineselearning.lab.data.CrashLog.install(this, version) }
        runCatching { dev.jeromeswannack.chineselearning.lab.data.CrashLog.uploadInBackground(this, version) }
        runCatching { dev.jeromeswannack.chineselearning.lab.data.CrashLog.startFreezeWatchdog(this, version) }
        prefs = Prefs(this)
        repo = Repository(this, LabDatabase.open(this), Api(tokenProvider = { prefs.sessionToken }), prefs)
        sounds = Sounds(this) { prefs.soundOn }
        haptics = Haptics(this) { prefs.hapticsOn }
        audio = WordAudio(this, repo)
        noteAudio = dev.jeromeswannack.chineselearning.lab.data.audio.NoteAudioFixer(repo, online = {
            online.value && !dev.jeromeswannack.chineselearning.lab.data.settings.SettingsStore.forcedOffline(this)
        })
        dev.jeromeswannack.chineselearning.lab.data.audio.NoteAudioFixer.current = noteAudio
        FeatureSyncs.registerAll(repo.platform)
        debugReports = DebugReporter(this, repo, appVersion())
        watchNetwork()
        uploadDebugReportsAfterSync()
        reportLastCrash()
        dev.jeromeswannack.chineselearning.lab.shell.Shell.install(this) // widget, notifications (package I)
    }

    private fun appVersion(): String = appVersionOrNull() ?: "unknown"

    private fun appVersionOrNull(): String? = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull()

    /** Study-state debug report (data/DebugReport.kt) after each successful sync, every 30 min at most. */
    private fun uploadDebugReportsAfterSync() {
        var seen = repo.status.value.lastSyncAt
        scope.launch {
            repo.status.collect { s ->
                if (!s.running && s.error == null && s.lastSyncAt > seen) {
                    seen = s.lastSyncAt
                    debugReports.sendIfDue()
                }
            }
        }
    }

    /**
     * Runs non-critical work (start-up loads, refreshes, syncs started from the UI) so that a
     * failure — any Throwable — is logged and reported (CrashLog) instead of crashing the app.
     * Returns null when [block] failed. Cancellation still propagates.
     */
    suspend fun <T> safely(what: String, block: suspend () -> T): T? = try {
        block()
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Throwable) {
        android.util.Log.e("LabApp", "$what failed", e)
        dev.jeromeswannack.chineselearning.lab.data.CrashLog.recordNonFatal(this, appVersion(), e)
        null
    }

    /** A crash recorded by the last run goes up soon after start, not at the next 30-min window. */
    private fun reportLastCrash() {
        if (!dev.jeromeswannack.chineselearning.lab.data.CrashLog.hasPendingUncaught(this)) return
        scope.launch {
            kotlinx.coroutines.delay(15_000)
            if (online.value) runCatching { debugReports.sendIfDue() }
        }
    }

    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java)
        _online.value = cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        cm.registerNetworkCallback(
            NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
            object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    val was = _online.value
                    _online.value = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                    // Back online on the train: flush reviews and pull changes.
                    if (!was && _online.value) scope.launch { repo.sync() }
                }

                override fun onLost(network: Network) {
                    _online.value = cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
                }
            },
        )
    }

    /** Incoming video calls: the banner's live list, the ring, background checks (data/calls/CallAlertsWatcher.kt). */
    val callAlerts by lazy { dev.jeromeswannack.chineselearning.lab.data.calls.CallAlertsWatcher(this) }

    /** Reviews made offline still reach the server after the app is closed. */
    fun scheduleBackgroundUpload() = SyncWorker.enqueue(this)
}
