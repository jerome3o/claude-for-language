package dev.jeromeswannack.chineselearning.lab.ui.settings

import android.util.Base64
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ConversationVoice
import dev.jeromeswannack.chineselearning.lab.core.ConversationVoices
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationVoiceSettingsDto
import dev.jeromeswannack.chineselearning.lab.data.api.conversationVoiceSample
import dev.jeromeswannack.chineselearning.lab.data.api.conversationVoiceSettings
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveConversationVoices
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationVoiceCache
import dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationAudioCache
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationAudioViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.conversationAudio
import dev.jeromeswannack.chineselearning.lab.data.api.updateConversationAudio
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudio
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudioPrefs
import dev.jeromeswannack.chineselearning.lab.core.TtsConversation
import androidx.compose.foundation.layout.height
import androidx.compose.ui.platform.testTag
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Settings → Conversation voices (web: pages/ConversationVoicesPage.tsx, `/settings/voices`). */
data class ConversationVoicesUi(
    val enabled: List<String> = ConversationVoices.DEFAULT_IDS,
    /** Server state known (else the cached / shipped selection is shown). */
    val loaded: Boolean = false,
    val customised: Boolean = false,
    /** "admin" | "app" — whose selection "default" means. */
    val defaultSource: String = "app",
    val isAdmin: Boolean = false,
    val speed: Double = ConversationVoices.SPEED,
    val notice: String? = null,
    val noticeKind: NoticeKind = NoticeKind.Info,
    val loadingSample: String? = null,
    val playing: String? = null,
    val gender: String = "all",
    val style: String = "all",
    val accent: String = "all",
    val onlyOn: Boolean = false,
    /** Conversation speed + delivery (the same preferences as the ⚙︎ Audio menu on an exercise). */
    val audio: ConversationAudioDefaultsUi = ConversationAudioDefaultsUi(),
)

/** Settings → Conversation voices → speed + delivery (web: components/lesson/ConversationAudioDefaults.tsx). */
data class ConversationAudioDefaultsUi(
    val provider: String = "minimax",
    val providerName: String = TtsConversation.PROVIDER_NAMES.getValue("minimax"),
    /** The effective speed (the provider's rate, clamped). */
    val speed: Double = TtsConversation.DEFAULT_CONVERSATION_RATES.getValue("minimax"),
    val isDefault: Boolean = true,
    val steps: List<Double> = TtsConversation.speedSteps("minimax"),
    val delivery: String = "natural",
    /** Server answered (else the phone's cached settings, read-only). */
    val loaded: Boolean = false,
    val error: String? = null,
)

class ConversationVoicesActions(
    val onBack: (() -> Unit)? = null,
    val toggle: (String) -> Unit = {},
    val play: (String) -> Unit = {},
    val setGender: (String) -> Unit = {},
    val setStyle: (String) -> Unit = {},
    val setAccent: (String) -> Unit = {},
    val setOnlyOn: (Boolean) -> Unit = {},
    val reset: () -> Unit = {},
    val dismissNotice: () -> Unit = {},
    val setAudioSpeed: (Double?) -> Unit = {},
    val setAudioDelivery: (String) -> Unit = {},
)

/** The pure rules of the page (unit-tested; same as the web page). */
object VoiceSettingsLogic {
    val AGE = mapOf("child" to "Child", "young" to "Young", "adult" to "Adult", "senior" to "Older")
    val STYLE = mapOf(
        "newsreader" to "Newsreader", "neutral" to "Neutral", "warm" to "Warm",
        "youthful" to "Youthful", "soft" to "Soft / breathy", "character" to "Character",
    )
    val ACCENT = mapOf("standard" to "Standard Mandarin", "southern" to "Southern accent", "hong_kong" to "Hong Kong accent")
    val FAMILY = mapOf("mandarin" to "Mandarin series", "classic" to "Classic series")

    fun meta(v: ConversationVoice) = listOf(AGE[v.age], STYLE[v.style], ACCENT[v.accent], FAMILY[v.family]).joinToString(" · ")

    /** Turning [id] on / off: the new selection, or the reason it can't be (the last voice of a gender). */
    fun toggle(enabled: List<String>, id: String): Pair<List<String>?, String?> {
        val next = if (id in enabled) enabled - id else enabled + id
        val sel = ConversationVoices.validate(next)
        return if (sel.problems.isNotEmpty()) null to sel.problems.first() else sel.enabled to null
    }

