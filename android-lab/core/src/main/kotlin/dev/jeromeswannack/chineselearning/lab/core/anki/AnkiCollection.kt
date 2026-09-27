package dev.jeromeswannack.chineselearning.lab.core.anki

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** `ApkgInput`. */
data class ApkgInput(val deckName: String, val deckDescription: String? = null, val notes: List<AnkiNote>)

/**
 * Every row of collection.anki2, as the values bound to `INSERT INTO col / notes / cards VALUES
 * (?,…)` — [Long] or [String]. The app writes them with SQLite (data/anki/ApkgWriter.kt); this
 * is the port of the row-building half of `buildCollection` in frontend/src/services/anki/apkg.ts,
 * parity-tested row by row against what sql.js writes on the web.
 */
data class AnkiCollectionPlan(
    val col: List<Any>,
    val notes: List<List<Any>>,
    val cards: List<List<Any>>,
    val deckId: Long,
) {
    val noteCount get() = notes.size
    val cardCount get() = cards.size
}

object AnkiCollection {
    /** Anki's legacy schema (collection version 11) — what genanki writes and every Anki imports. */
    val SCHEMA: List<String> = listOf(
        """CREATE TABLE col (
  id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null,
  conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
)""",
        """CREATE TABLE notes (
  id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null,
  csum integer not null, flags integer not null, data text not null
)""",
        """CREATE TABLE cards (
  id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null,
  due integer not null, ivl integer not null, factor integer not null, reps integer not null,
  lapses integer not null, left integer not null, odue integer not null, odid integer not null,
  flags integer not null, data text not null
)""",
        """CREATE TABLE revlog (
  id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null,
  type integer not null
)""",
        "CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null)",
        "CREATE INDEX ix_notes_usn on notes (usn)",
        "CREATE INDEX ix_cards_usn on cards (usn)",
        "CREATE INDEX ix_revlog_usn on revlog (usn)",
        "CREATE INDEX ix_cards_nid on cards (nid)",
        "CREATE INDEX ix_cards_sched on cards (did, queue, due)",
        "CREATE INDEX ix_revlog_cid on revlog (cid)",
        "CREATE INDEX ix_notes_csum on notes (csum)",
    )

    /** Collection creation time, fixed (like genanki) so due-days are relative to a known epoch. */
    const val COLLECTION_CRT = 1411124400L

    private const val DECK_ID_NAMESPACE = "chinese-learning-app:deck"
    private const val LATEX_PRE = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n"
    private const val LATEX_POST = "\\end{document}"

    /** `ankiDeckId(deckName)`. */
    fun deckId(deckName: String): Long = AnkiHash.stableId(DECK_ID_NAMESPACE, deckName)

