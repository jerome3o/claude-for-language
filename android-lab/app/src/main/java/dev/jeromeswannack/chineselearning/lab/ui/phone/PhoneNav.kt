package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.PickerDecks
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine.ScenarioResult
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEvent
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneScenarios
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneVocab
import dev.jeromeswannack.chineselearning.lab.core.phone.ScenarioSpec
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.PersonaReplyBody
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.api.personaReply
import dev.jeromeswannack.chineselearning.lab.data.phone.PhoneStore
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.readers.AddWordActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.AddWordSheet
import dev.jeromeswannack.chineselearning.lab.ui.readers.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/phone` and `/phone/:id` (web pages/PhonePracticePage.tsx, PhoneScenarioPage.tsx; docs/PHONE_PRACTICE.md). */
fun NavGraphBuilder.phoneGraph(nav: LabNav) {
    composable(Routes.route("/phone")) {
        val app = nav.app
        var statuses by remember { mutableStateOf<Map<String, PhoneStore.ScenarioStatus>>(emptyMap()) }
        LaunchedEffect(Unit) {
            val s = app.safely("phone statuses") { PhoneStore.statuses(app) } ?: emptyMap()
            statuses = s
            app.analytics.track("phone.open", mapOf("scenarios" to PhoneScenarios.all.size, "done" to s.values.count { it.done }))
        }
        PhonePracticeScreen(statuses, onBack = nav::back, onOpen = { nav.open(Routes.phoneScenario(it)) })
    }
    composable(Routes.route("/phone/{id}")) { entry ->
        PhoneScenarioRoute(nav, entry.arguments?.getString("id").orEmpty())
    }
}

private val ORDER = listOf("rail", "ride", "food", "chat", "movie", "dine")

/** The task list, grouped by app, easy → hard, with this phone's status (done, best time, in progress). */
@Composable
fun PhonePracticeScreen(statuses: Map<String, PhoneStore.ScenarioStatus>, onBack: () -> Unit, onOpen: (String) -> Unit) {
    LabScreen("📱 Phone practice", onBack = onBack) {
        item {
            Text(
                "Real-life tasks on a simulated Chinese phone — book a train, call a car, order lunch, pay a friend back. The apps are made up, but their screens, words and steps work like the real ones. Long-press any Chinese to look it up; 💡 shows the next step.",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        for (app in ORDER) {
            val list = PhoneScenarios.all.filter { it.apps.first() == app }
            if (list.isEmpty()) continue
            item(key = "app-$app") {
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    AppIcon(app, small = true, size = 30.dp)
                    Text(PhoneCopy.app(app).name, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                    Text(PhoneCopy.app(app).kindEn, fontSize = 13.sp, color = Lab.colors.muted)
                }
            }
            for (s in list) {
                item(key = s.id) {
                    val st = statuses[s.id]
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp))
                            .clickable { onOpen(s.id) }.padding(horizontal = 14.dp, vertical = 10.dp).testTag("phone-scenario-${s.id}"),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(s.title.en, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                            Text(s.title.zh, fontSize = 13.sp, color = Lab.colors.muted)
                        }
                        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            LevelPill(s.difficulty)
                            Text(
                                when {
                                    st?.done == true -> "✓ Done" + (st.bestMs?.let { " · best ${PhoneEngine.formatDuration(it)}" } ?: "")
                                    st?.inProgress == true -> "In progress"
                                    else -> "~${s.minutes ?: 5} min"
                                },
                                fontSize = 12.sp, color = if (st?.done == true) Color(0xFF16A34A) else Lab.colors.muted,
                            )
                        }
                    }
                }
            }
        }
        item { Text("Your plays are saved on this phone only. App names, shops, drivers and banks are all fictional.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp)) }
    }
}

private data class PlayState(val key: Int, val startedAt: Long, val events: List<PhoneEvent>, val hintsShown: Int, val resumed: Boolean)

private fun trackStart(app: LabApp, spec: ScenarioSpec, replay: Boolean) =
    app.analytics.track("phone.scenario_start", mapOf("scenario" to spec.id, "difficulty" to spec.difficulty, "app" to spec.apps.first(), "replay" to replay))

@Composable
private fun PhoneScenarioRoute(nav: LabNav, id: String) {
    val app = nav.app
    val spec = remember(id) { PhoneScenarios.byId(id) }
    if (spec == null) {
        LabScreen("Phone practice", onBack = nav::back) {
            item { Text("This task doesn't exist.", color = Lab.colors.ink) }
            item { PrimaryPill("All tasks", Modifier.height(48.dp)) { nav.open(Routes.phone()) } }
        }
        return
    }
    var play by remember { mutableStateOf<PlayState?>(null) }
    LaunchedEffect(spec.id) {
        val saved = app.safely("phone resume") { PhoneStore.loadCurrent(app, spec.id) }
        val now = System.currentTimeMillis()
        play = if (saved != null && saved.events.isNotEmpty() && now - saved.touched_at < PhoneStore.RESUME_WITHIN_MS) {
            // The clock and the timer carry on from where they were left.
            PlayState(1, saved.started_at + (now - saved.touched_at), saved.events, saved.hints_shown, true)
        } else {
            val statuses = app.safely("phone statuses") { PhoneStore.statuses(app) } ?: emptyMap()
            trackStart(app, spec, statuses[spec.id]?.done == true)
            PlayState(1, now, emptyList(), 0, false)
        }
    }
    val current = play
    if (current == null) {
        Box(Modifier.fillMaxSize().background(PC.bg))
        return
    }
    key(current.key) {
        PhonePlay(
            app, spec, current,
            onRestart = {
                app.scope.launch { PhoneStore.clearCurrent(app, spec.id) }
                play = PlayState(current.key + 1, System.currentTimeMillis(), emptyList(), 0, false)
                trackStart(app, spec, true)
            },
            onExit = nav::back,
        )
    }
}

private data class Finished(val result: ScenarioResult, val gaveUp: Boolean)

@Composable
private fun PhonePlay(app: LabApp, spec: ScenarioSpec, play: PlayState, onRestart: () -> Unit, onExit: () -> Unit) {
    val scope = rememberCoroutineScope()
    val runtime = remember {
        PhoneRuntime(
            spec, play.startedAt, play.events, scope,
            personaClient = PersonaClient { scenarioId, personaId, messages, context -> app.repo.api.personaReply(PersonaReplyBody(scenarioId, personaId, messages, context)) },
            track = { event, props -> app.analytics.track(event, props) },
        )
    }
    val online by app.online.collectAsStateWithLifecycle()
    LaunchedEffect(online) { runtime.online = online }
    var hintsShown by remember { mutableIntStateOf(play.hintsShown) }
    var finished by remember { mutableStateOf<Finished?>(null) }
    // Plain holders (not state): read in callbacks only.
    val flags = remember { object { var finished = false; var stopped = false; var dirty = false; var saveJob: Job? = null } }
    fun persist() {
        if (flags.finished || flags.stopped) return
        val save = PhoneStore.CurrentPlay(spec.id, play.startedAt, System.currentTimeMillis(), runtime.events, hintsShown)
        app.scope.launch { app.safely("phone save") { PhoneStore.saveCurrent(app, save) } }
    }
    DisposableEffect(runtime) {
        runtime.onEvents = {
            flags.dirty = true
            flags.saveJob?.cancel()
            flags.saveJob = scope.launch { delay(400); persist() }
        }
        onDispose {
            runtime.onEvents = {}
            // Leaving by the system back gesture: the play is kept like "Leave (progress kept)".
            if (flags.dirty) persist()
        }
    }
    fun finish(events: List<PhoneEvent>, gaveUp: Boolean) {
        if (flags.finished) return
        flags.finished = true
        val ended = System.currentTimeMillis()
        val result = PhoneEngine.scenarioResult(spec, events, play.startedAt, ended)
        app.scope.launch {
            app.safely("phone finish") {
                PhoneStore.savePlay(app, PhoneStore.StoredPlay("${spec.id}-$ended", spec.id, play.startedAt, ended, result, gaveUp))
                PhoneStore.clearCurrent(app, spec.id)
            }
        }
        app.analytics.track(
            "phone.scenario_finish",
            mapOf(
                "scenario" to spec.id, "success" to result.success, "gave_up" to gaveUp, "hints" to result.hints_used, "mistakes" to result.mistakes.size,
                "slips" to result.slips, "bonus" to result.bonus_done.size, "duration_bucket" to PhoneEngine.durationBucket(result.duration_ms),
            ),
        )
        finished = Finished(result, gaveUp)
    }
    val explorer = LocalExplorer.current
    var adding by remember { mutableStateOf<PhoneVocab?>(null) }
    var celebrate by remember { mutableStateOf(false) }
    val done = PhoneEngine.isComplete(spec, runtime.events)
    val announced = remember { booleanArrayOf(false) }
    LaunchedEffect(done) {
        if (!done || announced[0] || finished != null) return@LaunchedEffect
        announced[0] = true
        runtime.notify(spec.apps.first(), "✅ 任务完成", spec.goal.zh)
        celebrate = true
        app.sounds.play(Sounds.Sfx.FANFARE)
        app.haptics.celebrate()
        delay(1800)
        finish(runtime.events, false)
    }
    BackHandler(enabled = finished == null) { if (!runtime.back()) { persist(); onExit() } }
    Box(Modifier.fillMaxSize()) {
        PhonePlayLayout(
            runtime, spec, resumed = play.resumed, hintsShown = hintsShown,
            onHintsShown = { hintsShown = it; persist() },
            onWord = { item -> explorer?.open(item, "phone") },
            onGiveUp = { finish(runtime.events, !PhoneEngine.isComplete(spec, runtime.events)) },
            onRestart = { flags.stopped = true; onRestart() },
            onExit = { persist(); flags.stopped = true; onExit() },
        )
        if (celebrate) ConfettiRain(key = "phone-${spec.id}", colors = Palette.Confetti)
        finished?.let { f ->
            PhoneSummary(
                spec, f.result,
                onAgain = { flags.stopped = true; onRestart() },
                onList = { flags.stopped = true; onExit() },
                onKeepGoing = { flags.finished = false; finished = null; persist() },
                onAdd = { v ->
                    adding = v
                    app.analytics.track("phone.add_card", mapOf("scenario" to spec.id, "action" to "add"))
                },
            )
        }
        adding?.let { v ->
            val tools = remember(app) { CardTools(app) }
            AddWordSheet(
                SentenceChunkDto(hanzi = v.hanzi, pinyin = v.pinyin, english = v.english),
                AddWordActions(
                    decks = { withContext(Dispatchers.IO) { PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { DeckChoice(it.id, it.name, it.description) } } },
                    isDuplicate = { deckId, h -> tools.deckHas(deckId, h) },
                    add = { deckId, _ -> tools.addNote(deckId, NewNoteBody(v.hanzi, v.pinyin, v.english)) },
                ),
                onDismiss = { adding = null },
                bumpSource = "other",
            )
        }
    }
}

/**
 * The phone with its learning aids: full screen on a phone (task card as an overlay from 📋),
 * a phone-sized frame on a wide screen (≥ 640dp), the task card beside it from 900dp.
 */
@Composable
fun PhonePlayLayout(
    runtime: PhoneRuntime,
    spec: ScenarioSpec,
    resumed: Boolean,
    hintsShown: Int,
    onHintsShown: (Int) -> Unit,
    onWord: ((ExplorerItem) -> Unit)?,
    onGiveUp: () -> Unit,
    onRestart: () -> Unit,
    onExit: () -> Unit,
) {
    var taskOpen by remember { mutableStateOf(!resumed) }
    var hint by remember { mutableStateOf<Int?>(null) }
    fun showHint() {
        val idx = PhoneEngine.nextHintIndex(spec, runtime.events, hintsShown)
        if (idx == null) {
            hint = spec.hints.size - 1
            return
        }
        hint = idx
        runtime.emit("hint", mapOf("index" to idx))
        onHintsShown(idx + 1)
    }
    BoxWithConstraints(Modifier.fillMaxSize().testTag("phone-scenario-${spec.id}")) {
        val framed = maxWidth >= 640.dp
        Box(Modifier.fillMaxSize().background(if (framed) Color(0xFFE6E9EF) else PC.bg))
        val wide = maxWidth >= 900.dp
        val card: @Composable (Boolean) -> Unit = { inline ->
            TaskCard(spec, runtime.events, inline, onClose = if (inline) null else ({ taskOpen = false }), onGiveUp = onGiveUp, onRestart = onRestart, onExit = onExit)
        }
        val phone: @Composable (Modifier) -> Unit = { m ->
            Box(m) {
                PhoneStage(runtime, onWord, onTask = { if (!wide) taskOpen = !taskOpen }, onHint = ::showHint) {
                    PhoneBackHandler(!wide && taskOpen) { taskOpen = false }
                    PhoneBackHandler(hint != null) { hint = null }
                    if (!wide && taskOpen) {
                        Box(Modifier.fillMaxSize().background(Color(0x66000000)).clickable { taskOpen = false }.padding(14.dp), contentAlignment = Alignment.Center) {
                            Box(Modifier.clickable(enabled = false) {}) { card(false) }
                        }
                    }
                    hint?.let { h ->
                        Box(Modifier.align(Alignment.BottomCenter)) { HintBubble(spec, h, canNext = h < spec.hints.size - 1, onNext = ::showHint, onClose = { hint = null }) }
                    }
                }
            }
        }
        if (!framed) {
            phone(Modifier.fillMaxSize())
        } else {
            Row(Modifier.fillMaxSize().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                if (wide) Box(Modifier.width(340.dp).fillMaxHeight(), contentAlignment = Alignment.Center) { card(true) }
                phone(Modifier.width(390.dp).fillMaxHeight().clip(RoundedCornerShape(36.dp)).border(10.dp, Color(0xFF111111), RoundedCornerShape(36.dp)).padding(10.dp).clip(RoundedCornerShape(26.dp)))
            }
        }
    }
}

/** The simulated phone on its own (tests and screenshots drive it directly). */
@Composable
fun PhoneStage(p: PhoneRuntime, onWord: ((ExplorerItem) -> Unit)?, onTask: () -> Unit = {}, onHint: () -> Unit = {}, overlay: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit = {}) {
    var recents by remember { mutableStateOf(false) }
    CompositionLocalProvider(LocalPhone provides p, LocalPhoneWord provides onWord) {
        PhoneShell(p, onTask = onTask, onHint = onHint, recentsOpen = recents, setRecents = { recents = it }, overlay = overlay)
    }
}
