package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudentProfileFields
import dev.jeromeswannack.chineselearning.lab.data.api.StudentProfileEnvelope
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudentProfile
import dev.jeromeswannack.chineselearning.lab.data.api.studentProfile
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.launch

/** The tutor's private profile of the student on the student page (cached for offline reading; saved online). */
class StudentProfileController(private val app: LabApp, private val vm: ViewModel, private val relId: String, private val onSaved: () -> Unit = {}) {
    val resource: CachedResource<StudentProfileEnvelope> =
        app.cachedResource(vm.viewModelScope, "teaching/student-profile/$relId", TeachingKeys.KIND) { studentProfile(relId) }

    fun save(fields: StudentProfileFields, done: (String?) -> Unit) = vm.viewModelScope.launch {
        attempt { app.repo.api.saveStudentProfile(relId, fields) }
            .onSuccess { r ->
                resource.update { r }
                app.haptics.correct()
                app.sounds.play(Sounds.Sfx.POP)
                // The dashboard's "+ Student profile" hint follows.
                app.scope.launch { app.cache.delete(TeachingKeys.DASHBOARD) }
                onSaved()
                done(null)
            }
            .onFailure { done(it.userMessage().ifBlank { "Could not save the profile" }) }
    }
}
