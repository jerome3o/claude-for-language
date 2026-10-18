package dev.jeromeswannack.chineselearning.lab.core.memereview

import kotlinx.serialization.Serializable

/*
 * Port of shared/meme-review (docs/MEME_REVIEW.md) — 梗 Meme review (PROTOTYPE): the issue shape
 * the API serves (one issue per month, shared by every account) and the app-side rules in
 * rules.ts — month / coverage labels, link / verdict / register labels, the quiz score line, the
 * "+ Add as card" fields and the lines with a ▶. Parity-tested against the TypeScript
 * (parity/fixtures/meme-review.ts, MemeReviewParityTest). The validator (validate.ts) and the URL
 * rules run on the server only: clients read issues it already checked.
 */

/** Port of `MemeLine`. */
@Serializable
data class MemeLine(val hanzi: String, val pinyin: String = "", val english: String = "")

/** Port of `MemeSource`. platform: bilibili | youtube | douyin | weibo | xiaohongshu | zhihu | baidu | wechat | news | other. */
@Serializable
data class MemeSource(val url: String, val title: String = "", val platform: String = "other")

/** Port of `MemeMedia`. kind: video | post. */
@Serializable
data class MemeMedia(
    val url: String,
    val title: String = "",
    val platform: String = "other",
    val kind: String = "post",
    val thumbnail_url: String? = null,
)

/** Port of `MemeRegister`. where: online | spoken | both. */
@Serializable
data class MemeRegister(val who: String = "", val tone: String = "", val where: String = "online", val crude: Boolean = false, val note: String = "")

/** Port of `MemeSayIt`. verdict: fine | cute | cringe | avoid. */
@Serializable
data class MemeSayIt(val verdict: String = "fine", val note: String = "")

/** Port of `MemeOrigin`. confidence: high | medium. */
@Serializable
data class MemeOrigin(val text: String = "", val `when`: String = "", val confidence: String = "high")

/** Port of `MemePicture`. */
@Serializable
data class MemePicture(val prompt: String = "", val image_key: String? = null)

/** Port of `MemeItem`. */
@Serializable
data class MemeItem(
    val id: String,
    val hanzi: String,
    val pinyin: String = "",
    val english: String = "",
    val meaning: MemeLine,
    val origin: MemeOrigin = MemeOrigin(),
    val examples: List<MemeLine> = emptyList(),
    val register: MemeRegister = MemeRegister(),
    val say_it: MemeSayIt = MemeSayIt(),
    val related: List<MemeLine> = emptyList(),
    val sources: List<MemeSource> = emptyList(),
    val media: List<MemeMedia> = emptyList(),
    val picture: MemePicture = MemePicture(),
)

/** Port of `MemeQuizQuestion`. */
@Serializable
data class MemeQuizQuestion(val prompt: String, val options: List<String>, val answer: Int, val explanation: String = "", val item_id: String? = null)

@Serializable
data class MemeCovers(val from: String = "", val to: String = "")

/** Port of `MemeIssue`. */
@Serializable
data class MemeIssue(
    val month: String,
    val title: String,
    val title_en: String = "",
    val intro: MemeLine,
    val covers: MemeCovers = MemeCovers(),
    val items: List<MemeItem>,
    val quiz: List<MemeQuizQuestion> = emptyList(),
    val generator_version: Int = 1,
)

/** Port of `MemeIssueRecord`. status: missing | generating | ready | failed. */
@Serializable
data class MemeIssueRecord(
    val month: String,
    val status: String,
    val issue: MemeIssue? = null,
    val progress: String? = null,
    val error: String? = null,
    val updated_at: String? = null,
)

/** Port of `MemeIssueSummary`. */
@Serializable
data class MemeIssueSummary(
    val month: String,
    val status: String,
    val title: String? = null,
    val title_en: String? = null,
    val item_count: Int = 0,
    val preview: List<String> = emptyList(),
    val updated_at: String? = null,
)

/** Port of `MemeLessonJob`. status: generating | ready | failed. */
@Serializable
data class MemeLessonJob(
    val id: String,
    val month: String,
    val status: String,
    val lesson_id: String? = null,
    val error: String? = null,
    val created_at: String? = null,
)

/** Port of `MemeCardFields`. */
data class MemeCardFields(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val funFacts: String,
    val sentenceClue: String? = null,
    val sentenceCluePinyin: String? = null,
    val sentenceClueTranslation: String? = null,
)

object MemeReview {
    private val MONTHS_EN = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
    private val MONTHS_SHORT = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    private val MONTH = Regex("""^[0-9]{4}-(0[1-9]|1[0-2])$""")
    private val ISO_DATE = Regex("""^[0-9]{4}-[0-9]{2}-[0-9]{2}$""")

    /** Port of `isMemeMonth`. */
    fun isMonth(value: String): Boolean = MONTH.matches(value)

    /** Port of `memeMonthLabel`: "October 2026". */
    fun monthLabel(month: String): String =
        if (!isMonth(month)) "" else "${MONTHS_EN[month.substring(5, 7).toInt() - 1]} ${month.substring(0, 4)}"

