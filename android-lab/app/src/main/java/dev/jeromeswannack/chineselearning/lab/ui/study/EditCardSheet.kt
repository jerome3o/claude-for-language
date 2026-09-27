package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.api.NoteAudioRecordingDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteUpdate
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/** What the edit sheet can do beyond saving (all online; failures show inline). */
class EditCardActions(
    val save: suspend (NoteUpdate) -> Unit = {},
    val delete: suspend () -> Unit = {},
    /** Generate / regenerate the example sentence; returns the updated note. */
    val generateClue: suspend () -> NoteEntity? = { null },
    val recordings: suspend () -> List<NoteAudioRecordingDto> = { emptyList() },
    val setPrimary: suspend (String) -> Unit = {},
    val deleteRecording: suspend (String) -> Unit = {},
    val play: (key: String?, text: String) -> Unit = { _, _ -> },
)

/** Edit card (components/CardEditModal.tsx) as a full-height sheet. */
@Composable
fun EditCardSheet(note: NoteEntity, aiAvailable: Boolean, actions: EditCardActions, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss) { EditCardForm(note, aiAvailable, actions, onDismiss) }
}

@Composable
fun EditCardForm(note: NoteEntity, aiAvailable: Boolean, actions: EditCardActions, onDismiss: () -> Unit, loadRecordings: Boolean = true) {
    var hanzi by remember { mutableStateOf(note.hanzi) }
    var pinyin by remember { mutableStateOf(note.pinyin) }
    var english by remember { mutableStateOf(note.english) }
    var funFacts by remember { mutableStateOf(note.funFacts.orEmpty()) }
    var alternatives by remember { mutableStateOf(CardExtrasLogic.alternativesText(note.alternatives)) }
    var clue by remember { mutableStateOf(note.sentenceClue.orEmpty()) }
    var cluePinyin by remember { mutableStateOf(note.sentenceCluePinyin.orEmpty()) }
    var clueTranslation by remember { mutableStateOf(note.sentenceClueTranslation.orEmpty()) }
    var clueAudio by remember { mutableStateOf(note.sentenceClueAudioUrl) }
    var saving by remember { mutableStateOf(false) }
    var generating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var recordings by remember { mutableStateOf<List<NoteAudioRecordingDto>?>(null) }
    val scope = rememberCoroutineScope()

    fun reloadRecordings() = scope.launch { recordings = runCatching { actions.recordings() }.getOrElse { emptyList() } }
    LaunchedEffect(note.id) { if (loadRecordings && aiAvailable) reloadRecordings() else recordings = emptyList() }

    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Edit card", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            TextButton(onClick = { confirmDelete = !confirmDelete }) { Text("🗑 Delete note", color = Palette.Again) }
        }
        AnimatedVisibility(confirmDelete) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.Again.copy(alpha = 0.1f)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Delete this note and all three of its cards?", color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryPill("Delete", Modifier.weight(1f).height(46.dp), enabled = !saving && aiAvailable, danger = true) {
                        saving = true
                        scope.launch {
                            try { actions.delete(); onDismiss() } catch (e: Exception) { error = CardTools.message(e) } finally { saving = false }
                        }
                    }
                    SecondaryPill("Keep it", Modifier.weight(1f).height(46.dp)) { confirmDelete = false }
                }
            }
        }
        if (!aiAvailable) InlineNotice("You're offline — edits need a connection.", kind = NoticeKind.Offline)

        Field("Hanzi", hanzi) { hanzi = it }
        Field("Pinyin", pinyin) { pinyin = it }
        Field("English", english) { english = it }
        Field("Fun facts", funFacts, minLines = 3) { funFacts = it }
        Field("Acceptable alternatives", alternatives, minLines = 2, placeholder = "One alternative per line, e.g. 我很高兴") { alternatives = it }
        Text("Other valid hanzi answers (one per line). Marked correct during review.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)

        Spacer(Modifier.height(4.dp))
        Text("Sentence clue", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
        Field("Example sentence", clue, minLines = 2, placeholder = "Example sentence using this word…") { clue = it }
        Field("Pinyin", cluePinyin, placeholder = "Sentence pinyin…") { cluePinyin = it }
        Field("Translation", clueTranslation, placeholder = "English translation…") { clueTranslation = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryPill(if (generating) "Generating…" else if (clue.isNotBlank()) "Regenerate" else "Generate", Modifier.height(44.dp), enabled = !generating && aiAvailable) {
                generating = true
                scope.launch {
                    try {
                        actions.generateClue()?.let { n ->
                            clue = n.sentenceClue.orEmpty(); cluePinyin = n.sentenceCluePinyin.orEmpty()
                            clueTranslation = n.sentenceClueTranslation.orEmpty(); clueAudio = n.sentenceClueAudioUrl
                        }
                    } catch (e: Exception) { error = CardTools.message(e) } finally { generating = false }
                }
            }
            if (clueAudio != null) SecondaryPill("▶ Play", Modifier.height(44.dp)) { actions.play(clueAudio, clue) }
            if (clue.isNotBlank()) SecondaryPill("Clear", Modifier.height(44.dp)) { clue = ""; cluePinyin = ""; clueTranslation = ""; clueAudio = null }
        }

        val recs = recordings
        if (!recs.isNullOrEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text("Audio recordings", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
            for (rec in recs) {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { actions.play(rec.audio_url, note.hanzi) }) { Text("▶", color = Lab.colors.accent) }
                    Column(Modifier.weight(1f)) {
                        Text(rec.speaker_name ?: rec.provider ?: "Recording", color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
                        rec.provider?.let { Text(it, color = Lab.colors.muted, style = MaterialTheme.typography.labelSmall) }
                    }
                    if (rec.is_primary) {
                        Text("Primary", color = Palette.Good, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(CircleShape).background(Palette.Good.copy(alpha = 0.12f)).padding(horizontal = 8.dp, vertical = 3.dp))
                    } else {
                        TextButton(onClick = { scope.launch { runCatching { actions.setPrimary(rec.id) }.onFailure { error = CardTools.message(it) }; reloadRecordings() } }) { Text("Set primary", color = Lab.colors.accent) }
                        TextButton(onClick = { scope.launch { runCatching { actions.deleteRecording(rec.id) }.onFailure { error = CardTools.message(it) }; reloadRecordings() } }) { Text("Delete", color = Palette.Again) }
                    }
                }
            }
        }

        error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 4.dp)) {
            SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp), onClick = onDismiss)
            PrimaryPill(if (saving) "Saving…" else "Save", Modifier.weight(1f).height(52.dp), enabled = !saving && aiAvailable && hanzi.isNotBlank()) {
                saving = true
                error = null
                val clueValue = clue.trim().ifEmpty { null }
                val update = NoteUpdate(
                    hanzi = hanzi, pinyin = pinyin, english = english,
                    funFacts = funFacts.ifEmpty { null },
                    sentenceClue = clueValue,
                    sentenceCluePinyin = cluePinyin.trim().ifEmpty { null },
                    sentenceClueTranslation = clueTranslation.trim().ifEmpty { null },
                    sentenceClueAudioUrl = clueAudio,
                    alternatives = CardExtrasLogic.alternativesJson(alternatives),
                )
                scope.launch {
                    try { actions.save(update); onDismiss() } catch (e: Exception) { error = CardTools.message(e) } finally { saving = false }
                }
            }
        }
        Spacer(Modifier.width(1.dp))
    }
}

@Composable
private fun Field(label: String, value: String, minLines: Int = 1, placeholder: String? = null, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it) } },
        minLines = minLines,
        singleLine = minLines == 1,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent, focusedLabelColor = Lab.colors.accent),
    )
}
