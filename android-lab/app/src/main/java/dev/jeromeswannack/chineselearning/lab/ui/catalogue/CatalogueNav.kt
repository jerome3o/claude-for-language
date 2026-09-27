package dev.jeromeswannack.chineselearning.lab.ui.catalogue

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.core.spec.SampleLesson
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummary
import dev.jeromeswannack.chineselearning.lab.data.api.createLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.library.LibraryDeps
import dev.jeromeswannack.chineselearning.lab.ui.library.LibraryKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer

/**
 * `/library/catalogue` — the exercise catalogue (package G; web: pages/editor/ExerciseCataloguePage.tsx).
 * Registered ABOVE libraryGraph so the literal path wins over `/library/{id}`. The sample
 * trial (`/library/catalogue/{sampleId}`) is the lesson player's screen (ui/editor).
 */
fun NavGraphBuilder.catalogueGraph(nav: LabNav) {
    composable(Routes.route(Routes.catalogue())) { CatalogueRoute(nav) }
}

/** The catalogue with its model — also used by `/library/{id}` if it is ever handed id = "catalogue". */
@Composable
fun CatalogueRoute(nav: LabNav) {
    val vm: CatalogueViewModel = viewModel(factory = viewModelFactory { initializer { CatalogueViewModel(LibraryDeps.from(nav.app)) } })
    val model = vm.model
    val ui by model.ui.collectAsStateWithLifecycle()
    LaunchedEffect(model) { model.opens.collect { nav.open(it) } }
    CatalogueScreen(
        ui,
        CatalogueActions(
            onBack = nav::back,
            onSkill = model::setSkill,
            onTry = { nav.open(Routes.catalogueTrial(it.id)) },
            onCopy = model::copy,
        ),
    )
}

/** Filter + "Copy to my library" (a library item from the sample, then its editor). */
class CatalogueModel(private val scope: CoroutineScope, private val deps: LibraryDeps) {
    private val _ui = MutableStateFlow(CatalogueUi())
    val ui: StateFlow<CatalogueUi> = _ui.asStateFlow()

    private val _opens = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val opens: SharedFlow<String> = _opens.asSharedFlow()

    fun setSkill(skill: String?) {
        deps.feel.tick()
        _ui.update { it.copy(skill = skill) }
    }

    fun copy(sample: SampleLesson) {
        if (_ui.value.copying != null) return
        _ui.update { it.copy(copying = sample.id, error = null) }
        scope.launch {
            try {
                val item = deps.api.createLibraryItem(sample.spec)
                // The library list shows it straight away (its next refresh fills in the counts).
                runCatching {
                    val ser = ListSerializer(LibraryItemSummary.serializer())
                    deps.cache.get(LibraryKeys.LIST, ser)?.let { list ->
                        val row = LibraryItemSummary(item.id, item.title, item.description, item.icon, item.tags, item.version, item.created_at, item.updated_at, 0, item.spec.let { dev.jeromeswannack.chineselearning.lab.ui.library.LibraryText.exerciseCount(it) })
                        deps.cache.put(LibraryKeys.LIST, LibraryKeys.KIND, listOf(row) + list.filter { it.id != item.id }, ser)
                    }
                }
                deps.feel.success()
                _ui.update { it.copy(copying = null) }
                _opens.tryEmit(Routes.libraryEdit(item.id))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(copying = null, error = "Could not copy the sample: ${e.userMessage()}") }
            }
        }
    }
}

class CatalogueViewModel(deps: LibraryDeps) : ViewModel() {
    val model = CatalogueModel(viewModelScope, deps)
}
