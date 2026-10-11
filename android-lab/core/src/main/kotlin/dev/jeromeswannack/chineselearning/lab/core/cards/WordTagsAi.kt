package dev.jeromeswannack.chineselearning.lab.core.cards

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.text.Normalizer

/*
 * Port of shared/cards/word-tags-ai.ts — word tags, the AI pass (docs/STUDY_SESSION.md "Word
 * tags"): a note's `word_tags` verdict (transitivity, register, separable, register note,
 * confidence) merged under the lexicon's tags. The lexicon always wins; low confidence is never
 * shown; AI pills carry `ai = true` (✨) and their sheet says "Suggested by AI — may be wrong".
 * Parity-tested over the shipped lexicon (WordTagsAiParityTest, parity/fixtures/word-tags-ai.ts).
 */

/** Port of `AiWordTags` (notes.word_tags). Null fields = absent. */
data class AiWordTags(
    val v: Int,
    val transitivity: String? = null,
    val separable: Boolean? = null,
    val register: String? = null,
    val registerNote: String? = null,
    val confidence: String,
)

object WordTagsAi {
    const val WORD_TAGS_AI_VERSION = 1
    const val REGISTER_NOTE_MAX = 60
    const val AI_WORD_TAG_NOTICE = "Suggested by AI — may be wrong"
    private const val AI_SOURCE = "AI suggestion from the card’s word and meaning"

    val TRANSITIVITIES = listOf("transitive", "intransitive", "both", "n/a")
    val AI_REGISTERS = listOf("formal", "neutral", "informal", "polite", "rude", "slang", "literary")
    val AI_CONFIDENCES = listOf("high", "medium", "low")

    /** Port of AI_REGISTER_CODE (neutral = no pill). */
    val AI_REGISTER_CODE: Map<String, String?> = mapOf(
        "formal" to "F", "neutral" to null, "informal" to "I", "polite" to "P", "rude" to "R", "slang" to "S", "literary" to "L",
    )

    /** Port of TRANSITIVITY_LABELS. */
    val TRANSITIVITY_LABELS: Map<String, String> = mapOf(
        "transitive" to "Takes an object", "intransitive" to "No object", "both" to "Object optional",
    )

    private val TRANSITIVITY_EXPLAIN: Map<String, Triple<String, String, String>> = mapOf(
        "transitive" to Triple(
            "Takes an object",
            "A transitive verb: the thing it acts on comes straight after it, with no preposition in between.",
            "我喜欢音乐。",
        ),
        "intransitive" to Triple(
            "No object",
            "An intransitive verb: nothing comes straight after it. To say who or what it involves, use a preposition BEFORE the verb (跟, 对, 给…).",
            "我跟他见面。",
        ),
        "both" to Triple(
            "Object optional",
            "Works with or without an object after it — both are natural.",
            "我在吃。我在吃饭。",
        ),
    )

    private val SLOT: Map<String, Int> = mapOf(
        "pos" to 0, "phrase" to 0, "separable" to 1, "transitivity" to 2, "register" to 3, "measure" to 4,
        "hsk" to 5, "frequency" to 6, "trad" to 7,
    )

    private fun str(e: JsonElement?): String? = JsJson.str(e)

    /** Port of cleanRegisterNote(): whitespace collapsed, trimmed, cut to 60; "" = none. */
    fun cleanRegisterNote(v: JsonElement?): String {
        val s = str(v) ?: return ""
        return JsJson.trim(JsJson.trim(JsJson.replaceSpaceRuns(s, " ")).take(REGISTER_NOTE_MAX))
    }

    /** Port of pickAiWordTags(). */
    fun pick(input: JsonElement?): AiWordTags? {
        val o = input as? JsonObject ?: return null
        val confidence = str(o["confidence"])?.takeIf { it in AI_CONFIDENCES } ?: return null
        val rawV = o["v"]
        val v: Int = if (rawV == null) {
            WORD_TAGS_AI_VERSION
        } else {
            val prim = rawV as? JsonPrimitive
            val d = if (prim != null && !prim.isString && rawV !is JsonNull) prim.content.toDoubleOrNull() else null
            if (d != null && JsJson.isInteger(d) && d >= 1) d.toInt() else return null
        }
        val sepPrim = o["separable"] as? JsonPrimitive
        val separable = if (sepPrim != null && !sepPrim.isString && sepPrim !is JsonNull) sepPrim.booleanOrNull else null
        val note = cleanRegisterNote(o["register_note"])
        return AiWordTags(
            v = v,
            transitivity = str(o["transitivity"])?.takeIf { it in TRANSITIVITIES },
            separable = separable,
            register = str(o["register"])?.takeIf { it in AI_REGISTERS },
            registerNote = note.ifEmpty { null },
            confidence = confidence,
        )
    }

