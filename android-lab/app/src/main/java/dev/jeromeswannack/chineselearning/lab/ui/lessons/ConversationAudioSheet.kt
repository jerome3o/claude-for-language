package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudio
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudioContext
import dev.jeromeswannack.chineselearning.lab.core.ConversationAudioPrefs
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationSpeaker
import dev.jeromeswannack.chineselearning.lab.core.ConversationVoices
import dev.jeromeswannack.chineselearning.lab.core.ResolvedConversationAudio
import dev.jeromeswannack.chineselearning.lab.core.TtsConversation
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * The ⚙︎ Audio menu on a conversation exercise (web: components/lesson/ConversationAudioSheet.tsx;
 * docs/AUDIO.md "Conversation audio"): speed, a voice per speaker, delivery and "Regenerate
 * audio". Choices apply on this phone at once (cached prefs → new clip keys) and are saved to the
 * account. Offline the sheet shows the current settings, its controls are off and regenerating
 * says it needs internet — playback keeps using whatever is cached.
 */

/** One conversation as it plays now: the resolution + the prefs it came from + who speaks. */
data class ConversationAudioNow(
    val audio: ResolvedConversationAudio,
    val prefs: ConversationAudioPrefs = ConversationAudio.DEFAULT_PREFS,
    val providerName: String = TtsConversation.PROVIDER_NAMES[audio.provider] ?: audio.provider,
)

/** A voice the menu offers. */
data class ConversationAudioVoiceOption(val id: String, val name: String, val gender: String, val note: String)

/** What the server says the active provider offers (`GET /api/conversation-audio`), or the bundled catalogue. */
data class ConversationAudioOffer(
    val providerName: String,
    val speedSteps: List<Double>,
    val voices: List<ConversationAudioVoiceOption>,
) {
    companion object {
        /** Offline / before the server answers: the catalogue bundled with the app. */
        fun bundled(provider: String, providerName: String = TtsConversation.PROVIDER_NAMES[provider] ?: provider) = ConversationAudioOffer(
            providerName,
            TtsConversation.speedSteps(provider),
            TtsConversation.providerVoices(provider).map { ConversationAudioVoiceOption(it.id, it.name, it.gender, it.note) },
        )
    }
}

/**
 * Everything a conversation exercise needs for its audio settings; the player passes
 * [LabConversationAudioControls], screenshots and tests a fake (default: MiniMax defaults, offline).
 */
interface ConversationAudioControls {
    val online: StateFlow<Boolean>
    /** Bumped whenever the cached settings change (re-resolve). */
    val changes: StateFlow<Int>
    suspend fun resolve(ex: ConversationExercise): ConversationAudioNow
    /** `GET /api/conversation-audio` (writes the cache); null when it can't. */
    suspend fun refresh(): ConversationAudioOffer?
    /** Apply [update] on this phone at once and save it; the error sentence, or null. Returns the new offer when the server answered. */
    suspend fun save(update: JsonObject): Pair<String?, ConversationAudioOffer?>
    fun track(event: String, props: Map<String, Any?>) {}

    /** No account behind it: MiniMax's defaults, offline, nothing saved. */
    object Preview : ConversationAudioControls {
        override val online: StateFlow<Boolean> = MutableStateFlow(false)
        override val changes: StateFlow<Int> = MutableStateFlow(0)
        override suspend fun resolve(ex: ConversationExercise) = ConversationAudioNow(
            ConversationAudio.resolve(ex, ConversationAudioContext("minimax", TtsConversation.DEFAULT_CONVERSATION_RATES.getValue("minimax"))),
        )
        override suspend fun refresh(): ConversationAudioOffer? = null
        override suspend fun save(update: JsonObject): Pair<String?, ConversationAudioOffer?> = null to null
    }
}

/** The sheet's state for [ConversationAudioSheetContent] (stateless, screenshot-tested). */
data class ConversationAudioSheetUi(
    val speakers: List<ConversationSpeaker>,
    val now: ConversationAudioNow,
    val offer: ConversationAudioOffer,
    val online: Boolean,
    val regenerating: Boolean = false,
    val error: String? = null,
    /** Speaker index whose voice list is open. */
    val openSpeaker: Int? = null,
)

class ConversationAudioSheetActions(
    val setSpeed: (Double?) -> Unit = {},
    val setVoice: (index: Int, voice: String?) -> Unit = { _, _ -> },
    val setDelivery: (String) -> Unit = {},
    val toggleSpeaker: (Int) -> Unit = {},
    val regenerate: () -> Unit = {},
    val done: () -> Unit = {},
)

