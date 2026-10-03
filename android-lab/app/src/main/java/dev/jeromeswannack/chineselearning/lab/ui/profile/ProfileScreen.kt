package dev.jeromeswannack.chineselearning.lab.ui.profile

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChatVoice
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId

/** What the screen shows that isn't its own state. */
data class ProfileEnv(
    /** Tutor account or has students: "About me for students", "how your students see you". */
    val teaches: Boolean = false,
    /** A learner: the private Bio for Claude. */
    val learns: Boolean = true,
    val online: Boolean = true,
    val deviceTimeZone: String? = runCatching { ZoneId.systemDefault().id }.getOrNull(),
    /** Fixed clock for screenshots. */
    val now: Instant? = null,
    /** Draws the photo directly (screenshots). */
    val previewPhoto: ImageBitmap? = null,
)

class ProfileActions(
    val onBack: (() -> Unit)? = null,
    val edit: (ProfileDraft) -> Unit = {},
    val save: () -> Unit = {},
    val discard: () -> Unit = {},
    val useGoogleName: () -> Unit = {},
    val pickPhoto: () -> Unit = {},
    val resetPhoto: (useGoogle: Boolean) -> Unit = {},
    val retry: () -> Unit = {},
)

/**
 * `/profile` (web: pages/ProfilePage.tsx): photo (pick → crop sheet → 512px JPEG), display
 * name, About me, time zone, learner bio, and a live "how they see you" preview. A save bar
 * rises when something changed; problems show under their field, as on the web.
 */