    /** Port of parseAiWordTags() for the stored JSON text; junk → null. */
    fun parse(raw: String?): AiWordTags? {
        if (raw.isNullOrEmpty()) return null
        val value = try {
            Json.parseToJsonElement(raw)
        } catch (_: Exception) {
            return null
        }
        return pick(value)
    }

    /** Port of visibleAiWordTags(). */
    fun visible(ai: AiWordTags?): AiWordTags? = ai?.takeIf { it.confidence != "low" }

    /** Port of mergeAiWordTags(). [base] = WordTags.tags(hanzi, lexicon, …) without an exclude. */
    fun merge(hanzi: String, base: List<WordTag>, ai: AiWordTags?): List<WordTag> {
        val v = visible(ai) ?: return base.toList()
        val key = WordTags.key(hanzi)
        val added = ArrayList<WordTag>()
        val sentence = WordTags.SENTENCE_MARK.containsMatchIn(Normalizer.normalize(hanzi, Normalizer.Form.NFC)) || !WordTags.isAllHan(key)
        val hasPos = base.any { it.kind == "pos" }
        val verbish = !sentence && (base.any { it.id == "pos:v" } || !hasPos)
        val t = v.transitivity
        if (verbish && t != null && t != "n/a") {
            added.add(WordTag("transitivity", "transitivity:$t", TRANSITIVITY_LABELS.getValue(t), "grammar", ai = true))
        }
        if (verbish && v.separable == true && base.none { it.kind == "separable" }) {
            added.add(WordTag("separable", "separable", "Separable verb", "grammar", ai = true))
        }
        val code = v.register?.let { AI_REGISTER_CODE[it] }
        if (code != null && base.none { it.kind == "register" }) {
            added.add(WordTag("register", "register:$code", WordTags.REGISTER_LABELS.getValue(code), WordTags.REGISTER_TONE[code] ?: "plain", ai = true))
        }
        if (added.isEmpty()) return base.toList()
        return (base + added).sortedBy { SLOT[it.kind] ?: 9 }
    }

    /** Port of wordTagsWithAi(): the lexicon's tags merged with the verdict, then the exclude. */
    fun tags(
        hanzi: String,
        lexicon: WordTagLexicon?,
        ai: AiWordTags?,
        rankLoaded: Boolean = false,
        rank: Int? = null,
        exclude: Set<String> = emptySet(),
    ): List<WordTag> {
        if (lexicon == null) return emptyList()
        return merge(hanzi, WordTags.tags(hanzi, lexicon, rankLoaded = rankLoaded, rank = rank), ai).filter { it.kind !in exclude }
    }

    /** Port of explainWordTag(): an AI pill's sheet (notice + note), else the lexicon's. */
    fun explanation(tag: WordTag, hanzi: String, lexicon: WordTagLexicon?, ai: AiWordTags?): WordTagExplanation {
        if (!tag.ai) return WordTags.explanation(tag, hanzi, lexicon)
        return when (tag.kind) {
            "transitivity" -> {
                val (title, body, example) = TRANSITIVITY_EXPLAIN[tag.id.removePrefix("transitivity:")] ?: Triple(tag.label, "", "")
                WordTagExplanation(title, body, example, AI_SOURCE, ai = true)
            }
            "separable" -> WordTags.explanation(tag, hanzi, null).copy(example = "", source = AI_SOURCE, ai = true)
            "register" -> {
                val code = tag.id.removePrefix("register:")
                WordTagExplanation(
                    WordTags.REGISTER_LABELS[code] ?: tag.label, WordTags.REGISTER_EXPLAIN[code] ?: "", "", AI_SOURCE,
                    ai = true, note = ai?.registerNote ?: "",
                )
            }
            else -> WordTags.explanation(tag, hanzi, lexicon).copy(source = AI_SOURCE, ai = true)
        }
    }
}
