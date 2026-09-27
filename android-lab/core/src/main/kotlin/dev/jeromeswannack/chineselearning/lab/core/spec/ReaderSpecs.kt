package dev.jeromeswannack.chineselearning.lab.core.spec

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Ports of shared/reader/validate.ts, diff.ts and export.ts for a graded reader held as a JSON
 * tree (`ReaderSpec`: titles, difficulty, topic, vocabulary_used, ordered pages). Parity-tested
 * against the TypeScript (ReaderSpecParityTest).
 */
object ReaderValidator {
    val DIFFICULTIES = listOf("beginner", "elementary", "intermediate", "advanced")
    private const val MAX_PAGES = 60
    private const val MAX_TITLE = 200
    private const val MAX_TEXT = 4000

    private fun s(v: JsonElement?): String = str(v) ?: ""

    fun validate(input: JsonElement?): List<String> {
        val errors = mutableListOf<String>()
        if (input !is JsonObject) return listOf("Reader spec must be an object")

        if (JsJson.trim(s(input["title_chinese"])).isEmpty()) errors += "title_chinese is required"
        else if (s(input["title_chinese"]).length > MAX_TITLE) errors += "title_chinese is too long (max $MAX_TITLE characters)"
        if (JsJson.trim(s(input["title_english"])).isEmpty()) errors += "title_english is required"
        else if (s(input["title_english"]).length > MAX_TITLE) errors += "title_english is too long (max $MAX_TITLE characters)"

        if (s(input["difficulty_level"]) !in DIFFICULTIES) errors += "difficulty_level must be one of ${DIFFICULTIES.joinToString(", ")}"
        val topic = input["topic"]
        if (topic != null && topic !is JsonNull && str(topic) == null) errors += "topic must be a string or null"

        val vocab = input["vocabulary_used"]
        if (vocab != null) {
            if (vocab !is JsonArray) errors += "vocabulary_used must be an array"
            else vocab.forEachIndexed { i, item ->
                if (item !is JsonObject || JsJson.trim(s(item["hanzi"])).isEmpty()) errors += "vocabulary_used[$i] needs hanzi"
            }
        }

        val pages = input["pages"]
        if (pages !is JsonArray) {
            errors += "pages must be an array"
            return errors
        }
        if (pages.isEmpty()) errors += "A reader needs at least one page"
        if (pages.size > MAX_PAGES) errors += "Too many pages (max $MAX_PAGES)"

        val seenIds = HashSet<String>()
        pages.forEachIndexed { i, page ->
            val n = i + 1
            if (page !is JsonObject) {
                errors += "Page $n must be an object"
                return@forEachIndexed
            }
            val id = page["id"]
            if (id != null) {
                val sid = str(id)
                if (sid.isNullOrEmpty()) errors += "Page $n: id must be a non-empty string when present"
                else if (sid in seenIds) errors += "Page $n: duplicate page id \"$sid\""
                else seenIds += sid
            }
            if (JsJson.trim(s(page["content_chinese"])).isEmpty()) errors += "Page $n: Chinese text is required"
            else if (s(page["content_chinese"]).length > MAX_TEXT) errors += "Page $n: Chinese text is too long"
            val py = page["content_pinyin"]
            if (py != null && str(py) == null) errors += "Page $n: content_pinyin must be a string"
            val en = page["content_english"]
            if (en != null && str(en) == null) errors += "Page $n: content_english must be a string"
            else if (JsJson.trim(s(en)).isEmpty()) errors += "Page $n: English translation is required"
            val ip = page["image_prompt"]
            if (ip != null && ip !is JsonNull && str(ip) == null) errors += "Page $n: image_prompt must be a string or null"
        }
        return errors
    }
}

data class ReaderFieldChange(val field: String, val before: JsonElement, val after: JsonElement)

