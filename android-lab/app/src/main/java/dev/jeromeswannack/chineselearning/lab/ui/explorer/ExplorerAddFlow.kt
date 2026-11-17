package dev.jeromeswannack.chineselearning.lab.ui.explorer

import dev.jeromeswannack.chineselearning.lab.core.ToneChange
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAdd
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAddFillReason
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAddStep
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import kotlinx.coroutines.CancellationException

/*
 * "+ Add as card" in the explorer (docs/LANGUAGE_EXPLORER.md "Adding before the meaning has
 * loaded"; web components/explorer/CardTieIn.tsx): the views first WAIT for their in-flight
 * lookups (the pill says "Adding…"), then this decides with core ExplorerAdd — add at once, ask the
 * gloss path (`POST /api/ai/gloss-words`) for a missing meaning, or open the add sheet's fill mode
 * (offline, or no meaning anywhere). Pinyin missing → the phone's own reading (auto-pinyin + 一 / 不).
 */

/** What the add sheet opens with: the card, and the fill mode's reason (null = save at once). */
data class AddRequest(val chunk: Chunk, val fill: ExplorerAddFillReason? = null)

/** The phone's reading of a word (auto-pinyin + 一 / 不), one word = no spaces (zhège). */
fun deviceWordPinyin(hanzi: String): String = runCatching { ToneChange.autoPinyin(hanzi).replace(Regex("\\s+"), "") }.getOrDefault("")

/** [chunk] as the view has it once its lookups are in → what the add sheet opens with. */
suspend fun resolveExplorerAdd(
    chunk: Chunk,
    online: () -> Boolean,
    gloss: suspend (hanzi: String, pinyin: String?) -> Pair<String, String>?,
    record: (event: String, props: Map<String, Any?>) -> Unit,
    kind: String,
    devicePinyin: (String) -> String = ::deviceWordPinyin,
): AddRequest {
    val device = devicePinyin(chunk.hanzi)
    var step = ExplorerAdd.step(chunk.hanzi, chunk.pinyin, chunk.english, device, online(), glossed = false)
    if (step is ExplorerAddStep.Gloss) {
        // No meaning on the phone (a word outside the 60k list): the gloss path fills it.
        val glossed = try {
            gloss(step.hanzi, step.pinyin.ifBlank { null })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        record("explorer.add_gloss", mapOf("kind" to kind, "found" to !glossed?.second.isNullOrBlank()))
        step = ExplorerAdd.step(chunk.hanzi, step.pinyin.ifBlank { glossed?.first.orEmpty() }, glossed?.second.orEmpty(), device, online(), glossed = true)
    }
    return when (val s = step) {
        is ExplorerAddStep.Add -> AddRequest(chunk.copy(hanzi = s.hanzi, pinyin = s.pinyin, english = s.english))
        is ExplorerAddStep.Fill -> {
            record("explorer.add_fill", mapOf("kind" to kind, "reason" to s.reason.wire))
            AddRequest(chunk.copy(hanzi = s.hanzi, pinyin = s.pinyin, english = s.english), s.reason)
        }
        // Not reached (glossed = true never asks again): the fill sheet, to be safe.
        is ExplorerAddStep.Gloss -> AddRequest(chunk.copy(hanzi = s.hanzi, pinyin = s.pinyin, english = ""), ExplorerAddFillReason.NO_MEANING)
    }
}
