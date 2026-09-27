package dev.jeromeswannack.chineselearning.lab

object Config {
    /** Same production API the web app and the hybrid Android app use. */
    const val API_BASE = "https://chinese-learning-api.jeromeswannack.workers.dev"
    const val WEB_URL = "https://chinese-learning-2x9.pages.dev"

    /** The solid hybrid (Capacitor) app — everything the Lab app doesn't do yet opens there. */
    const val HYBRID_PACKAGE = "dev.jeromeswannack.chineselearning"
    const val HYBRID_SCHEME = "chineselearning"

    /** The Lab app's own scheme; the worker's auth callback redirects here (NATIVE_AUTH_CLIENTS.lab). */
    const val AUTH_REDIRECT_SCHEME = "chineselearning-lab"
    const val AUTH_CLIENT = "lab"

    fun audioUrl(key: String, base: String = API_BASE): String =
        if (key.startsWith("http")) key else "$base/api/audio/${key.removePrefix("/api/audio/").removePrefix("/")}"
}
