package dev.jeromeswannack.chineselearning.lab.ui.profile

import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.ProfileDto
import dev.jeromeswannack.chineselearning.lab.data.api.ProfileField
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.profile
import dev.jeromeswannack.chineselearning.lab.data.api.removeProfilePicture
import dev.jeromeswannack.chineselearning.lab.data.api.saveProfile
import dev.jeromeswannack.chineselearning.lab.data.api.uploadProfilePicture
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** What the text fields hold (frontend services/profileForm.ts ProfileDraft). */
data class ProfileDraft(
    val name: String = "",
    val about: String = "",
    val timeZone: String = "",
    val bio: String = "",
    /** male | female | other | null — "Your voice when your messages are read aloud" (core ChatVoice). */
    val voiceGender: String? = null,
) {
    companion object {
        fun from(p: ProfileDto) = ProfileDraft(p.name.orEmpty(), p.about.orEmpty(), p.time_zone.orEmpty(), p.bio.orEmpty(), dev.jeromeswannack.chineselearning.lab.core.ChatVoice.parse(p.voice_gender))
    }
}

/** The fields that changed (profileChanges): name "" is sent so the server says why. */
data class ProfileChanges(val name: String? = null, val about: ProfileField? = null, val timeZone: ProfileField? = null, val bio: ProfileField? = null, val voiceGender: ProfileField? = null) {
    val any: Boolean get() = name != null || about != null || timeZone != null || bio != null || voiceGender != null

    /** The same checks the server runs, live. */
    val problems: List<String> get() = ProfileRules.problems(name, about?.value.orEmpty().takeIf { about != null }, bio?.value.orEmpty().takeIf { bio != null })

    companion object {
        fun of(saved: ProfileDto, d: ProfileDraft): ProfileChanges {
            val name = ProfileRules.normalizeName(d.name).takeIf { it != ProfileRules.normalizeName(saved.name.orEmpty()) }
            val about = ProfileRules.normalizeText(d.about).takeIf { it != saved.about.orEmpty() }?.let { ProfileField(it.ifEmpty { null }) }
            val bio = ProfileRules.normalizeText(d.bio).takeIf { it != saved.bio.orEmpty() }?.let { ProfileField(it.ifEmpty { null }) }
            val tz = d.timeZone.trim().takeIf { it != saved.time_zone.orEmpty() }?.let { ProfileField(it.ifEmpty { null }) }
            val voice = if (d.voiceGender != dev.jeromeswannack.chineselearning.lab.core.ChatVoice.parse(saved.voice_gender)) ProfileField(d.voiceGender) else null
            return ProfileChanges(name, about, tz, bio, voice)
        }
    }
}

data class ProfileUi(
    val profile: ProfileDto? = null,
    val loadError: String? = null,
    val draft: ProfileDraft = ProfileDraft(),
    val saving: Boolean = false,
    /** Problems from the server's last 400 (cleared when the draft changes). */
    val serverProblems: List<String> = emptyList(),
    val error: String? = null,
    val flash: String? = null,
    /** A picked photo waiting in the crop sheet. */
    val photo: Bitmap? = null,
    val photoBusy: Boolean = false,
    val photoError: String? = null,
) {
    val changes: ProfileChanges get() = profile?.let { ProfileChanges.of(it, draft) } ?: ProfileChanges()
}

/**
 * Profile (web: pages/ProfilePage.tsx): the same endpoints, the same rules. The profile is
 * cached (`profile/me`) so the screen opens instantly; writes need a connection like the web.
 * Every change also updates the name / picture the rest of the app shows (Prefs).
 */
class ProfileViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(ProfileUi())
    val ui: StateFlow<ProfileUi> = _ui

    init { load() }

    fun load() = viewModelScope.launch {
        app.cache.get<ProfileDto>(CACHE_KEY)?.let { cached -> _ui.update { it.copy(profile = cached, draft = ProfileDraft.from(cached)) } }
        try {
            val p = withContext(Dispatchers.IO) { app.repo.api.profile() }
            applySaved(p, resetDraft = _ui.value.profile == null || !_ui.value.changes.any)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_ui.value.profile == null) _ui.update { it.copy(loadError = e.userMessage()) }
        }
    }

    private suspend fun applySaved(p: ProfileDto, resetDraft: Boolean) {
        app.cache.put(CACHE_KEY, "profile", p)
        app.prefs.userName = p.name
        app.prefs.userPicture = p.picture_url
        app.prefs.voiceGender = dev.jeromeswannack.chineselearning.lab.core.ChatVoice.parse(p.voice_gender)
        _ui.update { it.copy(profile = p, loadError = null, draft = if (resetDraft) ProfileDraft.from(p) else it.draft) }
    }

    fun edit(d: ProfileDraft) = _ui.update { it.copy(draft = d, serverProblems = emptyList(), error = null, flash = null) }

    fun discard() = _ui.update { u -> u.profile?.let { u.copy(draft = ProfileDraft.from(it), serverProblems = emptyList(), error = null) } ?: u }

    fun save() = viewModelScope.launch {
        val c = _ui.value.changes
        if (!c.any || c.problems.isNotEmpty()) return@launch
        _ui.update { it.copy(saving = true, error = null, serverProblems = emptyList()) }
        try {
            val p = withContext(Dispatchers.IO) {
                app.repo.api.saveProfile(name = c.name?.let { ProfileField(it) }, about = c.about, timeZone = c.timeZone, bio = c.bio, voiceGender = c.voiceGender)
            }
            applySaved(p, resetDraft = true)
            _ui.update { it.copy(saving = false, flash = "Profile saved") }
            app.haptics.tick()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val problems = (e as? HttpException)?.problems().orEmpty()
            _ui.update { it.copy(saving = false, serverProblems = problems, error = if (problems.isEmpty()) e.userMessage() else null) }
        }
    }

    fun useGoogleName() = viewModelScope.launch {
        _ui.update { it.copy(saving = true, error = null) }
        try {
            val p = withContext(Dispatchers.IO) { app.repo.api.saveProfile(name = ProfileField(null)) }
            val keep = _ui.value.draft
            applySaved(p, resetDraft = false)
            _ui.update { it.copy(saving = false, draft = keep.copy(name = p.name.orEmpty()), flash = "Using your Google name") }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(saving = false, error = e.userMessage()) }
        }
    }

    fun pickPhoto(uri: Uri) = viewModelScope.launch {
        _ui.update { it.copy(photoError = null) }
        try {
            val bmp = withContext(Dispatchers.IO) { PhotoFiles.decode(app, uri) }
            _ui.update { it.copy(photo = bmp) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(photoError = "This photo couldn't be opened. Try a JPEG or PNG.") }
        }
    }

    fun cancelPhoto() = _ui.update { it.copy(photo = null, photoError = null) }

    fun uploadCrop(rect: ProfileRules.SourceRect) = viewModelScope.launch {
        val photo = _ui.value.photo ?: return@launch
        _ui.update { it.copy(photoBusy = true, photoError = null) }
        try {
            val p = withContext(Dispatchers.IO) {
                val jpeg = PhotoFiles.renderJpeg(photo, rect, File(app.cacheDir, "profile"))
                try { app.repo.api.uploadProfilePicture(jpeg) } finally { jpeg.delete() }
            }
            applySaved(p, resetDraft = false)
            _ui.update { it.copy(photo = null, photoBusy = false, flash = "Photo updated") }
            app.haptics.correct()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(photoBusy = false, photoError = e.userMessage()) }
        }
    }

    fun resetPhoto(useGoogle: Boolean) = viewModelScope.launch {
        _ui.update { it.copy(photoBusy = true, photoError = null) }
        try {
            val p = withContext(Dispatchers.IO) { app.repo.api.removeProfilePicture(useGoogle) }
            applySaved(p, resetDraft = false)
            _ui.update { it.copy(photoBusy = false, flash = if (useGoogle) "Using your Google photo" else "Photo removed") }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(photoBusy = false, photoError = e.userMessage()) }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ProfileViewModel(app) as T
    }

    companion object {
        const val CACHE_KEY = "profile/me"
    }
}
