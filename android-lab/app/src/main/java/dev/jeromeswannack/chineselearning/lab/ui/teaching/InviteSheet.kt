package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.api.CreateInviteBody
import dev.jeromeswannack.chineselearning.lab.data.api.InviteDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray

/** The built-in deck that is created on send (web: STARTER_OPTION_ID). */
const val STARTER_OPTION_ID = "__starter__"
const val STARTER_DECK_NAME = "Starter Chinese"
private const val WELCOME_PLACEHOLDER = "欢迎！先学这几个词，有问题在这里问我。"

/** What "Create link" sends; [withStarter] = create the built-in Starter deck first. */
data class InviteRequest(val body: CreateInviteBody, val withStarter: Boolean)

/**
 * "Invite a student" (web: components/invites/InviteSheet.tsx): Starter Chinese ticked,
 * the tutor's decks to add, a welcome message, Options (relationship, email, expiry,
 * multi-use, note to self), Create link → QR + Copy / Share.
 */
@Composable
fun InviteSheet(
    decks: List<DeckOption>?,
    online: Boolean,
    create: (InviteRequest, (step: String?) -> Unit, (InviteDto?, String?) -> Unit) -> Unit,
    onCopy: (String) -> Unit,
    onShare: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var invite by remember { mutableStateOf<InviteDto?>(null) }
    LabSheetFrame(onDismiss = onDismiss) {
        val done = invite
        if (done == null) InviteForm(decks, online, create, title = "Invite a student") { invite = it }
        else SheetScaffold(header = { SheetTitle("Your invite link") }, footer = null) { InviteResult(done, onCopy, onShare, onDismiss) }
    }
}

