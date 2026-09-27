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

/** The app's singletons (no DI framework — the graph is small). */
class LabApp : Application() {
    lateinit var prefs: Prefs
    lateinit var repo: Repository
    lateinit var sounds: Sounds
    lateinit var haptics: Haptics
    lateinit var audio: WordAudio
    lateinit var debugReports: DebugReporter
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

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
        prefs = Prefs(this)
        repo = Repository(this, LabDatabase.open(this), Api(tokenProvider = { prefs.sessionToken }), prefs)
        sounds = Sounds(this) { prefs.soundOn }
        haptics = Haptics(this) { prefs.hapticsOn }
        audio = WordAudio(this, repo)
        FeatureSyncs.registerAll(repo.platform)
        debugReports = DebugReporter(this, repo, appVersion())
        watchNetwork()
        uploadDebugReportsAfterSync()
        dev.jeromeswannack.chineselearning.lab.shell.Shell.install(this) // widget, notifications (package I)
    }

    private fun appVersion(): String =
        runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "unknown"

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

    /** Reviews made offline still reach the server after the app is closed. */
    fun scheduleBackgroundUpload() = SyncWorker.enqueue(this)
}
