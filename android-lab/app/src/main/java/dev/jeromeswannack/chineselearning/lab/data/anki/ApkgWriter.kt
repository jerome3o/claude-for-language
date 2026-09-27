package dev.jeromeswannack.chineselearning.lab.data.anki

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiCollection
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiCollectionPlan
import dev.jeromeswannack.chineselearning.lab.core.anki.AnkiMediaFile
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Writes an Anki `.apkg` on the phone — the file half of `buildApkg` in
 * frontend/src/services/anki/apkg.ts. The rows come from [AnkiCollection.plan] (pure,
 * parity-tested against the web's sql.js output); this writes them into a real SQLite file with
 * the framework's SQLite (legacy schema 11, rollback journal — no WAL, so the single file is the
 * whole collection) and zips it with the `media` index and the numbered media files, in the
 * web's entry order.
 */
object ApkgWriter {
    class Written(val bytes: Long, val noteCount: Int, val cardCount: Int, val mediaCount: Int, val deckId: Long)

    /** Writes `collection.anki2` for [plan] at [file] (replacing it). */
    fun writeCollection(plan: AnkiCollectionPlan, file: File) {
        deleteDb(file)
        file.parentFile?.mkdirs()
        val db = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.NO_LOCALIZED_COLLATORS)
        try {
            db.disableWriteAheadLogging()
            db.beginTransaction()
            try {
                AnkiCollection.SCHEMA.forEach(db::execSQL)
                insert(db, "col", listOf(plan.col))
                insert(db, "notes", plan.notes)
                insert(db, "cards", plan.cards)
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        } finally {
            db.close()
        }
        File(file.path + "-journal").delete()
    }

    private fun insert(db: SQLiteDatabase, table: String, rows: List<List<Any>>) {
        if (rows.isEmpty()) return
        val stmt = db.compileStatement("INSERT INTO $table VALUES (${rows[0].joinToString(",") { "?" }})")
        try {
            for (row in rows) {
                stmt.clearBindings()
                row.forEachIndexed { i, v -> bind(stmt, i + 1, v) }
                stmt.executeInsert()
            }
        } finally {
            stmt.close()
        }
    }

    private fun bind(stmt: SQLiteStatement, index: Int, value: Any) = when (value) {
        is Long -> stmt.bindLong(index, value)
        is Int -> stmt.bindLong(index, value.toLong())
        is String -> stmt.bindString(index, value)
        is Double -> stmt.bindDouble(index, value)
        else -> error("Unsupported column value $value")
    }

    private fun deleteDb(file: File) {
        for (suffix in listOf("", "-journal", "-wal", "-shm")) File(file.path + suffix).delete()
    }

    /** The `media` index: `{"0": "a.mp3", "1": …}` exactly as the web writes it. */
    fun mediaIndex(media: List<AnkiMediaFile>): String =
        JsJson.stringify(JsonObject(media.withIndex().associate { (i, m) -> i.toString() to JsonPrimitive(m.filename) }))!!

    /** Builds the whole package at [out]: collection.anki2, then the media files "0", "1", …, then `media`. */
    fun writeApkg(plan: AnkiCollectionPlan, media: List<AnkiMediaFile>, out: File, workDir: File): Written {
        val collection = File(workDir, "collection-${System.nanoTime()}.anki2")
        try {
            writeCollection(plan, collection)
            val unique = LinkedHashMap<String, AnkiMediaFile>()
            for (m in media) if (m.filename !in unique) unique[m.filename] = m
            val files = unique.values.toList()
            out.parentFile?.mkdirs()
            val tmp = File(out.parentFile, out.name + ".part")
            ZipOutputStream(tmp.outputStream().buffered()).use { zip ->
                zip.setLevel(6)
                zip.putNextEntry(ZipEntry("collection.anki2"))
                collection.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
                files.forEachIndexed { i, m ->
                    zip.putNextEntry(ZipEntry(i.toString()))
                    zip.write(m.data)
                    zip.closeEntry()
                }
                zip.putNextEntry(ZipEntry("media"))
                zip.write(mediaIndex(files).toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
            if (!tmp.renameTo(out)) {
                out.delete()
                check(tmp.renameTo(out)) { "Couldn't write ${out.name}" }
            }
            return Written(out.length(), plan.noteCount, plan.cardCount, files.size, plan.deckId)
        } finally {
            deleteDb(collection)
        }
    }
}
