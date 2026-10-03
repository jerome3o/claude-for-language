package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.content.SharedPreferences
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

/** Where the call layout is remembered (SharedPreferences on the phone; a map in tests). */
interface CallLayoutStore {
    fun load(key: String): String?
    fun save(key: String, value: String)
}

class PrefsCallLayoutStore(private val prefs: SharedPreferences) : CallLayoutStore {
    override fun load(key: String): String? = prefs.getString(key, null)
    override fun save(key: String, value: String) { prefs.edit().putString(key, value).apply() }
}

/**
 * The call's tile layout (core CallLayout), as CallPage.tsx keeps it: remembered per user on this
 * device under the web's key (`call-layout-v1:<userId>`, the same JSON), changed by layout actions
 * or replaced whole (a phone swipe), and switched to the shared screen (faces together over it, unless
 * the user keeps the cameras separate) when the other person starts sharing. Lives in the call's ViewModel, so unfolding the Fold keeps it.
 */
class CallLayoutHolder(private val store: CallLayoutStore? = null, initial: CallLayout.Layout = CallLayout.DEFAULT_LAYOUT) {
    private val _layout = MutableStateFlow(initial)
    val layout: StateFlow<CallLayout.Layout> = _layout.asStateFlow()
    private var key: String? = null
    private var remoteSharing = false
    private var presentingId: String? = null
    private var activityId: String? = null

    /** Loads this user's last layout (web loadLayout); anything odd falls back to the default. */
    fun bind(userId: String) {
        if (userId.isBlank()) return
        val k = layoutKey(userId)
        if (k == key) return
        key = k
        val raw = store?.load(k)
        _layout.value = CallLayout.sanitize(raw?.let { runCatching { Json.parseToJsonElement(it) }.getOrNull() })
        // Already sharing when the layout arrived: their screen goes on the stage.
        if (remoteSharing) set(CallLayout.reduce(_layout.value, CallLayout.Action.ShareStarted))
        if (presentingId != null) set(CallLayout.reduce(_layout.value, CallLayout.Action.MaterialStarted))
        if (activityId != null) set(CallLayout.reduce(_layout.value, CallLayout.Action.ActivityStarted))
    }

    fun dispatch(action: CallLayout.Action) = set(CallLayout.reduce(_layout.value, action))

    fun replace(layout: CallLayout.Layout) = set(layout)

    /**
     * Round 4: the long-press menu / the "📝 + 🖥️" chip — the shared screen and a board together (or
     * either alone), as the web's `drop` actions ([ScreenBoardSplit.actions]). Saved once. Returns
     * whether the layout changed (the screen gives a light haptic then).
     */
    fun applySplit(choice: ScreenBoardSplit.Choice, board: CallLayout.TileId, content: CallLayout.TileId = CallLayout.TileId.SCREEN): Boolean {
        val before = _layout.value
        val next = ScreenBoardSplit.actions(before, choice, board, content).fold(before) { l, a -> CallLayout.reduce(l, a) }
        set(next)
        return next != before
    }

    /**
     * Their screen share starts: put it on the stage, both faces over it (or the two cameras separately,
     * when the user chose that — a remembered explicit choice wins). Only on the change.
     */
    fun setRemoteSharing(on: Boolean) {
        val was = remoteSharing
        remoteSharing = on
        if (on && !was) dispatch(CallLayout.Action.ShareStarted)
    }

    /**
     * Round 4 PR 5 (web CallPage's effect on `presenting.material_id`): a material someone starts presenting
     * — or another one — comes onto the stage like a shared screen; page turns change nothing.
     */
    fun setPresenting(materialId: String?) {
        val was = presentingId
        presentingId = materialId
        if (materialId != null && materialId != was) dispatch(CallLayout.Action.MaterialStarted)
    }

    /**
     * In-call activities (web CallPage's effect on `activity.session_id`): a new session — started by
     * either person, or one already running when I join — comes onto the stage; its rounds change nothing.
     */
    fun setActivity(sessionId: String?) {
        val was = activityId
        activityId = sessionId
        if (sessionId != null && sessionId != was) dispatch(CallLayout.Action.ActivityStarted)
    }

    private fun set(l: CallLayout.Layout) {
        if (l == _layout.value) return
        _layout.value = l
        key?.let { k -> runCatching { store?.save(k, l.toJson().toString()) } }
    }

    companion object {
        /** web CallPage `layoutKey`. */
        fun layoutKey(userId: String) = "call-layout-v1:$userId"
    }
}
