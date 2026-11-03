package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * The Ask Claude header toggles (every Claude thread's header — ui/claude/ClaudeThreadScreen.kt — and
 * Settings' copies): 🎧 Listen first and 中文 | EN. Moved here from the retired card sheet
 * (ui/study/AskClaudeSheet.kt; Ask Claude on a card is the card's Claude thread now, CardClaudeSheet.kt).
 */
object AskTags {
    const val LANG_ZH = "ask-lang-zh"
    const val LANG_EN = "ask-lang-en"
    const val LISTEN = "ask-listen-toggle"
}

/** 🎧 — Listen first on / off (Settings has the same switch). */
@Composable
fun ListenToggle(on: Boolean, onChange: (Boolean) -> Unit) {
    val haptics = LocalHapticFeedback.current
    Box(
        Modifier.size(44.dp).clip(CircleShape)
            .background(if (on) Lab.colors.accent.copy(alpha = 0.16f) else Lab.colors.ink.copy(alpha = 0.06f))
            .then(if (on) Modifier.border(2.dp, Lab.colors.accent, CircleShape) else Modifier)
            .toggleable(value = on, role = Role.Switch) { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); onChange(it) }
            .semantics { contentDescription = if (on) "Listen first is on: answers arrive hidden" else "Listen first: hear the answer before you read it" }
            .testTag(AskTags.LISTEN),
        contentAlignment = Alignment.Center,
    ) { Text("🎧", fontSize = 19.sp, modifier = Modifier.alpha(if (on) 1f else 0.55f)) }
}

/** 中文 | EN — what Claude answers in (Settings has the same switch). */
@Composable
fun LanguageToggle(language: String, onChange: (String) -> Unit) {
    val haptics = LocalHapticFeedback.current
    Row(Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.ink.copy(alpha = 0.06f)).padding(2.dp)) {
        for ((value, label, tag) in listOf(Triple(AskClaude.ZH, "中文", AskTags.LANG_ZH), Triple(AskClaude.EN, "EN", AskTags.LANG_EN))) {
            val on = language == value
            Box(
                Modifier.heightIn(min = 40.dp).widthIn(min = 48.dp).clip(RoundedCornerShape(50))
                    .background(if (on) Lab.colors.card else Color.Transparent)
                    .clickable(enabled = !on) { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); onChange(value) }
                    .semantics { contentDescription = if (value == AskClaude.ZH) "Claude answers in Chinese${if (on) ", selected" else ""}" else "Claude answers in English${if (on) ", selected" else ""}" }
                    .testTag(tag)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (on) Lab.colors.accent else Lab.colors.muted) }
        }
    }
}

