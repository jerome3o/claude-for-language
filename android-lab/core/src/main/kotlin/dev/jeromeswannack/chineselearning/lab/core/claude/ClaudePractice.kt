package dev.jeromeswannack.chineselearning.lab.core.claude

import dev.jeromeswannack.chineselearning.lab.core.ChatVoice
import dev.jeromeswannack.chineselearning.lab.core.ConversationVoices
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch

/**
 * Practice with Claude — role-play threads (docs/CHAT.md "Practice with Claude"): port of
 * shared/claude/practice.ts. Parity-tested (parity/fixtures/claude-practice.ts → ClaudePracticeParityTest).
 *
 * A `practice` thread is a Claude thread in which Claude plays someone in a situation; Claude speaks
 * first. Started from the Chats tab's ✏️ → "🎭 Practice a situation…", a study card's ⋯ → "🎭 Roleplay
 * this word", or the old Claude page.
 */
object ClaudePractice {
    /** A practice context as the API takes it (the descriptor, `kind: practice`), + its badge label. */
    data class Context(
        val scenario: String? = null,
        val aiRole: String? = null,
        val userRole: String? = null,
        val level: String? = null,
        val noteId: String? = null,
        val voiceId: String? = null,
        /** The badge snapshot (a card's word). */
        val label: String? = null,
    )

    // ---------- Levels ----------

    data class Level(val id: String, val label: String, val hint: String)

    /** Port of PRACTICE_LEVELS. */
    val LEVELS = listOf(
        Level("beginner", "Beginner", "Very short, slow, everyday words"),
        Level("intermediate", "Intermediate", "Natural, HSK 3–4"),
        Level("advanced", "Advanced", "Like a native speaker"),
    )

    const val DEFAULT_LEVEL = "intermediate"

    /** Port of parsePracticeLevel. */
    fun parseLevel(v: String?): String? = v?.takeIf { it == "beginner" || it == "intermediate" || it == "advanced" }

    // ---------- Situations ----------

    data class Scenario(val id: String, val icon: String, val label: String, val scenario: String, val aiRole: String, val userRole: String)

    /** Port of PRACTICE_SCENARIOS. */
    val SCENARIOS = listOf(
        Scenario("restaurant", "🍜", "Ordering at a restaurant", "在饭店点菜", "服务员 (a waiter)", "客人 (a customer)"),
        Scenario("taxi", "🚕", "Taking a taxi", "打车去火车站", "出租车司机 (a taxi driver)", "乘客 (a passenger)"),
        Scenario("directions", "🗺️", "Asking the way", "在街上问路", "路人 (a friendly passer-by)", "游客 (a visitor)"),
        Scenario("market", "🍎", "Buying fruit at a market", "在市场买水果，还可以讲价", "水果摊老板 (the stall owner)", "顾客 (a customer)"),
        Scenario("hotel", "🏨", "Checking in at a hotel", "在酒店办入住", "前台 (the receptionist)", "客人 (a guest)"),
        Scenario("doctor", "🩺", "Seeing a doctor", "去医院看病", "医生 (a doctor)", "病人 (a patient)"),
        Scenario("friend", "☕", "Chatting with a new friend", "跟新朋友聊天：爱好、工作、周末", "新朋友 (a new friend)", "你自己 (yourself)"),
    )

    /** Port of PRACTICE_TEXT_MAX. */
    const val TEXT_MAX = 200

    /** JS `s.replace(/\s+/g, ' ').trim()`. */
    private fun collapse(s: String): String {
        val b = StringBuilder()
        var space = false
        for (c in s) {
            if (NoteSearch.isJsWhitespace(c)) {
                if (!space) b.append(' ')
                space = true
            } else {
                b.append(c)
                space = false
            }
        }
        return NoteSearch.jsTrim(b.toString())
    }

    private fun clean(v: String?): String? = v?.takeIf { NoteSearch.jsTrim(it).isNotEmpty() }?.let { collapse(it).take(TEXT_MAX) }