/** `deliveryNote`: "some voices only" / "these voices speak it naturally" / nothing. */
fun conversationDeliveryNote(audio: ResolvedConversationAudio, delivery: String): String? {
    if (delivery == "natural") return null
    val can = audio.voices.count { delivery in TtsConversation.supportedDeliveries(audio.provider, it) }
    if (can == audio.voices.size) return null
    return if (can == 0) "these voices speak it naturally" else "some voices only"
}

private fun speedText(s: Double) = "${ConversationAudio.speedLabel(s)}×"

@Composable
fun ConversationAudioSheetContent(ui: ConversationAudioSheetUi, actions: ConversationAudioSheetActions, modifier: Modifier = Modifier) {
    val audio = ui.now.audio
    val isDefaultSpeed = ui.now.prefs.speed == null
    SheetScaffold(
        modifier = modifier.testTag("conversation-audio-sheet"),
        header = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
                Text("Audio", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Text(" · ${ui.offer.providerName}", style = MaterialTheme.typography.titleMedium, color = Lab.colors.muted)
            }
        },
        footerAbove = ui.error?.let { e -> { InlineNotice(e, kind = NoticeKind.Error) } },
        footer = {
            SecondaryPill(
                when {
                    ui.regenerating -> "Making new audio…"
                    ui.online -> "↻ Regenerate audio"
                    else -> "↻ Regenerate (needs internet)"
                },
                Modifier.weight(2f).height(52.dp).testTag("convo-regenerate"),
                enabled = ui.online && !ui.regenerating,
                onClick = actions.regenerate,
            )
            PrimaryPill("Done", Modifier.weight(1f).height(52.dp), onClick = actions.done)
        },
        spacing = 14.dp,
    ) {
        if (!ui.online) {
            InlineNotice(
                "Offline — changes need internet to make new audio. The conversation plays what is already on this phone.",
                kind = NoticeKind.Offline,
            )
        }

        // ---- Speed ----
        Group(
            label = "Speed",
            value = speedText(audio.speed) + if (isDefaultSpeed) " (default)" else "",
            hint = "1× is the voice’s natural pace. Slower than ${speedText(ui.offer.speedSteps.firstOrNull() ?: audio.speed)} sounds stretched with this provider, so it isn’t offered.",
        ) {
            ChipRow(Modifier.alpha(if (ui.online) 1f else 0.55f)) {
                for (s in ui.offer.speedSteps) {
                    LabChip(speedText(s), selected = audio.speed == s, enabled = ui.online) { actions.setSpeed(s) }
                }
                if (!isDefaultSpeed) LabChip("Default", enabled = ui.online) { actions.setSpeed(null) }
            }
        }

        // ---- Voices ----
        Group(label = "Voices", hint = "A voice picked for the first woman or man here is used in every conversation.") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ui.speakers.forEachIndexed { i, sp -> SpeakerVoicePicker(i, sp, ui, actions) }
            }
        }

        // ---- Delivery ----
        Group(label = "Delivery") {
            ChipRow(Modifier.alpha(if (ui.online) 1f else 0.55f)) {
                for (d in TtsConversation.DELIVERIES) {
                    val note = conversationDeliveryNote(audio, d)
                    LabChip(
                        (TtsConversation.DELIVERY_LABELS[d] ?: d) + (note?.let { " · $it" } ?: ""),
                        selected = audio.delivery == d,
                        enabled = ui.online,
                    ) { actions.setDelivery(d) }
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun Group(label: String, value: String? = null, hint: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(label, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 16.sp)
            value?.let { Text("  $it", color = Lab.colors.accent, fontSize = 14.sp, fontWeight = FontWeight.Medium) }
        }
        content()
        hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
    }
}

@Composable
private fun SpeakerVoicePicker(i: Int, sp: ConversationSpeaker, ui: ConversationAudioSheetUi, actions: ConversationAudioSheetActions) {
    val audio = ui.now.audio
    val g = ConversationVoices.speakerGender(ui.speakers, i)
    val others = audio.voices.filterIndexed { j, _ -> j != i }.toSet()
    val autoName = ui.offer.voices.firstOrNull { it.id == audio.autoVoices.getOrNull(i) }?.name
        ?: TtsConversation.providerVoices(audio.provider).firstOrNull { it.id == audio.autoVoices.getOrNull(i) }?.name
    val chosenId = if (audio.chosen.getOrNull(i) == true) audio.voices[i] else null
    val chosenName = chosenId?.let { id -> ui.offer.voices.firstOrNull { it.id == id }?.name ?: TtsConversation.providerVoices(audio.provider).firstOrNull { it.id == id }?.name ?: id }
    val automatic = "Automatic" + (autoName?.let { " ($it)" } ?: "")
    val open = ui.openSpeaker == i
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).animateContentSize(),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp)
                .bouncyClickable(ui.online, 0.98f, role = Role.DropdownList) { actions.toggleSpeaker(i) }
                .padding(horizontal = 14.dp, vertical = 8.dp)
                .alpha(if (ui.online) 1f else 0.6f)
                .semantics { contentDescription = "Voice for ${sp.name}: ${chosenName ?: automatic}" }
                .testTag("convo-voice-$i"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("${if (g == "male") "👨" else "👩"} ${sp.name}", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(chosenName ?: automatic, color = if (chosenName != null) Lab.colors.accent else Lab.colors.muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(8.dp))
            Text(if (open) "▴" else "▾", color = Lab.colors.muted, fontSize = 16.sp)
        }
        if (open) {
            VoiceOptionRow(automatic, null, chosenId == null, enabled = true) { actions.setVoice(i, null) }
            val own = ui.offer.voices.filter { it.gender == g }
            val rest = ui.offer.voices.filter { it.gender != g }
            val groups = listOf((if (g == "female") "Female voices" else "Male voices") to own, (if (g == "female") "Male voices" else "Female voices") to rest)
            for ((label, list) in groups) {
                if (list.isEmpty()) continue
                Text(label.uppercase(), fontSize = 11.sp, letterSpacing = 1.sp, color = Lab.colors.muted, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 14.dp, top = 10.dp, bottom = 2.dp))
                for (v in list) {
                    VoiceOptionRow(v.name, v.note.takeIf { it.isNotBlank() }, chosenId == v.id, enabled = v.id !in others) { actions.setVoice(i, v.id) }
                }
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

@Composable
private fun VoiceOptionRow(name: String, note: String?, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 6.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) Lab.colors.accentSoft else Color.Transparent)
            .bouncyClickable(enabled, 0.98f, role = Role.RadioButton) { onClick() }
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .alpha(if (enabled) 1f else 0.4f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, color = Lab.colors.ink, fontSize = 15.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
            note?.let { Text(it, color = Lab.colors.muted, fontSize = 12.sp, maxLines = 2) }
        }
        if (selected) Text("✓", color = Lab.colors.accent, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        else if (!enabled) Text("in use", color = Lab.colors.muted, fontSize = 12.sp)
    }
}