sealed interface ReaderPageDiffEntry {
    val index: Int
    val kind: String
    data class Added(override val index: Int, val page: JsonObject) : ReaderPageDiffEntry { override val kind = "added" }
    data class Removed(override val index: Int, val page: JsonObject) : ReaderPageDiffEntry { override val kind = "removed" }
    data class Moved(val fromIndex: Int, override val index: Int, val page: JsonObject) : ReaderPageDiffEntry { override val kind = "moved" }
    data class Changed(val fromIndex: Int, override val index: Int, val before: JsonObject, val after: JsonObject, val fields: List<ReaderFieldChange>) : ReaderPageDiffEntry { override val kind = "changed" }
}

data class ReaderDiffResult(val changed: Boolean, val meta: List<ReaderFieldChange>, val pages: List<ReaderPageDiffEntry>)

object ReaderDiff {
    private val PAGE_FIELDS = listOf("content_chinese", "content_pinyin", "content_english", "image_prompt")

    private fun norm(v: JsonElement?): String = when {
        v == null || v is JsonNull -> ""
        str(v) != null -> JsJson.trim(str(v)!!)
        else -> JsJson.jsString(v)
    }

    /** Content identity of a page: its four authored fields (pageContentKey). */
    fun pageContentKey(page: JsonObject): String = JsJson.stringify(JsonArray(PAGE_FIELDS.map { JsonPrimitive(norm(page[it])) }))!!

    private fun pageFieldChanges(before: JsonObject, after: JsonObject): List<ReaderFieldChange> =
        PAGE_FIELDS.filter { norm(before[it]) != norm(after[it]) }.map { ReaderFieldChange(it, before[it] ?: JsonNull, after[it] ?: JsonNull) }

    private fun bigrams(text: String): Set<String> {
        val s = JsJson.replaceSpaceRuns(text, "")
        val out = LinkedHashSet<String>()
        for (i in 0 until s.length - 1) out += s.substring(i, i + 2)
        if (s.length == 1) out += s
        return out
    }

    /** Dice coefficient over character bigrams of the Chinese text (pageSimilarity). */
    fun pageSimilarity(a: JsonObject, b: JsonObject): Double {
        val x = bigrams(str(a["content_chinese"]) ?: "")
        val y = bigrams(str(b["content_chinese"]) ?: "")
        if (x.isEmpty() || y.isEmpty()) return 0.0
        var shared = 0
        for (g in x) if (g in y) shared++
        return (2.0 * shared) / (x.size + y.size)
    }

    private class Located(val index: Int, val page: JsonObject) { var matched = false }

    private const val SIMILARITY_THRESHOLD = 0.4

    private fun pagesOf(spec: JsonObject) = (spec["pages"] as? JsonArray).orEmpty().map { it as? JsonObject ?: JsonObject(emptyMap()) }

    fun diff(before: JsonObject, after: JsonObject): ReaderDiffResult {
        val meta = mutableListOf<ReaderFieldChange>()
        for (field in listOf("title_chinese", "title_english", "difficulty_level", "topic")) {
            if (norm(before[field]) != norm(after[field])) meta += ReaderFieldChange(field, before[field] ?: JsonNull, after[field] ?: JsonNull)
        }
        val olds = pagesOf(before).mapIndexed { i, p -> Located(i, p) }
        val news = pagesOf(after).mapIndexed { i, p -> Located(i, p) }
        val pairs = mutableListOf<Pair<Located, Located>>()
        fun pair(o: Located, n: Located) { o.matched = true; n.matched = true; pairs += o to n }

        // Pass 1: same id.
        for (n in news) {
            val id = n.page["id"]
            if (!JsJson.truthy(id)) continue
            val o = olds.firstOrNull { !it.matched && JsJson.strictEquals(it.page["id"], id) }
            if (o != null) pair(o, n)
        }
        // Pass 2: identical content.
        for (n in news) {
            if (n.matched) continue
            val key = pageContentKey(n.page)
            val o = olds.firstOrNull { !it.matched && pageContentKey(it.page) == key }
            if (o != null) pair(o, n)
        }
        // Pass 3: most similar Chinese text above a threshold.
        for (n in news) {
            if (n.matched) continue
            var best: Located? = null
            var bestScore = 0.0
            for (o in olds) {
                if (o.matched) continue
                val score = pageSimilarity(o.page, n.page)
                if (score > bestScore) { best = o; bestScore = score }
            }
            if (best != null && bestScore >= SIMILARITY_THRESHOLD) pair(best, n)
        }

        val pages = mutableListOf<ReaderPageDiffEntry>()
        for ((o, n) in pairs) {
            val fields = pageFieldChanges(o.page, n.page)
            if (fields.isNotEmpty()) pages += ReaderPageDiffEntry.Changed(o.index, n.index, o.page, n.page, fields)
            else if (o.index != n.index) pages += ReaderPageDiffEntry.Moved(o.index, n.index, n.page)
        }
        for (n in news) if (!n.matched) pages += ReaderPageDiffEntry.Added(n.index, n.page)
        for (o in olds) if (!o.matched) pages += ReaderPageDiffEntry.Removed(o.index, o.page)
        val sorted = pages.sortedWith(compareBy<ReaderPageDiffEntry> { it.index }.thenBy { it.kind })
        return ReaderDiffResult(meta.isNotEmpty() || sorted.isNotEmpty(), meta, sorted)
    }