    fun filter(ui: ConversationVoicesUi): List<ConversationVoice> = ConversationVoices.ALL.filter {
        (ui.gender == "all" || it.gender == ui.gender) &&
            (ui.style == "all" || it.style == ui.style) &&
            (ui.accent == "all" || it.accent == ui.accent) &&
            (!ui.onlyOn || it.id in ui.enabled)
    }

    fun onCount(enabled: List<String>, gender: String) = ConversationVoices.ALL.count { it.gender == gender && it.id in enabled }

    fun scopeLine(ui: ConversationVoicesUi): String = when {
        ui.isAdmin -> "You’re the admin: your choice is the default for everyone who hasn’t picked their own."
        ui.customised -> "Using your own choice."
        ui.defaultSource == "admin" -> "Using the default chosen by the admin."
        else -> "Using the app’s default voices."
    }
}

@Composable
fun ConversationVoicesScreen(ui: ConversationVoicesUi, actions: ConversationVoicesActions) {
    val shown = VoiceSettingsLogic.filter(ui)
    LabScreen(title = "Conversation voices", onBack = actions.onBack) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "The voices that speak the two-person conversations in your lessons. Tap ▶ to hear one; switch off any you don’t want. At least one female and one male voice stay on.",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
                Text(VoiceSettingsLogic.scopeLine(ui), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            }
        }
        item { ConversationAudioDefaults(ui.audio, actions) }
        ui.notice?.let { n -> item { InlineNotice(n, kind = ui.noticeKind, actionLabel = "OK", onAction = actions.dismissNotice) } }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ChipRow {
                    listOf("all" to "All", "female" to "👩 Female", "male" to "👨 Male").forEach { (g, label) ->
                        LabChip(label, selected = ui.gender == g) { actions.setGender(g) }
                    }
                    LabChip("On only", selected = ui.onlyOn) { actions.setOnlyOn(!ui.onlyOn) }
                }
                ChipRow {
                    LabChip("Any style", selected = ui.style == "all") { actions.setStyle("all") }
                    ConversationVoices.ALL.map { it.style }.distinct().forEach { s ->
                        LabChip(VoiceSettingsLogic.STYLE[s] ?: s, selected = ui.style == s) { actions.setStyle(s) }
                    }
                }
                ChipRow {
                    LabChip("Any accent", selected = ui.accent == "all") { actions.setAccent("all") }
                    ConversationVoices.ALL.map { it.accent }.distinct().forEach { a ->
                        LabChip(VoiceSettingsLogic.ACCENT[a] ?: a, selected = ui.accent == a) { actions.setAccent(a) }
                    }
                }
            }
        }
        for ((gender, title) in listOf("female" to "Female voices", "male" to "Male voices")) {
            val rows = shown.filter { it.gender == gender }
            if (rows.isEmpty()) continue
            item(key = "h-$gender") {
                SectionHeader(title, trailing = {
                    Text("${VoiceSettingsLogic.onCount(ui.enabled, gender)} on", color = Palette.Good, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(end = 4.dp))
                })
            }
            item(key = "c-$gender") {
                LabCard {
                    rows.forEachIndexed { i, v ->
                        if (i > 0) RowDivider()
                        VoiceRow(v, ui, actions)
                    }
                }
            }
        }
        if (shown.isEmpty()) item { Text("No voices match these filters.", color = Lab.colors.muted) }
        if (ui.loaded && ui.customised) {
            item {
                SecondaryPill(if (ui.isAdmin) "Back to the app’s shipped defaults" else "Use the default voices", Modifier.fillMaxWidth(), onClick = actions.reset)
            }
        }
    }
}

