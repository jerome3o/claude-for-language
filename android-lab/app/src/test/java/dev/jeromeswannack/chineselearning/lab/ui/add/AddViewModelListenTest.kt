package dev.jeromeswannack.chineselearning.lab.ui.add

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The ＋ Add tab never records by itself (Jerome, Nov 2026: "Go to the plus sign and have to click to start
 * recording"). Only the tap on 🎤 Say it / 🗣 In English opens the box listening, once; the ViewModel outlives a tab
 * switch, so coming back must find nothing waiting to start.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class AddViewModelListenTest {
    private val store = ViewModelStore()
    private var n = 0
    private fun vm(): AddViewModel = ViewModelProvider(store, object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AddViewModel(ApplicationProvider.getApplicationContext<LabApp>()) as T
    })["add-${n++}", AddViewModel::class.java]

    /** Cancel each ViewModel's scope (its connectivity collector) so nothing outlives the test. */
    @After fun clear() = store.clear()

    @Test fun aFreshTabHasNothingToStart() {
        val ui = vm().ui.value
        assertNull(ui.method)
        assertNull(ui.listenBox)
    }

    @Test fun theSayItTapListensOnceThenNeverAgain() {
        val vm = vm()
        vm.pickMethod(AddMethod.SAY_ZH)
        assertEquals(vm.ui.value.boxKey, vm.ui.value.listenBox)
        vm.listened() // the box started for that tap
        assertNull(vm.ui.value.listenBox) // back on the tab: the box waits for a tap on 🎤
        vm.pickMethod(AddMethod.SAY_EN)
        assertEquals(vm.ui.value.boxKey, vm.ui.value.listenBox)
    }

    @Test fun typingNeverListens() {
        val vm = vm()
        vm.pickMethod(AddMethod.SAY_ZH)
        vm.pickMethod(AddMethod.TYPE)
        assertNull(vm.ui.value.listenBox)
    }
}
