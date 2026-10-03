package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Word checks: likely-wrong pinyin or English on a note — port of the pure parts of
 * shared/cards/check.ts the Lab UI needs (the estimate, parsing `notes.check_issues`, which
 * issues are still live, the deck-check summary, the kind labels and the deterministic
 * 一 / 不 issue). Parity-tested: parity/fixtures/card-check.ts → CardCheckParityTest.
 * Never applied automatically: the note shows "⚠ Possible issue" with Apply fix / Dismiss.
 */

/** Port of `NoteCheckIssue` (one possible issue stored on a note). */
@Serializable
data class NoteCheckIssue(
    val id: String,
    val field: String,
    val kind: String,
    val current: String,
    val proposed: String,
    val reason: String,
)

/** Port of `DeckCheckProposal`: one proposal of a per-deck "Check for errors" run. */
@Serializable
data class DeckCheckProposal(
    val id: String,
    val field: String,
    val kind: String,
    val current: String,
    val proposed: String,
    val reason: String,
    val note_id: String = "",
    val hanzi: String = "",
    val source_note_id: String? = null,
    val applied: Boolean = false,
    val source_applied: Boolean = false,
)

/** Port of `CheckEstimate`. */
@Serializable
data class CheckEstimate(val words: Int = 0, val batches: Int = 0, val usd: Double = 0.0, val label: String = "")

object CardCheck {
    /** Port of `CHECK_BATCH_SIZE`: words per Haiku call. */
    const val CHECK_BATCH_SIZE = 40

    // Port of `CHECK_COST` (Haiku 4.5: $1 / M input, $5 / M output).
    private const val PROMPT_TOKENS = 900
    private const val INPUT_TOKENS_PER_WORD = 30
    private const val OUTPUT_TOKENS_PER_WORD = 12
    private const val OUTPUT_TOKENS_PER_BATCH = 20
    private const val USD_PER_INPUT_TOKEN = 1.0 / 1_000_000
    private const val USD_PER_OUTPUT_TOKEN = 5.0 / 1_000_000

    private val FIELDS = setOf("pinyin", "english")
    private val KINDS = setOf("tone_change", "tones", "reading", "gloss")

    /** Port of `formatUsd`: "less than $0.01", "$0.03", "$1.20". */
    fun formatUsd(usd: Double): String {
        if (usd < 0.01) return "less than $0.01"
        return "$" + Js.toFixed(Js.round(usd * 100) / 100, 2)
    }

    /** Port of `estimateCheckCost(words)`: "~319 words · about $0.03". */
    fun estimateCheckCost(words: Double): CheckEstimate {
        val n = maxOf(0.0, Math.floor(words)).toInt()
        val batches = Math.ceil(n.toDouble() / CHECK_BATCH_SIZE).toInt()
        val input = batches * PROMPT_TOKENS + n * INPUT_TOKENS_PER_WORD
        val output = batches * OUTPUT_TOKENS_PER_BATCH + n * OUTPUT_TOKENS_PER_WORD
        val usd = input * USD_PER_INPUT_TOKEN + output * USD_PER_OUTPUT_TOKEN
        val label = "~$n word${if (n == 1) "" else "s"} · about ${formatUsd(usd)}"
        return CheckEstimate(n, batches, usd, label)
    }

    fun estimateCheckCost(words: Int): CheckEstimate = estimateCheckCost(words.toDouble())

    /** Port of `parseCheckIssues` for the stored JSON string (`notes.check_issues`); bad JSON / junk → dropped. */
    fun parseCheckIssues(raw: String?): List<NoteCheckIssue> {
        if (raw == null) return emptyList()
        val value = try {
            Json.parseToJsonElement(raw)
        } catch (_: Exception) {
            return emptyList()
        }
        return parseCheckIssues(value)
    }

    /** Port of `parseCheckIssues` for an already-parsed value. */
    fun parseCheckIssues(value: JsonElement?): List<NoteCheckIssue> {
        if (value !is JsonArray) return emptyList()
        return value.mapNotNull { v ->
            val o = v as? JsonObject ?: return@mapNotNull null
            fun str(k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val id = str("id") ?: return@mapNotNull null
            val field = str("field")?.takeIf { it in FIELDS } ?: return@mapNotNull null
            val kind = str("kind")?.takeIf { it in KINDS } ?: return@mapNotNull null
            val current = str("current") ?: return@mapNotNull null
            val proposed = str("proposed") ?: return@mapNotNull null
            val reason = str("reason") ?: return@mapNotNull null
            NoteCheckIssue(id, field, kind, current, proposed, reason)
        }
    }

    /** Port of `liveCheckIssues`: issues still about the note as it is now (an edited field makes its issue stale). */
    fun liveCheckIssues(issues: List<NoteCheckIssue>, pinyin: String, english: String): List<NoteCheckIssue> =
        issues.filter { JsJson.trim(if (it.field == "pinyin") pinyin else english) == JsJson.trim(it.current) }

    /** Port of `samePinyin`: compare ignoring spacing, apostrophes and case. */
    fun samePinyin(a: String, b: String): Boolean {
        fun n(s: String): String {
            val lower = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFC).lowercase()
            val sb = StringBuilder()
            for (c in lower) if (!(JsJson.isJsSpace(c) || c == '\'' || c == '’' || c == '·' || c == '-')) sb.append(c)
            return sb.toString()
        }
        return n(a) == n(b)
    }

    /** Port of `toneChangeIssue`: the deterministic 一 / 不 issue of one word (no id), or null. */
    fun toneChangeIssue(hanzi: String, pinyin: String): NoteCheckIssue? {
        val fixed = ToneChange.applyYiBuToneChanges(hanzi, pinyin)
        if (fixed == pinyin) return null
        val yi = hanzi.contains('一')
        val bu = hanzi.contains('不')
        val reason = when {
            yi && bu -> "一 and 不 change tone before the next syllable"
            yi -> "一 changes tone: yí before a 4th tone, yì before the others, yī alone / as a number"
            else -> "不 changes tone: bú before a 4th tone, otherwise bù"
        }
        return NoteCheckIssue("", "pinyin", "tone_change", pinyin, fixed, reason)
    }

    /** Port of `checkKindLabel`. */
    fun checkKindLabel(kind: String): String = when (kind) {
        "tone_change" -> "一/不 tone change"
        "tones" -> "Tones"
        "reading" -> "Reading"
        "gloss" -> "Meaning"
        else -> kind
    }

    /** The field label in the deck-check results ("Pinyin" / "Meaning"). */
    fun fieldLabel(field: String): String = if (field == "pinyin") "Pinyin" else "Meaning"

    /** Port of `deckCheckSummary(job)`. */
    fun deckCheckSummary(status: String, total: Int, checked: Int, proposals: List<DeckCheckProposal>): String {
        if (status == "queued") return "Starting… $total word${if (total == 1) "" else "s"} to check"
        if (status == "running") return "Checked $checked of $total words"
        if (status == "failed") return "Stopped after $checked of $total words"
        val open = proposals.count { !it.applied }
        val words = "$total word${if (total == 1) "" else "s"}"
        if (proposals.isEmpty()) return "No issues found in $words"
        if (open == 0) return "All ${proposals.size} fixes applied"
        return "$open possible issue${if (open == 1) "" else "s"} in $words"
    }
}