    /** Port of `memeMonthLabelZh`: "2026年10月". */
    fun monthLabelZh(month: String): String =
        if (!isMonth(month)) "" else "${month.substring(0, 4)}年${month.substring(5, 7).toInt()}月"

    /** Port of `memeCoversLabel`: "23 Aug – 18 Oct 2026". */
    fun coversLabel(covers: MemeCovers): String {
        if (!ISO_DATE.matches(covers.from) || !ISO_DATE.matches(covers.to)) return ""
        fun part(iso: String) = "${iso.substring(8, 10).toInt()} ${MONTHS_SHORT.getOrElse(iso.substring(5, 7).toInt() - 1) { "" }}"
        val fromYear = covers.from.substring(0, 4)
        val toYear = covers.to.substring(0, 4)
        return if (fromYear == toYear) "${part(covers.from)} – ${part(covers.to)} $toYear" else "${part(covers.from)} $fromYear – ${part(covers.to)} $toYear"
    }

    private val PLATFORM_NAMES = mapOf(
        "bilibili" to "Bilibili", "youtube" to "YouTube", "douyin" to "Douyin", "weibo" to "Weibo", "xiaohongshu" to "Xiaohongshu",
        "zhihu" to "Zhihu", "baidu" to "Baidu", "wechat" to "WeChat", "news" to "the news", "other" to "the web",
    )
    val PLATFORMS: List<String> = PLATFORM_NAMES.keys.toList()

    /** Port of `memePlatformName`. */
    fun platformName(platform: String): String = PLATFORM_NAMES[platform] ?: "the web"

    /** Port of `memeLinkLabel`: "▶ Watch on Bilibili" / "↗ Open on Weibo". */
    fun linkLabel(kind: String, platform: String): String = if (kind == "video") "▶ Watch on ${platformName(platform)}" else "↗ Open on ${platformName(platform)}"

    private val VERDICTS = mapOf("fine" to "👍 Fine to say", "cute" to "😊 Cute from you", "cringe" to "😬 A bit cringe from you", "avoid" to "🙅 Better not")

    /** Port of `memeVerdictLabel`. */
    fun verdictLabel(verdict: String): String = VERDICTS[verdict] ?: VERDICTS.getValue("fine")

    private val WHERE = mapOf("online" to "Online (typed)", "spoken" to "Said out loud", "both" to "Online and spoken")

    /** Port of `memeRegisterChips`. */
    fun registerChips(r: MemeRegister): List<String> {
        val chips = listOf(r.who, r.tone, WHERE[r.where] ?: "").map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()
        if (r.crude) chips += "⚠ Crude"
        return chips
    }

    /** Port of `memeQuizScoreLine`. */
    fun quizScoreLine(correct: Int, total: Int): String {
        if (total <= 0) return ""
        if (correct == total) return "$correct / $total — 你很懂梗！ You're very online."
        if (correct * 2 >= total) return "$correct / $total — not bad, nearly 网上冲浪 level."
        return "$correct / $total — read the issue once more and try again."
    }

    /** `NOT_A_CLUE`: the card standard's forbidden characters + ellipses. */
    private const val NOT_A_CLUE_CHARS = "/\\|()[]{}（）【】〔〕<>~*=+#@&^`\"'_…"
    private fun notAClue(s: String): Boolean = s.any { it in NOT_A_CLUE_CHARS } || s.contains("...") || s.contains("。。。")

    /** Port of `memeCardFields`. */
    fun cardFields(item: MemeItem, month: String): MemeCardFields {
        val lines = mutableListOf(
            "${item.meaning.hanzi}${if (item.meaning.english.isNotEmpty()) " — ${item.meaning.english}" else ""}",
            "Origin (${monthLabel(month).ifEmpty { month }} meme review): ${item.origin.text}${if (item.origin.confidence == "medium") " (not fully certain)" else ""}",
            "Who says it: ${registerChips(item.register).joinToString(" · ")}${if (item.register.note.isNotEmpty()) ". ${item.register.note}" else ""}",
            "Would you say it? ${verdictLabel(item.say_it.verdict)}${if (item.say_it.note.isNotEmpty()) " — ${item.say_it.note}" else ""}",
        )
        if (item.related.isNotEmpty()) lines += "Riffs on: ${item.related.joinToString(", ") { "${it.hanzi} (${it.english})" }}"
        val clue = item.examples.firstOrNull { it.hanzi.contains(item.hanzi) && !notAClue(it.hanzi) }
        return MemeCardFields(
            hanzi = item.hanzi,
            pinyin = item.pinyin,
            english = item.english,
            funFacts = lines.joinToString("\n"),
            sentenceClue = clue?.hanzi,
            sentenceCluePinyin = clue?.pinyin,
            sentenceClueTranslation = clue?.english,
        )
    }

    /** Port of `memeAudioLines`: every line with a ▶, once each, in order. */
    fun audioLines(issue: MemeIssue): List<String> {
        val out = LinkedHashSet<String>()
        for (item in issue.items) {
            if (item.hanzi.isNotEmpty()) out += item.hanzi
            if (item.meaning.hanzi.isNotEmpty()) out += item.meaning.hanzi
            for (e in item.examples) if (e.hanzi.isNotEmpty()) out += e.hanzi
        }
        return out.toList()
    }
}