    /** Port of practiceContext: the "Practice a situation" form → a context (null = no situation yet). */
    fun practiceContext(scenario: String?, aiRole: String?, userRole: String?, level: String?): Context? {
        val s = clean(scenario) ?: return null
        return Context(scenario = s, aiRole = clean(aiRole), userRole = clean(userRole), level = parseLevel(level) ?: DEFAULT_LEVEL)
    }

    /** Port of practiceFromCard: "🎭 Roleplay this word" — a conversation that naturally uses the word. */
    fun fromCard(noteId: String, hanzi: String, level: String? = null): Context {
        val h = collapse(hanzi).take(40)
        return Context(
            scenario = "用「$h」聊天",
            aiRole = "聊天的朋友 (a friendly conversation partner)",
            userRole = "学中文的人，在练习「$h」 (a learner practising this word)",
            level = level ?: DEFAULT_LEVEL,
            noteId = noteId,
            label = h,
        )
    }

    // ---------- The persona's voice ----------

    /** Port of PRACTICE_VOICE_SPEED. */
    const val VOICE_SPEED = 0.7

    private val FEMALE_HINT = Regex("女|她|阿姨|小姐|妈妈|姐|奶奶|waitress|woman|female|lady|mother|girl|aunt", RegexOption.IGNORE_CASE)

    // JS `\b` is ASCII-word based: spelled out (Android's ICU `\b` is Unicode).
    private val MALE_HINT = Regex("男|他|先生|叔叔|爸爸|哥|爷爷|(?<![A-Za-z0-9_])man(?![A-Za-z0-9_])|male|father|boy|uncle|waiter(?![A-Za-z0-9_])", RegexOption.IGNORE_CASE)

    /** The JS hash: `h = (Math.imul(h, 31) + charCode) | 0`, then `Math.abs`. */
    private fun hash(s: String): Long {
        var h = 0
        for (c in s) h = h * 31 + c.code
        return kotlin.math.abs(h.toLong())
    }

    /** Port of practiceVoiceFor: the stored voice when it is an app voice, else stable per situation + role, by the role's gender. */
    fun voiceFor(voiceId: String?, scenario: String?, aiRole: String?): String {
        if (!voiceId.isNullOrEmpty() && voiceId in ChatVoice.VOICE_IDS) return voiceId
        val role = aiRole ?: ""
        val female = FEMALE_HINT.containsMatchIn(role)
        val male = !female && MALE_HINT.containsMatchIn(role)
        val pools = ConversationVoices.pools(null)
        val pool = when {
            female -> pools.getValue("female")
            male -> pools.getValue("male")
            else -> pools.getValue("female") + pools.getValue("male")
        }
        if (pool.isEmpty()) return ChatVoice.DEFAULT_VOICE
        return pool[(hash("${scenario ?: ""}|$role") % pool.size).toInt()]
    }

    // ---------- Asking for help mid-role-play ----------

    private val HELP_MARKS = listOf("💡", "🆘", "✏️")
    private const val W = "(?![A-Za-z0-9_])"
    private val HELP_TEXT = Regex(
        "^(how (do|would|can) (i|you) say$W|what (should|could) i say$W|hint$W|help$W|correct (me|my)$W)|怎么说|提示|纠正|改一下我",
        RegexOption.IGNORE_CASE,
    )

    /** Port of isPracticeHelpRequest: a message that steps out of the role-play (a chip, "how do I say", 怎么说). */
    fun isHelpRequest(text: String): Boolean {
        val t = NoteSearch.jsTrim(text)
        return HELP_MARKS.any { t.startsWith(it) } || HELP_TEXT.containsMatchIn(t)
    }

    /** Port of practiceReplyLanguage: a role-play line is Chinese; help is in his Ask Claude language. */
    fun replyLanguage(text: String, askLanguage: String): String = if (isHelpRequest(text)) askLanguage else "zh"
}
