package dev.jeromeswannack.chineselearning.lab.ui.more

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.launch

/** `/more` — the More tab (shell-owned; features add rows through MoreExtraRows.kt or by landing their route). */
fun NavGraphBuilder.moreGraph(nav: LabNav) {
    composable(Routes.route(Routes.MORE)) {
        val app = nav.app
        val shell by nav.shell.collectAsStateWithLifecycle()
        val sync by app.repo.status.collectAsStateWithLifecycle()
        val pending by app.outbox.observe().collectAsStateWithLifecycle(emptyList())
        var sound by remember { mutableStateOf(app.prefs.soundOn) }
        var haptics by remember { mutableStateOf(app.prefs.hapticsOn) }
        val native = remember { MORE_PATHS.filter(nav::isNative).toSet() }
        MoreScreen(
            ui = MoreUi(
                userName = app.prefs.userName,
                email = app.prefs.userEmail,
                pictureUrl = app.prefs.userPicture,
                role = shell?.role ?: dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole(),
                isAdmin = app.prefs.isAdmin,
                sync = sync,
                pendingWrites = pending.count { it.state == dev.jeromeswannack.chineselearning.lab.data.platform.Outbox.PENDING },
                soundOn = sound,
                hapticsOn = haptics,
                native = native,
            ),
            actions = MoreActions(
                open = nav::open,
                onToggleSound = { sound = it; app.prefs.soundOn = it },
                onToggleHaptics = { haptics = it; app.prefs.hapticsOn = it; if (it) app.haptics.tick() },
                onFullSync = { app.scope.launch { app.repo.sync(forceFull = true) } },
                onOpenMainApp = { nav.openInMainApp("/") },
                onSignOut = { app.scope.launch { app.repo.signOut(); nav.onSignedOut() } },
            ),
            extraRows = labExtraRows(nav),
        )
    }
}

/** Every path a More row can open (to mark which ones are native). */
private val MORE_PATHS = listOf(
    Routes.SETTINGS, Routes.profile(), Routes.CONNECTIONS, Routes.LIBRARY, Routes.readers(), Routes.calls(), Routes.coach(), Routes.analyze(),
    Routes.lessons(), Routes.claudeChats(), Routes.strokes(), Routes.quests(), Routes.homework(), Routes.lessonNotes(),
    Routes.catalogue(), Routes.duplicateFinder(), Routes.sentenceCoverage(), Routes.admin(),
)
