package dev.jeromeswannack.chineselearning.lab.core.anki

/** A media file for the package: its Anki file name and bytes. */
class AnkiMediaFile(val filename: String, val data: ByteArray)

/** What goes into the .apkg once audio is resolved: the notes (sound fields filled) and the media. */
data class AnkiPackageInput(
    val input: ApkgInput,
    val media: List<AnkiMediaFile>,
    val audioIncluded: Int,
    val audioMissing: Int,
)

/**
 * The pure half of `packageSource` in frontend/src/services/anki/index.ts: every [AudioRef] a
 * source's notes carry, deduped by key; then, with the clips the app resolved (cache first,
 * fetched when online), `[sound:<file>]` in the note's field and the file in the media list —
 * or the ref counted as missing. Without audio the notes go in unchanged.
 */
object AnkiPackager {
    /** `audioRefKey`: what dedupes refs across notes (the Lab's own cache keys differ from the web's). */
    fun key(ref: AudioRef): String = when (ref) {
        is AudioRef.R2 -> "r2:${ref.key}"
        is AudioRef.Tts -> "tts:${ref.text}"
        is AudioRef.ReaderPage -> "reader-page:${ref.pageId}:${ref.text}"
    }

    /** Every distinct ref, in first-seen order. */
    fun refs(source: AnkiSource): List<AudioRef> {
        val unique = LinkedHashMap<String, AudioRef>()
        for (note in source.notes) for (field in AnkiSources.AUDIO_FIELDS) note.audio?.get(field)?.let { unique[key(it)] = it }
        return unique.values.toList()
    }

    /**
     * [resolved] maps [key] → the clip; [missing] is how many refs had none (the web counts
     * unique refs, not fields).
     */
    fun assemble(source: AnkiSource, includeAudio: Boolean, resolved: Map<String, AnkiMediaFile>, missing: Int): AnkiPackageInput {
        if (!includeAudio) {
            return AnkiPackageInput(ApkgInput(source.deckName, source.description, source.notes.map { it.toNote(LinkedHashMap(it.fields)) }), emptyList(), 0, 0)
        }
        val media = LinkedHashMap<String, AnkiMediaFile>()
        var included = 0
        val notes = source.notes.map { note ->
            val fields = LinkedHashMap(note.fields)
            for (field in AnkiSources.AUDIO_FIELDS) {
                val ref = note.audio?.get(field) ?: continue
                val file = resolved[key(ref)] ?: continue
                fields[field] = "[sound:${file.filename}]"
                media[file.filename] = file
                included++
            }
            note.toNote(fields)
        }
        return AnkiPackageInput(ApkgInput(source.deckName, source.description, notes), media.values.toList(), included, missing)
    }
}
