package dev.jeromeswannack.chineselearning.lab.ui.editor

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.fx.Sounds

/** Feel for editor moments (no-op in tests). */
interface EditorFeedback {
    fun tick() {}
    fun success() {}
    fun error() {}

    companion object {
        val NONE = object : EditorFeedback {}
    }
}

/**
 * What the editor ViewModels need — the API, the offline cache (unsaved drafts live there) and
 * whether the phone is online — so tests can build them over MockWebServer + in-memory Room.
 */
class EditorDeps(
    val api: Api,
    val cache: JsonCache,
    val online: () -> Boolean,
    val feedback: EditorFeedback = EditorFeedback.NONE,
) {
    companion object {
        fun from(app: LabApp) = EditorDeps(
            api = app.repo.api,
            cache = app.cache,
            online = { app.online.value },
            feedback = object : EditorFeedback {
                override fun tick() = app.haptics.tick()
                override fun success() { app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP) }
                override fun error() = app.haptics.wrong()
            },
        )
    }
}
