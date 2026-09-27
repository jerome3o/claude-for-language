package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Same cases as frontend/src/services/offlineMode.ts resolveOfflineMode. */
class OfflineModeTest {
    @Test fun resolves() {
        assertEquals("Forced offline", OfflineMode.resolve(forced = true, isOnline = true).label)
        assertEquals("Forced offline", OfflineMode.resolve(forced = true, isOnline = false).label)
        assertEquals("Auto · offline", OfflineMode.resolve(forced = false, isOnline = false).label)
        val online = OfflineMode.resolve(forced = false, isOnline = true)
        assertEquals("Auto · online", online.label)
        assertFalse(online.effectiveOffline)
        assertTrue(OfflineMode.resolve(false, false).effectiveOffline)
    }

    @Test fun cycles() {
        assertTrue(OfflineMode.nextForced(OfflineMode.resolve(false, true)))
        assertTrue(OfflineMode.nextForced(OfflineMode.resolve(false, false)))
        assertFalse(OfflineMode.nextForced(OfflineMode.resolve(true, true)))
    }
}