/**
 * The ⚙︎ sheet with its behaviour: fetches what the provider offers when online, applies and
 * saves each choice, emits the analytics events, and hands Regenerate back to the exercise.
 */
@Composable
fun ConversationAudioSheet(
    speakers: List<ConversationSpeaker>,
    now: ConversationAudioNow,
    controls: ConversationAudioControls,
    regenerating: Boolean,
    onTap: () -> Unit,
    onRegenerate: () -> Unit,
    onClose: () -> Unit,
) {
    val online by controls.online.collectAsState()
    val scope = rememberCoroutineScope()
    val provider = now.audio.provider
    var offer by remember(provider) { mutableStateOf<ConversationAudioOffer?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var openSpeaker by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(Unit) {
        controls.track("lesson.conversation_audio_open", mapOf("provider" to provider))
        if (online) controls.refresh()?.let { offer = it }
    }

    fun save(update: JsonObject) {
        error = null
        onTap()
        scope.launch {
            val (e, o) = controls.save(update)
            error = e
            o?.let { offer = it }
        }
    }

    LabSheetFrame(onDismiss = onClose) {
        ConversationAudioSheetContent(
            ConversationAudioSheetUi(
                speakers = speakers,
                now = now,
                offer = offer ?: ConversationAudioOffer.bundled(provider, now.providerName),
                online = online,
                regenerating = regenerating,
                error = error,
                openSpeaker = openSpeaker,
            ),
            ConversationAudioSheetActions(
                setSpeed = { s ->
                    controls.track("lesson.conversation_audio_speed", mapOf("speed" to (s ?: 0.0), "provider" to provider, "source" to "exercise"))
                    save(JsonObject(mapOf("speed" to (s?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull))))
                },
                setVoice = { i, v ->
                    controls.track("lesson.conversation_audio_voice", mapOf("provider" to provider, "gender" to ConversationVoices.speakerGender(speakers, i), "automatic" to (v == null)))
                    openSpeaker = null
                    save(ConversationAudio.speakerVoiceUpdate(now.audio, speakers, i, v, now.prefs))
                },
                setDelivery = { d ->
                    controls.track("lesson.conversation_audio_delivery", mapOf("delivery" to d, "provider" to provider, "source" to "exercise"))
                    save(JsonObject(mapOf("delivery" to kotlinx.serialization.json.JsonPrimitive(d))))
                },
                toggleSpeaker = { i -> onTap(); openSpeaker = if (openSpeaker == i) null else i },
                regenerate = onRegenerate,
                done = onClose,
            ),
        )
    }
}