@Composable
fun ProfileScreen(ui: ProfileUi, env: ProfileEnv, actions: ProfileActions, listState: LazyListState = rememberLazyListState()) {
    val p = ui.profile
    val audience = if (env.teaches) "your students" else "your tutor"
    var zonePicker by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    val changes = ui.changes
    val problems = (changes.problems + ui.serverProblems).distinct()
    fun fieldProblem(prefix: String) = problems.firstOrNull { it.startsWith(prefix) }

    Box(Modifier.fillMaxSize()) {
        LabScreen(
            "Profile",
            onBack = actions.onBack,
            subtitle = "How you appear to $audience — on your page, in chat${if (env.teaches) " and on your invite links" else ""}",
            listState = listState,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 120.dp),
        ) {
            if (p == null) {
                item {
                    if (ui.loadError != null) InlineNotice(ui.loadError, kind = NoticeKind.Error, actionLabel = "Try again", onAction = actions.retry)
                    else LoadingState(text = "Loading your profile…")
                }
                return@LabScreen
            }
            // ---------- photo ----------
            item {
                LabCard {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.clickable(enabled = !ui.photoBusy && env.online, onClick = actions.pickPhoto)) {
                            ProfilePhoto(p.picture_url, p.name, p.email, size = 96.dp, preview = env.previewPhoto?.takeIf { p.picture_url != null })
                            Box(
                                Modifier.align(Alignment.BottomEnd).size(32.dp).clip(CircleShape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) { Text("📷", fontSize = 15.sp) }
                        }
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            SecondaryPill(if (p.picture_url != null) "Change photo" else "Add a photo", enabled = !ui.photoBusy && env.online, onClick = actions.pickPhoto)
                            if (!p.google_picture_url.isNullOrBlank() && p.picture_source != "google") {
                                TextLink("Use my Google photo", enabled = !ui.photoBusy && env.online) { actions.resetPhoto(true) }
                            }
                            if (p.picture_url != null) TextLink("Remove photo", danger = true, enabled = !ui.photoBusy && env.online) { confirmRemove = true }
                            Text(
                                when (p.picture_source) { "upload" -> "Your own photo"; "google" -> "From your Google account"; else -> "No photo — people see your initial" },
                                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                            )
                        }
                    }
                    if (ui.photoError != null && ui.photo == null) InlineNotice(ui.photoError, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), kind = NoticeKind.Error)
                }
            }
            // ---------- name ----------
            item {
                Field("Display name", problem = fieldProblem("Name")) {
                    ProfileInput(ui.draft.name, { actions.edit(ui.draft.copy(name = it)) }, placeholder = p.google_name ?: "Your name", singleLine = true, words = true)
                    val left = ProfileRules.NAME_MAX - ProfileRules.charCount(ui.draft.name.trim())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (p.name_custom && !p.google_name.isNullOrBlank()) {
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                                Text("Google says “${p.google_name}”. ", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                                TextLink("Use that instead", enabled = !ui.saving && env.online, onClick = actions.useGoogleName)
                            }
                        } else {
                            Text("From your Google account — change it to what $audience call you.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
                        }
                        if (left < 15) Counter(left)
                    }
                }
            }
            // ---------- about ----------
            item {
                Field(
                    if (env.teaches) "About me for students" else "About me for my tutor",
                    desc = if (env.teaches) "Shown on your page in your students’ app and on your invite links. A line or two: who you are, how you teach, when to reach you."
                    else "Shown to your tutor on your page. Why you’re learning, your level, what you’d like help with.",
                    problem = fieldProblem("About me"),
                ) {
                    ProfileInput(
                        ui.draft.about, { actions.edit(ui.draft.copy(about = it)) },
                        placeholder = if (env.teaches) "e.g. 你好! I’m Minghui, a Mandarin teacher from Shanghai. Message me here any time." else "e.g. HSK 2-ish; I’d love help with listening.",
                        minHeight = 110,
                    )
                    Row { Spacer(Modifier.weight(1f)); Counter(ProfileRules.ABOUT_MAX - ProfileRules.charCount(ui.draft.about)) }
                }
            }
            // ---------- time zone ----------
            item {
                Field("Time zone", desc = "So $audience can see what time it is for you before they message.") {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp))
                            .clickable { zonePicker = true }.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(ui.draft.timeZone.ifBlank { "Not shown" }.replace('_', ' '), style = MaterialTheme.typography.bodyLarge, color = if (ui.draft.timeZone.isBlank()) Lab.colors.muted else Lab.colors.ink, modifier = Modifier.weight(1f))
                        Text("⌄", color = Lab.colors.muted, fontSize = 20.sp)
                    }
                    val device = env.deviceTimeZone
                    if (device != null && device != ui.draft.timeZone) {
                        TextLink("Use this phone’s: ${ProfileRules.timeZoneCity(device)}") { actions.edit(ui.draft.copy(timeZone = device)) }
                    }
                }
            }
            // ---------- read-aloud voice (shared/chats/voice.ts) ----------
            item {
                Field(ChatVoice.TITLE, desc = ChatVoice.HINT) {
                    ChipRow(Modifier.fillMaxWidth()) {
                        for (o in ChatVoice.OPTIONS) {
                            LabChip(o.label, selected = ui.draft.voiceGender == o.value) { actions.edit(ui.draft.copy(voiceGender = o.value)) }
                        }
                    }
                }
            }
            // ---------- bio ----------
            if (env.learns) item {
                Field(
                    "Bio for Claude  🔒 private",
                    desc = "Only used to personalise example sentences — mention you like coffee and you might get sentences about ordering coffee. Nobody else sees it.",
                    problem = fieldProblem("Bio"),
                ) {
                    ProfileInput(ui.draft.bio, { actions.edit(ui.draft.copy(bio = it)) }, placeholder = "e.g. I'm a software developer living in New Zealand. I like hiking, coffee, and cooking.", minHeight = 100)
                    Row { Spacer(Modifier.weight(1f)); Counter(ProfileRules.BIO_MAX - ProfileRules.charCount(ui.draft.bio)) }
                }
            }
            val other = problems.filterNot { it.startsWith("Name") || it.startsWith("About me") || it.startsWith("Bio") }
            if (ui.error != null || other.isNotEmpty()) item { InlineNotice(listOfNotNull(ui.error).plus(other).joinToString("\n"), kind = NoticeKind.Error) }
            if (!env.online) item { InlineNotice("You're offline — your profile needs a connection to save.", kind = NoticeKind.Warning) }
            // ---------- preview ----------
            item { SectionHeader(if (env.teaches) "How your students see you" else "How your tutor sees you") }
            item {
                LabCard {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val name = ui.draft.name.trim().ifEmpty { p.google_name ?: p.email ?: "You" }
                            ProfilePhoto(p.picture_url, name, p.email, size = 56.dp, preview = env.previewPhoto?.takeIf { p.picture_url != null })
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                                Text(if (env.teaches) "Your tutor" else "Your student", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                            }
                        }
                        val about = ui.draft.about.trim().ifEmpty { null }
                        val tz = ui.draft.timeZone.ifBlank { null }
                        if (about == null && tz == null) {
                            Text("Add a line about yourself and your time zone — they show up here.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 12.dp))
                        } else {
                            PersonAbout(about, tz, Modifier.padding(top = 12.dp), now = env.now)
                        }
                    }
                }
            }
            ui.flash?.let { item { InlineNotice(it, kind = NoticeKind.Success) } }
        }

        // ---------- save bar ----------
        AnimatedVisibility(
            changes.any && p != null,
            Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically { it },
            exit = slideOutVertically { it },
        ) {
            Row(
                Modifier.fillMaxWidth().background(Lab.colors.card).navigationBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SecondaryPill("Discard", Modifier.weight(1f), enabled = !ui.saving, onClick = actions.discard)
                PrimaryPill(if (ui.saving) "Saving…" else "Save changes", Modifier.weight(1f), enabled = !ui.saving && env.online && changes.problems.isEmpty(), onClick = actions.save)
            }
        }
    }

    if (zonePicker) {
        TimeZoneSheet(ui.draft.timeZone, env.deviceTimeZone, onPick = { actions.edit(ui.draft.copy(timeZone = it)); zonePicker = false }, onDismiss = { zonePicker = false })
    }
    if (confirmRemove) {
        ConfirmDialog(
            title = "Remove your photo?",
            text = "People will see your initial instead.",
            confirmLabel = "Remove",
            danger = true,
            onConfirm = { confirmRemove = false; actions.resetPhoto(false) },
            onDismiss = { confirmRemove = false },
        )
    }
}