@Composable
fun ConversationAudioDefaults(a: ConversationAudioDefaultsUi, actions: ConversationVoicesActions) {
    fun x(v: Double) = "${ConversationAudio.speedLabel(v)}×"
    LabCard {
        Column(Modifier.fillMaxWidth().padding(14.dp).testTag("conversation-audio-defaults"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("Conversation speed", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 16.sp)
                Text("  ${x(a.speed)}${if (a.isDefault) " (default)" else ""}", color = Lab.colors.accent, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
            ChipRow {
                for (s in a.steps) LabChip(x(s), selected = a.speed == s, enabled = a.loaded) { actions.setAudioSpeed(s) }
                if (!a.isDefault) LabChip("Default", enabled = a.loaded) { actions.setAudioSpeed(null) }
            }
            Text(
                "Audio comes from ${a.providerName} right now; 1× is its natural pace. Change it, the voices and the delivery on any conversation with ⚙︎.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
            Spacer(Modifier.height(4.dp))
            Text("Delivery", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 16.sp)
            ChipRow {
                for (d in TtsConversation.DELIVERIES) {
                    LabChip(TtsConversation.DELIVERY_LABELS[d] ?: d, selected = a.delivery == d, enabled = a.loaded) { actions.setAudioDelivery(d) }
                }
            }
            a.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again) }
        }
    }
}

@Composable
private fun VoiceRow(v: ConversationVoice, ui: ConversationVoicesUi, actions: ConversationVoicesActions) {
    val on = v.id in ui.enabled
    val playing = ui.playing == v.id
    val loading = ui.loadingSample == v.id
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (playing) Lab.colors.accent else Lab.colors.accentSoft)
                .border(1.dp, if (playing) Color.Transparent else Lab.colors.faint, CircleShape)
                .bouncyClickable(!loading) { actions.play(v.id) }
                .semantics { contentDescription = "${if (playing) "Stop" else "Play"} a sample of ${v.name}" },
            contentAlignment = Alignment.Center,
        ) {
            Text(if (loading) "…" else if (playing) "■" else "▶", color = if (playing) Color.White else Lab.colors.accent, fontSize = 16.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(v.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = if (on) Lab.colors.ink else Lab.colors.muted)
            Text(VoiceSettingsLogic.meta(v), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            Text(v.note, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink.copy(alpha = 0.8f))
        }
        Spacer(Modifier.width(8.dp))
        val last = on && VoiceSettingsLogic.onCount(ui.enabled, v.gender) == 1
        Switch(
            checked = on,
            onCheckedChange = { actions.toggle(v.id) },
            colors = SwitchDefaults.colors(checkedTrackColor = Palette.Good),
            modifier = Modifier.alpha(if (last) 0.6f else 1f).semantics { contentDescription = "Use ${v.name} in conversations" },
        )
    }
}

class ConversationVoicesViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(ConversationVoicesUi())
    val ui: StateFlow<ConversationVoicesUi> = _ui
    private val runtime = LessonRuntime.of(app)
    private val sampleDir = File(app.filesDir, "voice-samples").apply { mkdirs() }
    private var saveSeq = 0

    init {
        viewModelScope.launch {
            ConversationVoiceCache.get(app.cache)?.let { cached -> _ui.update { it.copy(enabled = cached) } }
            val cachedAudio = ConversationAudioCache.get(app.cache)
            _ui.update { it.copy(audio = audioUi(cachedAudio.provider, cachedAudio.providerName, cachedAudio.prefs, cachedAudio.defaultSpeed, null, loaded = false)) }
            launch { loadAudio() }
            load()
        }
        viewModelScope.launch {
            runtime.audio.playing.collect { label ->
                _ui.update { it.copy(playing = label?.removePrefix(SAMPLE)?.takeIf { label.startsWith(SAMPLE) }) }
            }
        }
    }

    private suspend fun load() {
        try {
            val s = withContext(Dispatchers.IO) { app.repo.api.conversationVoiceSettings() }
            apply(s)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            notice(if (!app.online.value) "You’re offline — showing the voices saved on this phone." else "Couldn’t load your voices. ${e.userMessage()}", NoticeKind.Warning)
        }
    }

    private fun audioUi(provider: String, providerName: String, prefs: ConversationAudioPrefs, defaultSpeed: Double, steps: List<Double>?, loaded: Boolean, error: String? = null) =
        ConversationAudioDefaultsUi(
            provider = provider,
            providerName = providerName,
            speed = TtsConversation.clampRate(provider, prefs.speed ?: defaultSpeed),
            isDefault = prefs.speed == null,
            steps = steps?.takeIf { it.isNotEmpty() } ?: TtsConversation.speedSteps(provider),
            delivery = prefs.delivery,
            loaded = loaded,
            error = error,
        )

    private suspend fun applyAudio(v: ConversationAudioViewDto) {
        ConversationAudioCache.put(app.cache, v)
        val provider = v.provider.takeIf { it in TtsConversation.PROVIDERS } ?: "minimax"
        _ui.update {
            it.copy(audio = audioUi(provider, v.provider_name ?: TtsConversation.PROVIDER_NAMES.getValue(provider), ConversationAudio.fromJson(v.prefs), v.default_speed ?: TtsConversation.DEFAULT_CONVERSATION_RATES.getValue(provider), v.speed_steps, loaded = true))
        }
    }

    private suspend fun loadAudio() {
        try {
            applyAudio(withContext(Dispatchers.IO) { app.repo.api.conversationAudio() })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(audio = it.audio.copy(error = "Speed settings need a connection")) }
        }
    }

    private fun saveAudio(update: JsonObject) {
        _ui.update { it.copy(audio = it.audio.copy(error = null)) }
        app.haptics.tick()
        viewModelScope.launch {
            try {
                applyAudio(withContext(Dispatchers.IO) { app.repo.api.updateConversationAudio(update) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = (e as? HttpException)?.problems()?.firstOrNull() ?: "Could not save — check your connection"
                _ui.update { it.copy(audio = it.audio.copy(error = msg)) }
            }
        }
    }

    fun setAudioSpeed(speed: Double?) {
        val a = _ui.value.audio
        if (speed != null) Analytics.track("lesson.conversation_audio_speed", mapOf("speed" to speed, "provider" to a.provider, "source" to "settings"))
        saveAudio(JsonObject(mapOf("speed" to (speed?.let { JsonPrimitive(it) } ?: JsonNull))))
    }

    fun setAudioDelivery(delivery: String) {
        Analytics.track("lesson.conversation_audio_delivery", mapOf("delivery" to delivery, "provider" to _ui.value.audio.provider, "source" to "settings"))
        saveAudio(JsonObject(mapOf("delivery" to JsonPrimitive(delivery))))
    }

    private suspend fun apply(s: ConversationVoiceSettingsDto) {
        ConversationVoiceCache.put(app.cache, s.enabled)
        _ui.update { it.copy(enabled = s.enabled, loaded = true, customised = s.customised, defaultSource = s.default_source, isAdmin = s.is_admin, speed = s.speed) }
    }

    private fun notice(text: String?, kind: NoticeKind = NoticeKind.Info) = _ui.update { it.copy(notice = text, noticeKind = kind) }

    fun toggle(id: String) {
        val (next, problem) = VoiceSettingsLogic.toggle(_ui.value.enabled, id)
        if (next == null) {
            notice(problem)
            app.haptics.wrong()
            return
        }
        app.haptics.tick()
        save(next)
    }

    fun reset() = save(null)

    private fun save(next: List<String>?) {
        val previous = _ui.value.enabled
        val seq = ++saveSeq
        if (next != null) _ui.update { it.copy(enabled = next) }
        viewModelScope.launch {
            try {
                val saved = withContext(Dispatchers.IO) { app.repo.api.saveConversationVoices(next) }
                if (seq != saveSeq) return@launch
                apply(saved)
                if (next == null) notice("Back to the default voices", NoticeKind.Success)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (seq != saveSeq) return@launch
                _ui.update { it.copy(enabled = previous) }
                val msg = (e as? HttpException)?.problems()?.firstOrNull() ?: if (!app.online.value) "Couldn’t save — you’re offline." else "Couldn’t save. ${e.userMessage()}"
                notice(msg, NoticeKind.Error)
            }
        }
    }

    fun play(id: String) {
        if (_ui.value.playing == id) {
            runtime.audio.stop()
            return
        }
        viewModelScope.launch {
            val file = File(sampleDir, id.replace(Regex("[^A-Za-z0-9_-]+"), "_") + "-v1.mp3")
            if (!file.exists() || file.length() == 0L) {
                _ui.update { it.copy(loadingSample = id) }
                try {
                    val res = withContext(Dispatchers.IO) { app.repo.api.conversationVoiceSample(id) }
                    withContext(Dispatchers.IO) { file.writeBytes(Base64.decode(res.audio_base64, Base64.DEFAULT)) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    notice(if (!app.online.value) "Samples need a connection the first time." else "No sample for this voice: ${e.userMessage()}", NoticeKind.Error)
                    return@launch
                } finally {
                    _ui.update { it.copy(loadingSample = null) }
                }
            }
            runtime.audio.playFileFor(SAMPLE + id, file)
        }
    }

    fun setGender(g: String) = _ui.update { it.copy(gender = g) }
    fun setStyle(s: String) = _ui.update { it.copy(style = s) }
    fun setAccent(a: String) = _ui.update { it.copy(accent = a) }
    fun setOnlyOn(v: Boolean) = _ui.update { it.copy(onlyOn = v) }
    fun dismissNotice() = notice(null)

    override fun onCleared() {
        if (_ui.value.playing != null) runtime.audio.stop()
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ConversationVoicesViewModel(app) as T
    }

    private companion object {
        const val SAMPLE = "voice-sample:"
    }
}