    // ---- tiny JSON builders (JsJson.stringify writes them exactly as JSON.stringify) ----
    private fun obj(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(LinkedHashMap<String, JsonElement>().also { m -> for ((k, v) in pairs) m[k] = el(v) })
    private fun arr(vararg xs: Any?): JsonArray = JsonArray(xs.map { el(it) })
    private fun el(v: Any?): JsonElement = when (v) {
        null -> JsonNull
        is JsonElement -> v
        is String -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        is List<*> -> JsonArray(v.map { el(it) })
        else -> error("not JSON: $v")
    }

    /** A JS object whose keys are array indices is serialised in ascending numeric order. */
    private fun numericKeys(entries: List<Pair<Long, JsonElement>>): JsonObject =
        JsonObject(LinkedHashMap<String, JsonElement>().also { m -> for ((k, v) in entries.sortedBy { it.first }) m[k.toString()] = v })

    fun modelJson(model: AnkiModel, deckId: Long, modSecs: Long): JsonObject = obj(
        "id" to model.id,
        "name" to model.name,
        "type" to 0,
        "mod" to modSecs,
        "usn" to -1,
        "sortf" to 0,
        "did" to deckId,
        "tmpls" to model.templates.mapIndexed { ord, t ->
            obj("name" to t.name, "ord" to ord, "qfmt" to t.qfmt, "afmt" to t.afmt, "bqfmt" to "", "bafmt" to "", "did" to null, "bfont" to "", "bsize" to 0)
        },
        "flds" to model.fields.mapIndexed { ord, name ->
            obj("name" to name, "ord" to ord, "sticky" to false, "rtl" to false, "font" to "Arial", "size" to 20, "media" to emptyList<Any>())
        },
        "css" to model.css,
        "latexPre" to LATEX_PRE,
        "latexPost" to LATEX_POST,
        "latexsvg" to false,
        "req" to model.templates.mapIndexed { ord, t -> arr(ord, "all", t.requires.map { model.fields.indexOf(it) }) },
        "tags" to emptyList<Any>(),
        "vers" to emptyList<Any>(),
    )

    fun deckJson(id: Long, name: String, desc: String, modSecs: Long): JsonObject = obj(
        "id" to id, "name" to name, "desc" to desc, "mod" to modSecs, "usn" to -1,
        "collapsed" to false, "browserCollapsed" to false,
        "newToday" to arr(0, 0), "revToday" to arr(0, 0), "lrnToday" to arr(0, 0), "timeToday" to arr(0, 0),
        "dyn" to 0, "extendNew" to 0, "extendRev" to 0, "conf" to 1,
    )

    private val DEFAULT_DCONF: JsonObject = obj(
        "1" to obj(
            "id" to 1, "name" to "Default", "mod" to 0, "usn" to 0, "maxTaken" to 60, "autoplay" to true, "timer" to 0, "replayq" to true,
            "new" to obj("bury" to true, "delays" to arr(1, 10), "initialFactor" to 2500, "ints" to arr(1, 4, 7), "order" to 1, "perDay" to 20, "separate" to true),
            "rev" to obj("bury" to true, "ease4" to 1.3, "fuzz" to 0.05, "ivlFct" to 1, "maxIvl" to 36500, "minSpace" to 1, "perDay" to 200),
            "lapse" to obj("delays" to arr(10), "leechAction" to 0, "leechFails" to 8, "minInt" to 1, "mult" to 0),
            "dyn" to false,
        ),
    )

    /** `templateApplies`: every required field is non-empty (or holds a [sound:] tag) — Anki's `req`. */
    fun templateApplies(model: AnkiModel, ord: Int, fields: Map<String, String>): Boolean =
        model.templates[ord].requires.all { name ->
            val v = fields[name] ?: ""
            AnkiHash.stripHtmlMedia(v).isNotEmpty() || v.contains("[sound:")
        }

    private class CardRow(val type: Long, val queue: Long, val due: Long, val ivl: Long, val factor: Long, val reps: Long, val lapses: Long)

    private fun cardRow(progress: AnkiCardProgress?, newPosition: Long, todayDays: Long): CardRow {
        if (progress == null || progress.state == "new") {
            return CardRow(0, 0, newPosition, 0, 0, (progress?.reps ?: 0).toLong(), (progress?.lapses ?: 0).toLong())
        }
        // Learning cards become reviews due today with a 1-day interval (no faithful equivalent
        // of the app's sub-day steps in a foreign collection).
        val ivl = maxOf(1.0, Js.round(progress.intervalDays)).toLong()
        val due = todayDays + Js.round(if (progress.state == "learning") 0.0 else progress.dueInDays).toLong()
        return CardRow(2, 2, due, ivl, maxOf(1300.0, Js.round(progress.ease * 1000)).toLong(), progress.reps.toLong(), progress.lapses.toLong())
    }

    /** The rows of `buildCollection(input, { now })`. */
    fun plan(input: ApkgInput, now: Long): AnkiCollectionPlan {
        val nowSecs = Math.floorDiv(now, 1000L)
        val todayDays = Math.floorDiv(nowSecs - COLLECTION_CRT, 86400L)
        val deckId = deckId(input.deckName)

        val usedModels = LinkedHashMap<String, AnkiModel>()
        for (note in input.notes) usedModels[note.model] = AnkiModels.model(note.model)
        if (usedModels.isEmpty()) usedModels[AnkiModels.VOCABULARY_KEY] = AnkiModels.VOCABULARY

        val models = numericKeys(usedModels.values.map { it.id to modelJson(it, deckId, nowSecs) })
        val decks = numericKeys(listOf(1L to deckJson(1, "Default", "", nowSecs), deckId to deckJson(deckId, input.deckName, input.deckDescription ?: "", nowSecs)))
        val conf = obj(
            "activeDecks" to arr(deckId),
            "curDeck" to deckId,
            "curModel" to usedModels.values.first().id.toString(),
            "nextPos" to input.notes.size + 1,
            "addToCur" to true,
            "collapseTime" to 1200,
            "dueCounts" to true,
            "estTimes" to true,
            "newBury" to true,
            "newSpread" to 0,
            "sortBackwards" to false,
            "sortType" to "noteFld",
            "timeLim" to 0,
        )
        val col = listOf<Any>(
            1L, COLLECTION_CRT, now, now, 11L, 0L, 0L, 0L,
            JsJson.stringify(conf)!!, JsJson.stringify(models)!!, JsJson.stringify(decks)!!, JsJson.stringify(DEFAULT_DCONF)!!, "{}",
        )

        val noteRows = ArrayList<List<Any>>()
        val cardRows = ArrayList<List<Any>>()
        val seenGuids = HashSet<String>()
        input.notes.forEachIndexed { i, note ->
            if (!seenGuids.add(note.guid)) return@forEachIndexed // never write a duplicate GUID
            val model = AnkiModels.model(note.model)
            val values = model.fields.map { note.fields[it] ?: "" }
            val noteId = now + i
            val tags = note.tags?.takeIf { it.isNotEmpty() }?.let { t -> " ${t.joinToString(" ") { JsJson.replaceSpaceRuns(it, "_") }} " } ?: ""
            noteRows += listOf<Any>(
                noteId, note.guid, model.id, nowSecs, -1L, tags,
                values.joinToString("\u001f"), AnkiHash.stripHtmlMedia(values[0]), AnkiHash.fieldChecksum(values[0]), 0L, "",
            )
            model.templates.indices.forEach { ord ->
                if (!templateApplies(model, ord, note.fields)) return@forEach
                val row = cardRow(note.progress?.get(ord), (i + 1).toLong(), todayDays)
                cardRows += listOf<Any>(
                    now + 1_000_000L + cardRows.size, noteId, deckId, ord.toLong(), nowSecs, -1L,
                    row.type, row.queue, row.due, row.ivl, row.factor, row.reps, row.lapses, 0L, 0L, 0L, 0L, "",
                )
            }
        }
        return AnkiCollectionPlan(col, noteRows, cardRows, deckId)
    }
}
