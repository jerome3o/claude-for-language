package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.StudentProfile
import dev.jeromeswannack.chineselearning.lab.core.StudentProfileExample
import dev.jeromeswannack.chineselearning.lab.core.StudentProfileFields
import dev.jeromeswannack.chineselearning.lab.data.api.StudentProfileDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant

/*
 * "Student profile · only you can see this" on the tutor's student page (web:
 * components/tutor/StudentProfileSection.tsx + StudentProfileSheet.tsx): what kind of learner
 * the student is and what homework suits them — every agent that makes homework, lessons,
 * readers or cards for them reads it. Rules and examples: core StudentProfile (parity-tested).
 */


data class StudentProfileActions(
    /** Open the editor starting from these fields (the saved profile, empty, or an example). */
    val edit: (StudentProfileFields) -> Unit = {},
    val retry: () -> Unit = {},
)

/** A long profile is clamped on the card with "Show all" (web: CLAMP_CHARS / six lines). */
fun profileIsLong(body: String): Boolean = body.length > 320 || body.split('\n').size > 6

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StudentProfileSection(
    studentName: String,
    profile: StudentProfileDto?,
    loaded: Boolean,
    error: String?,
    actions: StudentProfileActions,
    now: Instant = Instant.now(),
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Student profile") { PrivateBadge() }
        when {
            !loaded && error != null -> InlineNotice("Could not load the profile", kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.retry)
            !loaded -> MutedLine("Loading…")
            profile == null -> EmptyProfileCard(studentName, actions)
            else -> ProfileCard(studentName, profile, actions, now)
        }
    }
}