    private val FIELD_LABELS = mapOf(
        "title_chinese" to "Chinese title",
        "title_english" to "English title",
        "difficulty_level" to "difficulty",
        "topic" to "topic",
        "content_chinese" to "Chinese",
        "content_pinyin" to "pinyin",
        "content_english" to "English",
        "image_prompt" to "illustration prompt",
    )

    fun fieldLabel(field: String): String = FIELD_LABELS[field] ?: field

    private fun short(v: JsonElement?) = JsJson.short(v, 40)

    /** formatReaderDiff. */
    fun format(diff: ReaderDiffResult): List<String> {
        val lines = mutableListOf<String>()
        for (m in diff.meta) lines += "${fieldLabel(m.field)}: \"${short(m.before)}\" → \"${short(m.after)}\""
        for (p in diff.pages) lines += when (p) {
            is ReaderPageDiffEntry.Added -> "Page ${p.index + 1}: added \"${short(p.page["content_chinese"])}\""
            is ReaderPageDiffEntry.Removed -> "Page ${p.index + 1}: removed \"${short(p.page["content_chinese"])}\""
            is ReaderPageDiffEntry.Moved -> "Page ${p.index + 1}: moved here from page ${p.fromIndex + 1} (\"${short(p.page["content_chinese"])}\")"
            is ReaderPageDiffEntry.Changed -> {
                val fields = p.fields.joinToString("; ") { f -> "${fieldLabel(f.field)} \"${short(f.before)}\" → \"${short(f.after)}\"" }
                val moved = if (p.fromIndex != p.index) " (was page ${p.fromIndex + 1})" else ""
                "Page ${p.index + 1}$moved: changed — $fields"
            }
        }
        return lines
    }
}

object ReaderExport {
    private val DIFFICULTY_LABELS = mapOf("beginner" to "Beginner", "elementary" to "Elementary", "intermediate" to "Intermediate", "advanced" to "Advanced")

    fun difficultyLabel(level: String): String = DIFFICULTY_LABELS[level] ?: level

    private fun s(o: JsonObject, k: String): String = str(o[k]) ?: ""
    private fun trimmed(o: JsonObject, k: String): String = JsJson.trim(s(o, k))
    private fun pagesOf(spec: JsonObject) = (spec["pages"] as? JsonArray).orEmpty().map { it as? JsonObject ?: JsonObject(emptyMap()) }

    data class VocabItem(val hanzi: String, val pinyin: String, val english: String)

