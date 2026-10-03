package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkSend
import dev.jeromeswannack.chineselearning.lab.data.api.SendSessionItemsResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import dev.jeromeswannack.chineselearning.lab.data.api.sendSessionNotesItems
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Create, then send (web: SessionNotesJobCard's `send` mutation): what a session-notes job made stays in the
 * tutor's account until she presses "Send to <student>" on the job card. POSTs
 * `…/session-notes/:id/send { items }`, shows [HomeworkSend.sentToast], reports per-item failures back to
 * the card as "Could not send: …", then [onSent] refreshes the job list and the student's caches.
 * Shared by the Session notes page and the call review's Homework section.
 */
class HomeworkSendController(
    private val app: LabApp,
    private val scope: CoroutineScope,
    /** The relationship, read when a send starts (the call review learns it after loading). */
    private val relIdOf: () -> String?,
    private val onSent: suspend (SendSessionItemsResultDto) -> Unit = {},
) {
    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast.asStateFlow()
    private var toastJob: Job? = null

    /** Sends [keys] of [job]; [done] gets null on success or the error line for the card's InlineNotice. */
    fun send(job: SessionJobDto, keys: List<String>, studentName: String, done: (String?) -> Unit) {
        val relId = relIdOf() ?: return done("Could not send")
        scope.launch {
            attempt { app.repo.api.sendSessionNotesItems(relId, job.id, keys) }
                .onSuccess { r ->
                    if (r.sent.isNotEmpty()) {
                        app.haptics.celebrate()
                        app.sounds.play(Sounds.Sfx.POP)
                        showToast(HomeworkSend.sentToast(r.sent.map { it.title }, studentName))
                    } else if (r.errors.isNotEmpty()) {
                        app.haptics.wrong()
                    }
                    done(if (r.errors.isNotEmpty()) "Could not send: ${r.errors.joinToString("; ") { it.error }}" else null)
                    onSent(r)
                }
                .onFailure { e ->
                    app.haptics.wrong()
                    done(e.userMessage().ifBlank { "Could not send" })
                }
        }
    }

    private fun showToast(text: String) {
        toastJob?.cancel()
        _toast.value = text
        toastJob = scope.launch { delay(4_500); _toast.value = null }
    }
}
