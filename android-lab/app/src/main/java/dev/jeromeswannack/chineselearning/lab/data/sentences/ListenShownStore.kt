package dev.jeromeswannack.chineselearning.lab.data.sentences

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * "Listen in context" on this phone (web services/listenShown.ts; rules in core ListenContext): the sentence
 * set the last showing of each word offered, so the next showing never offers the same set twice in a row
 * (`ListenContext.pick(previous = …)`). A per-device convenience in SharedPreferences — the heard history
 * itself is synced ([SentencePracticeStore.recordHeard]). In-memory when there is no Context (tests).
 */
object ListenShownStore {
    private const val PREFS = "listen-context-shown"
    private const val KEY = "shown-v1"
    private const val MAX_NOTES = 300
    private val memory = LinkedHashMap<String, List<String>>()

    private fun read(context: Context?): LinkedHashMap<String, List<String>> {
        if (context == null) return memory
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return LinkedHashMap()
        return runCatching {
            val o = JSONObject(raw)
            val out = LinkedHashMap<String, List<String>>()
            for (id in o.keys()) {
                val arr = o.optJSONArray(id) ?: continue
                out[id] = (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }
            }
            out
        }.getOrDefault(LinkedHashMap())
    }

    /** The keys the last showing of this note offered (empty = none known). */
    fun last(context: Context?, noteId: String): List<String> = synchronized(this) { read(context)[noteId].orEmpty() }

    /** Remember this showing's keys (the oldest notes are forgotten past [MAX_NOTES]). */
    fun remember(context: Context?, noteId: String, keys: List<String>) = synchronized(this) {
        val all = read(context)
        all.remove(noteId)
        all[noteId] = keys
        while (all.size > MAX_NOTES) all.remove(all.keys.first())
        if (context == null) return@synchronized
        val o = JSONObject()
        for ((id, ks) in all) o.put(id, JSONArray(ks))
        runCatching { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, o.toString()).apply() }
    }
}
