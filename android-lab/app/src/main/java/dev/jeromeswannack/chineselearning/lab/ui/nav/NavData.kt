package dev.jeromeswannack.chineselearning.lab.ui.nav

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.myRelationships
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.ui.home.TodayCounts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object NavKeys {
    /** GET /api/relationships, cached for offline boots (the web's `navRelationshipsCache`). */
    const val RELATIONSHIPS = "nav/relationships"
    const val KIND = "nav"
}

/** Keeps the relationships the tab set depends on fresh (registered in FeatureSyncs). */
object NavSync : FeatureSync {
    override suspend fun sync(ctx: dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext) {
        ctx.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, ctx.api.myRelationships())
    }
}

/** What the shell renders from: the role, its tabs and (once) where to land. */
data class ShellState(
    val role: NavRole,
    val tabs: List<TabSpec>,
    val relationships: MyRelationshipsDto?,
    /** Where the app opens; computed once, from the same inputs as the web's LandingResolver. */
    val landing: String,
)

/**
 * The shell's view of the account — the Lab's `useNavRole` + `LandingResolver`.
 * Relationships come from the JSON cache (refreshed by [NavSync]), the account role and
 * "Start on" from Prefs (mirrored from /api/auth/me), deck and due counts from Room.
 */
class ShellViewModel(private val app: LabApp) : ViewModel() {
    private val _state = MutableStateFlow<ShellState?>(null)
    val state: StateFlow<ShellState?> = _state

    init {
        viewModelScope.launch {
            val relFlow = app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS)
            combine(relFlow, app.repo.dataVersion) { rel, _ -> rel }.collect { rel ->
                // Deck / due counts only matter to an account with students (isTutorOnly, the
                // automatic landing) — skip the queue build for everyone else.
                val needsCounts = app.prefs.accountRole != "tutor" && rel?.students?.any { it.status == "active" } == true
                val counts = if (!needsCounts) 1 to 1 else app.safely("landing counts") {
                    withContext(Dispatchers.IO) { app.repo.dao.decks().size to TodayCounts.compute(app).total }
                } ?: (1 to 1)
                val role = NavRules.deriveNavRole(rel, counts.first, counts.second, countsLoading = false, accountRole = app.prefs.accountRole)
                val landing = _state.value?.landing ?: NavRules.LANDING_PATHS.getValue(
                    NavRules.resolveLanding(LandingPage.fromWire(app.prefs.landingPage), role.hasStudents, counts.second, countsLoading = false, isTutorAccount = role.isTutorAccount),
                )
                _state.value = ShellState(role, NavRules.tabsFor(role), rel, landing)
            }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ShellViewModel(app) as T
    }
}
