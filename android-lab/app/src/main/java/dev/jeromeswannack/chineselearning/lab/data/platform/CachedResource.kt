package dev.jeromeswannack.chineselearning.lab.data.platform

import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer

/**
 * What a screen shows for data that lives on the server: the cached copy (if any),
 * whether a refresh is running, and the last refresh error as a sentence for an
 * InlineNotice. Render with `LoadableContent` (ui/kit/States.kt).
 */
data class Loadable<T>(
    val data: T? = null,
    val loading: Boolean = false,
    val error: String? = null,
    /** True when the last refresh was skipped / failed because the phone is offline. */
    val offline: Boolean = false,
    /** Epoch ms of the cached copy. */
    val updatedAt: Long? = null,
) {
    val hasData: Boolean get() = data != null
}

/**
 * Cache-first server data for a ViewModel: emits the cached copy at once, refreshes it
 * from the API ([fetch]) when it is older than [maxAgeMs] (0 = on every open), writes
 * the answer to the cache (which re-emits), and reports failures without dropping the
 * cached copy. Offline it shows the cache and `offline = true`.
 *
 *   val readers = app.cachedResource(viewModelScope, "readers/list", kind = "readers") { app.api.readers() }
 *   val ui = readers.state  // StateFlow<Loadable<List<ReaderDto>>>
 */
class CachedResource<T>(
    private val scope: CoroutineScope,
    private val cache: JsonCache,
    val key: String,
    private val kind: String,
    private val serializer: KSerializer<T>,
    private val maxAgeMs: Long = 0,
    private val online: () -> Boolean = { true },
    private val fetch: suspend () -> T,
) {
    private data class Status(val loading: Boolean = true, val error: String? = null, val offline: Boolean = false)

    private val status = MutableStateFlow(Status())

    val state: StateFlow<Loadable<T>> = combine(cache.observeEntry(key), status) { entry, s ->
        Loadable(
            data = entry?.let { cache.decode(serializer, it.json) },
            loading = s.loading,
            error = s.error,
            offline = s.offline,
            updatedAt = entry?.updatedAt,
        )
    }.stateIn(scope, SharingStarted.Eagerly, Loadable(loading = true))

    init {
        refresh(force = false)
    }

    /** Refetches (pull-to-refresh, Retry). With `force = false` a fresh cache is kept. */
    fun refresh(force: Boolean = true): Job = scope.launch {
        if (!force && maxAgeMs > 0 && cache.isFresh(key, maxAgeMs)) {
            status.value = Status(loading = false)
            return@launch
        }
        if (!online()) {
            status.value = Status(loading = false, offline = true)
            return@launch
        }
        status.update { it.copy(loading = true) }
        try {
            val value = fetch()
            cache.put(key, kind, value, serializer)
            status.value = Status(loading = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            status.value = Status(loading = false, error = e.userMessage(), offline = e is java.io.IOException && e !is dev.jeromeswannack.chineselearning.lab.data.HttpException)
        }
    }

    /** Optimistic local change (e.g. right after enqueuing the matching Outbox write). */
    suspend fun update(transform: (T?) -> T) {
        cache.put(key, kind, transform(cache.get(key, serializer)), serializer)
    }
}
