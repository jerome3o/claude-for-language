package dev.jeromeswannack.chineselearning.lab.core

/** Port of `resolveOfflineMode` (frontend/src/services/offlineMode.ts): automatic from the connection, or forced. */
enum class OfflineModeState { AUTO_ONLINE, AUTO_OFFLINE, FORCED_OFFLINE }

data class ResolvedOfflineMode(val state: OfflineModeState, val effectiveOffline: Boolean, val label: String, val description: String)

object OfflineMode {
    /** Forced wins over "online"; with no connection we're offline either way. */
    fun resolve(forced: Boolean, isOnline: Boolean): ResolvedOfflineMode = when {
        forced -> ResolvedOfflineMode(
            OfflineModeState.FORCED_OFFLINE, true, "Forced offline",
            "Forced offline: audio plays from cache or device TTS, AI features are off. Tap to go back to automatic.",
        )
        !isOnline -> ResolvedOfflineMode(
            OfflineModeState.AUTO_OFFLINE, true, "Auto · offline",
            "No connection: audio plays from cache or device TTS, AI features are off. Tap to force offline even when a connection comes back.",
        )
        else -> ResolvedOfflineMode(
            OfflineModeState.AUTO_ONLINE, false, "Auto · online",
            "Online: audio streams and AI features work. Tap to force offline mode for a spotty connection.",
        )
    }

    /** `nextOfflineModeForced`: the control cycles auto → forced offline → auto. */
    fun nextForced(current: ResolvedOfflineMode): Boolean = current.state != OfflineModeState.FORCED_OFFLINE
}
