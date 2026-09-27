package dev.jeromeswannack.chineselearning.lab.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.settings.SettingsStore
import dev.jeromeswannack.chineselearning.lab.ui.more.DebugReportRow
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.launch

/** Where Lab builds are published (Obtainium follows the `Lab v0.N` pre-releases). */
private const val RELEASES_URL = "https://github.com/jerome3o/claude-for-language/releases"

/** Package D — `/settings`, `/settings/sentences`, `/settings/voices`, `/duplicate-finder` (web: SettingsPage, SentenceCoveragePage, DuplicateFinderPage). */
fun NavGraphBuilder.settingsGraph(nav: LabNav) {
    composable(Routes.route(Routes.SETTINGS)) {
        val app = nav.app
        val context = LocalContext.current
        val vm: SettingsViewModel = viewModel(factory = SettingsViewModel.Factory(app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val shell by nav.shell.collectAsStateWithLifecycle()
        val sync by app.repo.status.collectAsStateWithLifecycle()
        val online by app.online.collectAsStateWithLifecycle()
        val store = remember { SettingsStore.get(app) }
        val forced by store.forcedOffline.collectAsStateWithLifecycle()
        val pending by app.outbox.observe().collectAsStateWithLifecycle(emptyList())
        var sound by remember { mutableStateOf(app.prefs.soundOn) }
        var haptics by remember { mutableStateOf(app.prefs.hapticsOn) }
        var feedback by rememberSaveable { mutableStateOf(false) }
        val saveAs = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? -> vm.finishExport(uri) }

        SettingsScreen(
            ui,
            SettingsEnv(
                role = shell?.role ?: NavRole(),
                sync = sync,
                online = online,
                forcedOffline = forced,
                soundOn = sound,
                hapticsOn = haptics,
                pendingWrites = pending.count { it.state == Outbox.PENDING },
            ),
            SettingsActions(
                onBack = if (nav.controller.previousBackStackEntry != null) nav::back else null,
                downloadAudio = { app.repo.prefetchAudioInBackground() },
                setForcedOffline = { store.setForcedOffline(it); app.haptics.tick() },
                exportBackup = { vm.startExport { name -> saveAs.launch(name) } },
                setBudget = vm::setBudgetDraft,
                saveBudget = { vm.saveBudget() },
                chooseLanding = { vm.chooseLanding(it) },
                toggleSound = { sound = it; app.prefs.soundOn = it },
                toggleHaptics = { haptics = it; app.prefs.hapticsOn = it; if (it) app.haptics.tick() },
                signOut = { app.scope.launch { app.repo.signOut(); nav.onSignedOut() } },
                openAdvanced = { vm.loadAudioQuality(); vm.loadRequests() },
                classifyAudio = { vm.classifyAudio() },
                regenerateAudio = { vm.regenerateAudio() },
                open = nav::open,
                openRequest = { vm.openRequest(it) },
                fullSync = { app.scope.launch { app.repo.sync(forceFull = true) } },
                checkForUpdates = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_URL))) } },
                newFeedback = { feedback = true },
            ),
            debugRow = { DebugReportRow(app) },
        )

        ui.openRequest?.let { detail ->
            FeatureRequestSheet(detail, ui.requestBusy, onComment = { text, done -> vm.comment(text, done) }, onDismiss = vm::closeRequest)
        }
        if (feedback) FeedbackSheet(ui.feedbackBusy, onSend = { text, done -> vm.sendFeedback(text, done) }, onDismiss = { feedback = false })
    }

    composable(Routes.route("/settings/sentences")) {
        val app = nav.app
        val vm: SentenceCoverageViewModel = viewModel(factory = SentenceCoverageViewModel.Factory(app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val online by app.online.collectAsStateWithLifecycle()
        SentenceCoverageScreen(
            ui, online,
            CoverageActions(
                onBack = nav::back,
                generate = { vm.generate(it) },
                clueAudio = { vm.clueAudio() },
                syncHere = { vm.syncHere() },
                openDeck = { nav.open(Routes.deck(it)) },
                retry = vm::refresh,
            ),
        )
    }

    composable(Routes.route(Routes.conversationVoices())) {
        val app = nav.app
        val vm: ConversationVoicesViewModel = viewModel(factory = ConversationVoicesViewModel.Factory(app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        ConversationVoicesScreen(
            ui,
            ConversationVoicesActions(
                onBack = nav::back,
                toggle = vm::toggle,
                play = vm::play,
                setGender = vm::setGender,
                setStyle = vm::setStyle,
                setAccent = vm::setAccent,
                setOnlyOn = vm::setOnlyOn,
                reset = vm::reset,
                dismissNotice = vm::dismissNotice,
            ),
        )
    }

    composable(Routes.route("/duplicate-finder")) {
        val app = nav.app
        val vm: DuplicateFinderViewModel = viewModel(factory = DuplicateFinderViewModel.Factory(app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val online by app.online.collectAsStateWithLifecycle()
        DuplicateFinderScreen(ui, online, DuplicateActions(onBack = nav::back, scan = vm::scan, delete = { vm.delete(it) }))
    }
}