@Composable
private fun PrivateBadge() {
    Text(
        "🔒 Only you can see this",
        style = MaterialTheme.typography.labelMedium,
        color = Lab.colors.muted,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun EmptyProfileCard(studentName: String, actions: StudentProfileActions) {
    TeachCard {
        Text("What kind of learner is $studentName, and what homework suits them?", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        UseLine("✨", "Claude reads this whenever it makes homework, mini lessons, readers or cards for $studentName — from your lesson notes, homework drafts, video lessons and the lesson editor.")
        UseLine("🔒", "$studentName never sees it.")
        PrimaryPill("✍️ Write a profile", Modifier.fillMaxWidth().heightIn(min = 52.dp)) { actions.edit(StudentProfile.EMPTY) }
        Text("OR START FROM AN EXAMPLE", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp))
        StudentProfile.EXAMPLES.forEach { ex -> ExampleRow(ex) { actions.edit(ex.profile) } }
    }
}

@Composable
private fun UseLine(icon: String, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(icon, fontSize = 15.sp)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
    }
}

@Composable
private fun ExampleRow(ex: StudentProfileExample, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp)
            .bouncyClickable(pressedScale = 0.98f, onClick = onClick)
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(ex.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            Text(ex.summary, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        Text("›", color = Lab.colors.muted, fontSize = 22.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProfileCard(studentName: String, profile: StudentProfileDto, actions: StudentProfileActions, now: Instant) {
    var expanded by remember { mutableStateOf(false) }
    val fields = profile.fields()
    val chips = StudentProfile.chips(fields)
    val long = profileIsLong(fields.body)
    TeachCard(Modifier.animateContentSize()) {
        if (chips.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                chips.forEach { TeachPill(it, PillTone.Homework) }
            }
        }
        if (fields.body.isNotBlank()) {
            val shown = if (long && !expanded) clampBody(fields.body) else fields.body
            MarkdownText(shown, style = MaterialTheme.typography.bodyMedium)
            if (long) InlineButton(if (expanded) "Show less" else "Show all") { expanded = !expanded }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            MutedLine("Updated ${TeachingFormat.relativeDay(profile.updated_at, now)} · Claude follows it for $studentName's homework", Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            TeachButton("✏️ Edit", Modifier.widthIn(min = 96.dp)) { actions.edit(fields) }
        }
    }
}

/** The first lines of a long profile (Compose can't fade a Markdown block cheaply; cut at a line). */
private fun clampBody(body: String): String {
    val lines = body.split('\n')
    val out = StringBuilder()
    for (l in lines) {
        if (out.length + l.length > 320 && out.isNotEmpty()) break
        out.append(l).append('\n')
        if (out.lines().size > 6) break
    }
    return out.toString().trimEnd() + " …"
}

/** The dashboard's quiet "+ Student profile" hint on a card whose student has none yet. */
@Composable
fun ProfileHintPill(onClick: () -> Unit) {
    Text(
        "+ Student profile",
        color = Lab.colors.muted,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier
            .heightIn(min = 36.dp)
            .bouncyClickable(pressedScale = 0.93f, onClick = onClick)
            .clip(RoundedCornerShape(50))
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

// ---------------- editor ----------------

/**
 * The profile editor (web: StudentProfileSheet): a few optional facts the assistant acts on
 * (level, handwriting, words per lesson), the free text, examples to start from / insert, and
 * what else is worth writing down. [saved] decides "unsaved changes"; [initial] is where the
 * draft starts (the saved profile or an example picked on the page).
 */
@Composable
fun StudentProfileSheet(
    studentName: String,
    saved: StudentProfileFields,
    initial: StudentProfileFields,
    online: Boolean,
    save: (StudentProfileFields, (String?) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var confirmDiscard by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(initial) }
    val dirty = !StudentProfile.same(draft, saved)
    val close = { if (dirty) confirmDiscard = true else onDismiss() }
    LabSheetFrame(onDismiss = close) {
        StudentProfileForm(studentName, saved, draft, { draft = it }, online, save, close, onDismiss, title = "Student profile · $studentName")
    }
    if (confirmDiscard) {
        ConfirmDialog("Discard your changes?", "The profile stays as it was.", "Discard", onConfirm = { confirmDiscard = false; onDismiss() }, onDismiss = { confirmDiscard = false }, danger = true)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StudentProfileForm(
    studentName: String,
    saved: StudentProfileFields,
    draft: StudentProfileFields,
    setDraft: (StudentProfileFields) -> Unit,
    online: Boolean,
    save: (StudentProfileFields, (String?) -> Unit) -> Unit,
    cancel: () -> Unit,
    done: () -> Unit,
    title: String? = null,
    modifier: Modifier = Modifier,
) {
    var wordsText by remember { mutableStateOf(draft.wordsPerLesson?.toString() ?: "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var reading by remember { mutableStateOf<String?>(null) }
    val wordsNumber = wordsText.trim().toIntOrNull()
    val wordsInvalid = wordsText.isNotBlank() && (wordsNumber == null || wordsNumber < 1 || wordsNumber > StudentProfile.MAX_WORDS_PER_LESSON)
    val chars = draft.body.trim().length
    val tooLong = chars > StudentProfile.MAX_CHARS
    val empty = StudentProfile.isEmpty(draft)
    val dirty = !StudentProfile.same(draft, saved)

    // Long (examples + hints): only the middle scrolls, Cancel / Save stay pinned (SheetScaffold).
    SheetScaffold(
        modifier,
        spacing = 12.dp,
        header = title?.let { t -> { SheetTitle(t) } },
        footerAbove = if (error == null && online) null else {
            {
                error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                if (!online) InlineNotice("You're offline — the profile can be saved once you're back online.", kind = NoticeKind.Offline)
            }
        },
        footer = {
            TeachButton("Cancel", Modifier.weight(1f).height(52.dp), onClick = cancel)
            val label = when {
                saving -> "Saving…"
                empty && !StudentProfile.isEmpty(saved) -> "Clear profile"
                else -> "Save"
            }
            TeachButton(label, Modifier.weight(1.4f).height(52.dp), primary = true, enabled = dirty && !tooLong && !wordsInvalid && !saving && online) {
                val (value, problems) = StudentProfile.validate(draft)
                if (value == null) { error = problems.joinToString(" · "); return@TeachButton }
                saving = true; error = null
                save(value) { e -> saving = false; error = e; if (e == null) done() }
            }
        },
    ) {
        Text(
            "🔒 Only you can see this — $studentName never does. Claude follows it whenever it makes homework, mini lessons, readers or cards for $studentName.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(12.dp),
        )

        Text("At a glance (optional)", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        MutedLine("Level")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StudentProfile.LEVELS.forEach { l ->
                val on = draft.level == l
                LabChip(StudentProfile.LEVEL_LABELS.getValue(l), selected = on) { setDraft(draft.copy(level = if (on) null else l)) }
            }
        }
        MutedLine("Writes characters by hand")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(true to "Yes", false to "No — typing only").forEach { (v, label) ->
                val on = draft.handwriting == v
                LabChip(label, selected = on) { setDraft(draft.copy(handwriting = if (on) null else v)) }
            }
        }
        OutlinedTextField(
            wordsText,
            { t ->
                val clean = t.filter { it.isDigit() }.take(3)
                wordsText = clean
                setDraft(draft.copy(wordsPerLesson = clean.toIntOrNull()))
            },
            Modifier.widthIn(min = 200.dp),
            label = { Text("New words per lesson") },
            placeholder = { Text("e.g. 15") },
            singleLine = true,
            isError = wordsInvalid,
            supportingText = if (wordsInvalid) ({ Text("A whole number from 1 to ${StudentProfile.MAX_WORDS_PER_LESSON}") }) else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )

        OutlinedTextField(
            draft.body, { setDraft(draft.copy(body = it)) },
            Modifier.fillMaxWidth().heightIn(min = 200.dp),
            label = { Text("What kind of learner is $studentName, and what homework suits them?") },
            placeholder = { Text("e.g. Adult beginner, learning for travel. Doesn't write characters by hand.\n- Audio first for every new word\n- 10–20 cards a lesson — mastery over volume\n- Likes football and cooking (reader topics)") },
            isError = tooLong,
        )
        MutedLine("${"%,d".format(java.util.Locale.US, chars)} / ${"%,d".format(java.util.Locale.US, StudentProfile.MAX_CHARS)} characters · Markdown is fine")

        Text(if (empty) "Start from an example" else "Examples", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        StudentProfile.EXAMPLES.forEach { ex ->
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint.copy(alpha = 0.5f))
                    .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(ex.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Text(ex.summary, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                if (reading == ex.id) {
                    Text(
                        ex.profile.body, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.card).padding(10.dp),
                    )
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    InlineButton(if (reading == ex.id) "Hide" else "Read it") { reading = if (reading == ex.id) null else ex.id }
                    TeachButton(if (empty) "Use this" else "Insert") {
                        val next = StudentProfile.applyExample(draft, ex.profile)
                        setDraft(next)
                        wordsText = next.wordsPerLesson?.toString() ?: ""
                        error = null
                    }
                }
            }
        }
        Text("Useful to include", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        StudentProfile.HINTS.forEach { MutedLine("•  $it") }

    }
}
