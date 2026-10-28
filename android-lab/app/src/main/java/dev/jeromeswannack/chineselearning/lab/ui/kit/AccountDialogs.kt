package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import dev.jeromeswannack.chineselearning.lab.core.auth.SessionRules
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * Sign-in safety (CLAUDE.md "Sign-in & sessions", core auth/SessionRules; web
 * components/auth/SignedOutBanner.tsx + AccountGuards.tsx):
 *  - SignedOutBanner: "You're signed out" on every screen while a 401 says the session is gone;
 *  - SignOutUnsyncedDialog: Sign out with work not uploaded → Sync first / Sign out anyway (deletes nothing);
 *  - AccountSwitchDialog: a DIFFERENT account signing in over unsent work → Sign back in / Discard.
 */

const val SIGNED_OUT_BANNER_TAG = "signed-out-banner"
const val SIGNED_OUT_SIGN_IN_TAG = "signed-out-sign-in"

private val BannerBg = Color(0xFF7C2D12)

/** Not dismissable: it goes when a request works again or after Sign in. [compact] = a full-screen route (a study session). */
@Composable
fun SignedOutBanner(onSignIn: () -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    if (compact) {
        Row(
            modifier.fillMaxWidth().background(BannerBg).clickable(onClick = onSignIn).heightIn(min = 44.dp).padding(horizontal = 16.dp, vertical = 8.dp).testTag(SIGNED_OUT_BANNER_TAG),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Text("⚠️ Signed out · ", color = Color.White, fontSize = 14.sp)
            Text("Sign in", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.testTag(SIGNED_OUT_SIGN_IN_TAG))
        }
        return
    }
    Row(
        modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(16.dp)).background(BannerBg).padding(start = 14.dp, end = 8.dp, top = 10.dp, bottom = 10.dp).testTag(SIGNED_OUT_BANNER_TAG),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("🔒", fontSize = 20.sp)
        Text(SessionRules.signedOutBanner("lab"), color = Color.White, fontSize = 14.sp, lineHeight = 19.sp, modifier = Modifier.weight(1f))
        Text(
            "Sign in",
            color = BannerBg,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color.White).clickable(onClick = onSignIn).heightIn(min = 44.dp).padding(horizontal = 16.dp, vertical = 12.dp).testTag(SIGNED_OUT_SIGN_IN_TAG),
        )
    }
}

/** Settings / More → Sign out with something not uploaded. "Sign out anyway" keeps the data on this phone. */
@Composable
fun SignOutUnsyncedDialog(unsynced: SessionRules.Unsynced, onSyncFirst: () -> Unit, onSignOutAnyway: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Lab.colors.card,
        title = { Text("Sign out?", color = Lab.colors.ink) },
        text = { Text(SessionRules.signOutWarning(unsynced), color = Lab.colors.muted, modifier = Modifier.testTag("signout-unsynced")) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onSyncFirst() }, modifier = Modifier.testTag("signout-sync-first")) {
                Text("Sync first", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onDismiss) { Text("Cancel", color = Lab.colors.muted) }
                TextButton(onClick = { onDismiss(); onSignOutAnyway() }, modifier = Modifier.testTag("signout-anyway")) { Text("Sign out anyway", color = Palette.Again) }
            }
        },
    )
}

/** A different account signed in while this phone holds the previous one's unsent work. Not dismissable. */
@Composable
fun AccountSwitchDialog(unsynced: SessionRules.Unsynced, previousEmail: String?, nextEmail: String?, onSignBackIn: () -> Unit, onDiscard: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = {},
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
        containerColor = Lab.colors.card,
        title = { Text("This phone has another account’s work", color = Lab.colors.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("account-switch")) {
                Text(SessionRules.switchAccountWarning(unsynced, previousEmail), color = Lab.colors.muted)
                if (!nextEmail.isNullOrBlank()) Text("You signed in as $nextEmail.", color = Lab.colors.muted, fontSize = 13.sp)
            }
        },
        confirmButton = {
            TextButton(onClick = onSignBackIn, modifier = Modifier.testTag("account-switch-back")) {
                Text(if (previousEmail.isNullOrBlank()) "Sign back in" else "Sign back in as $previousEmail", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            if (!confirming) {
                TextButton(onClick = { confirming = true }, modifier = Modifier.testTag("account-switch-discard")) { Text("Discard…", color = Palette.Again) }
            } else {
                TextButton(onClick = onDiscard, modifier = Modifier.testTag("account-switch-discard-confirm")) {
                    Text("Discard ${"%,d".format(java.util.Locale.US, unsynced.total)} unsent item${if (unsynced.total == 1) "" else "s"}", color = Palette.Again, fontWeight = FontWeight.SemiBold)
                }
            }
        },
    )
}
