package dev.jeromeswannack.chineselearning.lab.ui.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/** `/profile` — the Profile screen (web: pages/ProfilePage.tsx). */
fun NavGraphBuilder.profileGraph(nav: LabNav) {
    composable(Routes.route(Routes.profile())) {
        val app = nav.app
        val vm: ProfileViewModel = viewModel(factory = ProfileViewModel.Factory(app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val shell by nav.shell.collectAsStateWithLifecycle()
        val online by app.online.collectAsStateWithLifecycle()
        val role = shell?.role ?: NavRole()
        val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.pickPhoto(uri) }

        ProfileScreen(
            ui,
            ProfileEnv(teaches = role.isTutorAccount || role.hasStudents, learns = !role.isTutorOnly && !role.isTutorAccount, online = online),
            ProfileActions(
                onBack = if (nav.controller.previousBackStackEntry != null) nav::back else null,
                edit = vm::edit,
                save = { vm.save() },
                discard = vm::discard,
                useGoogleName = { vm.useGoogleName() },
                pickPhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                resetPhoto = { vm.resetPhoto(it) },
                retry = { vm.load() },
            ),
        )
        ui.photo?.let { photo ->
            PhotoCropSheet(photo, ui.photoBusy, ui.photoError, onCancel = vm::cancelPhoto, onConfirm = { vm.uploadCrop(it) })
        }
    }
}
