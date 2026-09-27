package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.decks.DeckWrites
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * What the Decks tab, the deck page and the card hub need, as plain values so the view
 * models run in tests without the Application (a Room in-memory db + MockWebServer).
 */
class DecksEnv(
    val dao: LabDao,
    val api: Api,
    val writes: DeckWrites,
    val cache: JsonCache,
    val online: StateFlow<Boolean>,
    /** Bumped when Room changed (sync, review, one of our writes). */
    val dataVersion: Flow<Int>,
    val budget: () -> StudyBudget = { StudyBudget.DEFAULT },
    val bonus: (scope: String, day: String) -> Int = { _, _ -> 0 },
    val setBonus: (scope: String, day: String, value: Int) -> Unit = { _, _, _ -> },
    /** users.role = tutor: the deck page offers "Try it as a student" instead of Study. */
    val isTutorAccount: () -> Boolean = { false },
    /** Pull everything again (after a delete / when the server knows more than the phone). */
    val requestSync: () -> Unit = {},
    val fx: DecksFx = DecksFx(),
    val nowMs: () -> Long = System::currentTimeMillis,
) {
    companion object {
        fun from(app: LabApp): DecksEnv {
            val writes = DeckWrites(
                dao = app.repo.dao,
                api = app.repo.api,
                outbox = app.outbox,
                online = { app.online.value },
                onLocalChange = { app.repo.notifyLocalChange() },
                afterWrite = { queued ->
                    if (queued) app.scheduleBackgroundUpload() else app.scope.launch { app.repo.sync() }
                },
            )
            return DecksEnv(
                dao = app.repo.dao,
                api = app.repo.api,
                writes = writes,
                cache = app.cache,
                online = app.online,
                dataVersion = app.repo.dataVersion,
                budget = { app.prefs.budget },
                bonus = { scope, day -> app.prefs.bonus(scope, day) },
                setBonus = { scope, day, v -> app.prefs.setBonus(scope, day, v) },
                isTutorAccount = { app.prefs.accountRole == "tutor" },
                requestSync = { app.scope.launch { app.repo.sync() } },
                fx = DecksFx(
                    tick = { app.haptics.tick() },
                    lift = { app.haptics.flip() },
                    drop = { app.haptics.correct(); app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.POP, 0.5f) },
                    success = { app.haptics.correct(); app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.CORRECT, 0.6f) },
                    failure = { app.haptics.wrong() },
                    playAudio = { key, text -> app.audio.play(key, text, app.online.value) },
                ),
            )
        }

        /** Offline-by-default env for previews / tests. */
        fun offline(dao: LabDao, api: Api, writes: DeckWrites, cache: JsonCache) =
            DecksEnv(dao, api, writes, cache, MutableStateFlow(false), MutableStateFlow(0))
    }
}

/** Feel: haptics and sounds for the moments that should feel good. */
class DecksFx(
    val tick: () -> Unit = {},
    val lift: () -> Unit = {},
    val drop: () -> Unit = {},
    val success: () -> Unit = {},
    val failure: () -> Unit = {},
    val playAudio: (key: String?, text: String) -> Unit = { _, _ -> },
)