@Composable
fun InviteForm(
    decks: List<DeckOption>?,
    online: Boolean,
    create: (InviteRequest, (String?) -> Unit, (InviteDto?, String?) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    onCreated: (InviteDto) -> Unit,
) {
    val existingStarter = decks?.firstOrNull { it.name == STARTER_DECK_NAME }
    var role by remember { mutableStateOf("tutor") } // tutor | student | none
    var selected by remember(existingStarter?.id) { mutableStateOf(setOf(existingStarter?.id ?: STARTER_OPTION_ID)) }
    var welcome by remember { mutableStateOf("") }
    var showOptions by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var expiresDays by remember { mutableStateOf<Int?>(null) }
    var multiUse by remember { mutableStateOf(false) }
    var maxUses by remember { mutableIntStateOf(10) }
    var note by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var step by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val needsDeck = role == "tutor"
    val canCreate = online && !creating && (!needsDeck || selected.isNotEmpty())
    fun toggle(id: String) { selected = if (id in selected) selected - id else selected + id }
    fun submit() {
        error = null; creating = true
        val ids = if (role == "tutor") selected.filter { it != STARTER_OPTION_ID } else emptyList()
        val body = CreateInviteBody(
            inviter_role = if (role == "none") null else role,
            share_deck_ids = ids,
            welcome_message = if (role == "none") null else welcome.trim().ifEmpty { null },
            email = email.trim().ifEmpty { null },
            expires_in_days = expiresDays,
            max_uses = if (multiUse) maxOf(2, maxUses) else 1,
            note = note.trim().ifEmpty { null },
        )
        create(InviteRequest(body, role == "tutor" && STARTER_OPTION_ID in selected), { step = it }) { inv, err ->
            creating = false; step = null
            if (inv != null) onCreated(inv) else error = err ?: "Could not create the invite"
        }
    }

    // A tutor with many decks: the deck list scrolls, "Create link" stays pinned (SheetScaffold).
    SheetScaffold(
        modifier,
        spacing = 12.dp,
        header = title?.let { t -> { SheetTitle(t) } },
        footerAbove = if (error == null && online) null else {
            {
                error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                if (!online) InlineNotice("You're offline. Invite links can't be created right now.", kind = NoticeKind.Offline)
            }
        },
        footer = {
            PrimaryPill(if (creating) (step ?: "Creating…") else "Create link", Modifier.weight(1f).height(56.dp), enabled = canCreate) { submit() }
        },
    ) {
        Text(
            "They scan this in class or tap the link, sign in with Google, and land straight in their first session. No email address needed.",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
        )
        if (needsDeck) {
            Text("Start them with", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            if (decks == null) MutedLine("Loading your decks…")
            else {
                if (existingStarter == null) {
                    DeckCheck(STARTER_DECK_NAME, "Built-in · 15 words (你好, 谢谢, 对不起…) · added to your decks when you send", STARTER_OPTION_ID in selected) { toggle(STARTER_OPTION_ID) }
                }
                decks.forEach { d ->
                    DeckCheck(d.name, if (d.id == existingStarter?.id) "Built-in starter deck · copied to them on first sign-in" else null, d.id in selected) { toggle(d.id) }
                }
            }
            MutedLine(
                when (selected.size) {
                    0 -> "Pick at least one deck — the link needs something for them to study."
                    1 -> "This deck is copied to them the moment they sign in."
                    else -> "These ${selected.size} decks are copied to them the moment they sign in."
                },
            )
        }
        if (role != "none") {
            OutlinedTextField(
                welcome, { if (it.length <= 1000) welcome = it }, Modifier.fillMaxWidth(),
                label = { Text("Welcome message (optional, sent as your first chat message)") },
                placeholder = { Text(WELCOME_PLACEHOLDER) }, minLines = 2,
            )
        }
        Text(
            "${if (showOptions) "▾" else "▸"} Options", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { showOptions = !showOptions }.padding(vertical = 12.dp),
        )
        AnimatedVisibility(showOptions) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Our relationship", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OptionTile("I'm their tutor", "They become my student", role == "tutor", Modifier.weight(1f)) { role = "tutor" }
                    OptionTile("They're my tutor", "I become their student", role == "student", Modifier.weight(1f)) { role = "student" }
                    OptionTile("Just let them in", "No connection, only access", role == "none", Modifier.weight(1f)) { role = "none" }
                }
                OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Only for this email") }, placeholder = { Text("optional — their Google email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                Text("Expires", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                ChipRow {
                    listOf(null to "Never", 1 to "In 1 day", 7 to "In 7 days", 30 to "In 30 days", 90 to "In 90 days").forEach { (d, l) -> LabChip(l, selected = expiresDays == d) { expiresDays = d } }
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable { multiUse = !multiUse }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(multiUse, { multiUse = it }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                    Text("Allow multiple people to use this link", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                }
                if (multiUse) {
                    OutlinedTextField(maxUses.toString(), { v -> maxUses = v.filter(Char::isDigit).take(4).toIntOrNull() ?: 2 }, Modifier.fillMaxWidth(), label = { Text("Max uses") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
                OutlinedTextField(note, { if (it.length <= 200) note = it }, Modifier.fillMaxWidth(), label = { Text("Note to self") }, placeholder = { Text("e.g. Tuesday class") }, singleLine = true)
            }
        }
    }
}

@Composable
private fun DeckCheck(name: String, desc: String?, checked: Boolean, onToggle: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).bouncyClickable(pressedScale = 0.98f, onClick = onToggle), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, { onToggle() }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
            if (desc != null) MutedLine(desc)
        }
    }
}

/** "They will be added as your student and get 2 decks to start with — …" (web: invite-result-summary). */
fun inviteSummary(inv: InviteDto): String {
    val shared = inv.share_deck_ids?.let { runCatching { (Json.parseToJsonElement(it) as JsonArray).size }.getOrNull() } ?: 0
    val sb = StringBuilder()
    sb.append(
        when (inv.inviter_role) {
            "tutor" -> "They will be added as your student"
            "student" -> "They will be added as your tutor"
            else -> "They will get an account, no connection"
        },
    )
    if (shared > 0) sb.append(" and get $shared deck${if (shared == 1) "" else "s"} to start with")
    if (!inv.welcome_message.isNullOrEmpty()) sb.append(" — your welcome message is waiting for them")
    if (!inv.email.isNullOrEmpty()) sb.append(" — only ${inv.email} can use it")
    if (inv.expires_at != null) sb.append(" — expires ${TeachingFormat.shortDate(inv.expires_at)}")
    if (inv.max_uses > 1) sb.append(" — up to ${inv.max_uses} people")
    return sb.append('.').toString()
}

@Composable
fun InviteResult(inv: InviteDto, onCopy: (String) -> Unit, onShare: (String) -> Unit, onDone: () -> Unit) {
    var copied by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        QrCode(inv.url)
        MutedLine("Let them scan this, or send the link.")
        Text(inv.url, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TeachButton(if (copied) "Copied ✓" else "Copy", Modifier.weight(1f)) { onCopy(inv.url); copied = true }
            TeachButton("Share…", Modifier.weight(1f), primary = true) { onShare(inv.url) }
        }
        SecondaryPill("Done", Modifier.fillMaxWidth(), onClick = onDone)
        MutedLine(inviteSummary(inv))
    }
}