@Composable
private fun Field(label: String, desc: String? = null, problem: String? = null, content: @Composable () -> Unit) {
    LabCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
            if (desc != null) Text(desc, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            content()
            if (problem != null) Text(problem, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Palette.Again)
        }
    }
}

@Composable
private fun ProfileInput(value: String, onChange: (String) -> Unit, placeholder: String, singleLine: Boolean = false, minHeight: Int = 0, words: Boolean = false) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth().heightIn(min = minHeight.dp),
        placeholder = { Text(placeholder, color = Lab.colors.muted) },
        singleLine = singleLine,
        keyboardOptions = KeyboardOptions(capitalization = if (words) KeyboardCapitalization.Words else KeyboardCapitalization.Sentences),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent, unfocusedBorderColor = Lab.colors.cardBorder),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = Lab.colors.ink),
    )
}

@Composable
private fun Counter(left: Int) {
    Text("$left", style = MaterialTheme.typography.bodySmall, color = if (left < 0) Palette.Again else Lab.colors.muted, fontWeight = if (left < 0) FontWeight.Bold else FontWeight.Normal)
}

@Composable
private fun TextLink(label: String, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold,
        color = (if (danger) Palette.Again else Lab.colors.accent).copy(alpha = if (enabled) 1f else 0.5f),
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, onClick = onClick).heightIn(min = 36.dp).padding(vertical = 8.dp),
    )
}

/** Pick a zone: this phone's first, then a search over every zone the runtime knows. */
@Composable
private fun TimeZoneSheet(current: String, device: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val all = remember { ZoneId.getAvailableZoneIds().filter { it.contains('/') && !it.startsWith("Etc/") && !it.startsWith("SystemV/") }.sorted() + "UTC" }
    val q = query.trim().lowercase().replace(' ', '_')
    val matches = (if (q.isEmpty()) listOfNotNull(device) + all.filter { it in POPULAR } else all.filter { it.lowercase().contains(q) }).distinct().take(40)
    LabBottomSheet(onDismiss = onDismiss, title = "Time zone") {
        Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ProfileInput(query, { query = it }, placeholder = "Search a city, e.g. Shanghai", singleLine = true)
            ZoneRow("Not shown", selected = current.isBlank()) { onPick("") }
            for (z in matches) ZoneRow(z.replace('_', ' ') + if (z == device) "  · this phone" else "", selected = z == current) { onPick(z) }
            if (matches.isEmpty()) Text("No zone matches “$query”.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        }
    }
}

@Composable
private fun ZoneRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
        if (selected) Text("✓", color = Lab.colors.accent, fontWeight = FontWeight.Bold)
    }
}

private val POPULAR = setOf(
    "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
    "Pacific/Auckland", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago",
    "America/Denver", "America/Los_Angeles",
)