    /** readerVocabRows: deduplicated by hanzi, blank entries dropped. */
    fun vocabRows(spec: JsonObject): List<VocabItem> {
        val seen = HashSet<String>()
        val rows = mutableListOf<VocabItem>()
        for (v in (spec["vocabulary_used"] as? JsonArray).orEmpty()) {
            val o = v as? JsonObject ?: continue
            val hanzi = trimmed(o, "hanzi")
            if (hanzi.isEmpty() || hanzi in seen) continue
            seen += hanzi
            rows += VocabItem(hanzi, trimmed(o, "pinyin"), trimmed(o, "english"))
        }
        return rows
    }

    fun toMarkdown(spec: JsonObject): String {
        val pages = pagesOf(spec)
        val lines = mutableListOf("# ${s(spec, "title_chinese")}", "", "*${s(spec, "title_english")}*")
        val metaBits = mutableListOf(difficultyLabel(s(spec, "difficulty_level")))
        if (trimmed(spec, "topic").isNotEmpty()) metaBits += "Topic: ${trimmed(spec, "topic")}"
        metaBits += "${pages.size} page${if (pages.size == 1) "" else "s"}"
        lines += listOf("", metaBits.joinToString(" · "))
        pages.forEachIndexed { i, page ->
            lines += listOf("", "## ${i + 1}", "")
            lines += trimmed(page, "content_chinese")
            if (trimmed(page, "content_pinyin").isNotEmpty()) lines += listOf("", "*${trimmed(page, "content_pinyin")}*")
            if (trimmed(page, "content_english").isNotEmpty()) lines += listOf("", trimmed(page, "content_english"))
            if (trimmed(page, "image_prompt").isNotEmpty()) lines += listOf("", "> Illustration: ${trimmed(page, "image_prompt")}")
        }
        val vocab = vocabRows(spec)
        if (vocab.isNotEmpty()) {
            lines += listOf("", "---", "", "## Glossary", "", "| 中文 | Pinyin | English |", "|---|---|---|")
            for (v in vocab) lines += "| ${v.hanzi} | ${v.pinyin} | ${v.english} |"
        }
        return lines.joinToString("\n").replace(Regex("\n{3,}"), "\n\n") + "\n"
    }

    /** readerToExportSpec: page ids and image keys stripped, blanks normalised. */
    fun toExportSpec(spec: JsonObject): JsonObject {
        val m = LinkedHashMap<String, JsonElement>()
        spec["title_chinese"]?.let { m["title_chinese"] = it }
        spec["title_english"]?.let { m["title_english"] = it }
        spec["difficulty_level"]?.let { m["difficulty_level"] = it }
        m["topic"] = spec["topic"] ?: JsonNull
        m["vocabulary_used"] = JsonArray(vocabRows(spec).map { JsJson.obj("hanzi" to JsJson.s(it.hanzi), "pinyin" to JsJson.s(it.pinyin), "english" to JsJson.s(it.english)) })
        m["pages"] = JsonArray(pagesOf(spec).map { p ->
            val pm = LinkedHashMap<String, JsonElement>()
            p["content_chinese"]?.let { pm["content_chinese"] = it }
            pm["content_pinyin"] = p["content_pinyin"]?.takeIf { it !is JsonNull } ?: JsJson.s("")
            pm["content_english"] = p["content_english"]?.takeIf { it !is JsonNull } ?: JsJson.s("")
            pm["image_prompt"] = if (trimmed(p, "image_prompt").isNotEmpty()) p["image_prompt"]!! else JsonNull
            JsonObject(pm)
        })
        return JsonObject(m)
    }

    fun toJson(spec: JsonObject): String = JsJson.stringifyPretty(toExportSpec(spec)) + "\n"

    fun toCsv(spec: JsonObject): String {
        val lines = mutableListOf("hanzi,pinyin,english")
        for (row in vocabRows(spec)) lines += listOf(row.hanzi, row.pinyin, row.english).joinToString(",") { LessonExport.csvEscape(it) }
        return lines.joinToString("\n") + "\n"
    }

    /** readerExportFilename. */
    fun filename(spec: JsonObject, ext: String): String {
        val en = s(spec, "title_english")
        return LessonExport.exportBase(en.ifEmpty { s(spec, "title_chinese") }, "reader") + ".$ext"
    }
}
