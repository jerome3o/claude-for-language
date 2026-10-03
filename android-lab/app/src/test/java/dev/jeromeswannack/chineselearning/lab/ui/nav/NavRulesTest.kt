package dev.jeromeswannack.chineselearning.lab.ui.nav

import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Case-by-case port of frontend/src/components/nav/navRole.test.ts + landing.test.ts. */
class NavRulesTest {
    private var n = 0
    private fun rel(status: String) = RelationshipDto(id = "rel-${n++}", requester_id = "a", recipient_id = "b", requester_role = "tutor", status = status)
    private fun rels(tutors: List<RelationshipDto> = emptyList(), students: List<RelationshipDto> = emptyList()) = MyRelationshipsDto(tutors = tutors, students = students)
    private fun labels(role: NavRole) = NavRules.tabsFor(role).map { it.label }

    @Test fun plainStudentUntilRelationshipsLoad() {
        assertEquals(NavRules.STUDENT_ROLE, NavRules.deriveNavRole(null, 3, 5))
        assertFalse(NavRules.deriveNavRole(null, 0, 0).loaded)
    }

    @Test fun studentWithTutor() {
        assertEquals(NavRole(hasStudents = false, hasTutor = true, isTutorOnly = false, loaded = true), NavRules.deriveNavRole(rels(tutors = listOf(rel("active"))), 2, 9))
    }

    @Test fun onlyActiveRelationshipsCount() {
        val role = NavRules.deriveNavRole(rels(students = listOf(rel("pending"), rel("removed")), tutors = listOf(rel("pending"))), 0, 0)
        assertFalse(role.hasStudents); assertFalse(role.hasTutor); assertFalse(role.isTutorOnly)
    }

    @Test fun tutorOnly() {
        val base = rels(students = listOf(rel("active")))
        assertTrue(NavRules.deriveNavRole(base, 0, 0).isTutorOnly)
        assertFalse(NavRules.deriveNavRole(base, 1, 0).isTutorOnly)
        assertFalse(NavRules.deriveNavRole(base, 0, 4).isTutorOnly)
        assertFalse(NavRules.deriveNavRole(base, 0, 0, countsLoading = true).isTutorOnly)
    }

    @Test fun tutorWhoAlsoStudies() {
        val role = NavRules.deriveNavRole(rels(students = listOf(rel("active")), tutors = listOf(rel("active"))), 4, 12)
        assertTrue(role.hasStudents); assertTrue(role.hasTutor); assertFalse(role.isTutorOnly)
    }

    @Test fun tabSets() {
        assertEquals(listOf("Study", "Chats", "Tutor", "Progress", "More"), labels(NavRole(hasStudents = false, isTutorOnly = false)))
        assertEquals(listOf("Students", "Chats", "Study", "More"), labels(NavRole(hasStudents = true, isTutorOnly = true)))
        assertEquals(listOf("Students", "Chats", "Study", "Progress", "More"), labels(NavRole(hasStudents = true, isTutorOnly = false)))
        assertEquals(listOf("Students", "Chats", "Library", "More"), labels(NavRole(hasStudents = true, isTutorAccount = true)))
        assertEquals(NavRules.CHATS, NavRules.tabsFor(NavRole())[1])
        assertEquals("/chats", NavRules.CHATS.to)
    }

    @Test fun activeTabByPath() {
        val tabs = NavRules.tabsFor(NavRole())
        mapOf(
            "/" to TabId.STUDY, "/study/review/abc" to TabId.STUDY, "/decks" to TabId.MORE, "/decks/123" to TabId.MORE,
            "/generate" to TabId.MORE, "/search" to TabId.MORE, "/connections/1/insights" to TabId.TUTOR, "/progress/day/2026-01-01" to TabId.PROGRESS,
            "/more" to TabId.MORE, "/settings/sentences" to TabId.MORE, "/coach" to TabId.MORE, "/lesson-notes" to TabId.MORE,
            "/decks?q=打算" to TabId.MORE, "/chats" to TabId.CHATS, "/chats?q=x" to TabId.CHATS,
        ).forEach { (path, id) -> assertEquals(path, id, NavRules.activeTab(tabs, path)) }
        assertNull(NavRules.activeTab(tabs, "/join/xyz"))
    }

    @Test fun immersiveRoutes() {
        listOf(
            "/study", "/study/", "/quests/abc", "/picture-hunt/h1", "/readers/r1", "/readers/r1/edit", "/readers/r1/print", "/library/l1/edit", "/lessons/l1/print",
            "/library/catalogue/conversation", "/connections/1/chat/2", "/join/token", "/calls/c1", "/homework/a1", "/study?deck=d1", "/tutor-notes/practice?cards=c1",
        ).forEach { assertTrue(it, NavRules.isImmersiveRoute(it)) }
        listOf(
            "/", "/study/review/abc", "/quests", "/readers", "/readers/generate", "/library", "/library/l1", "/library/catalogue",
            "/lessons", "/connections/1", "/decks", "/chats", "/more", "/settings", "/calls", "/calls/c1/review", "/homework",
        ).forEach { assertFalse(it, NavRules.isImmersiveRoute(it)) }
    }

    @Test fun tutorAccount() {
        assertTrue(NavRules.deriveNavRole(null, 4, 12, accountRole = "tutor").isTutorAccount)
        val none = NavRules.deriveNavRole(rels(), 4, 12, accountRole = "tutor")
        assertTrue(none.isTutorAccount); assertTrue(none.isTutorOnly); assertFalse(none.hasStudents)
        val role = NavRules.deriveNavRole(rels(students = listOf(rel("active"))), 2, 5, accountRole = "tutor")
        assertEquals(listOf(TabId.STUDENTS, TabId.CHATS, TabId.LIBRARY, TabId.MORE), NavRules.tabsFor(role).map { it.id })
        assertEquals(TabId.LIBRARY, NavRules.activeTab(NavRules.tabsFor(role), "/library/abc"))
        val student = NavRules.deriveNavRole(rels(), 2, 5, accountRole = "student")
        assertEquals(listOf(TabId.STUDY, TabId.CHATS, TabId.TUTOR, TabId.PROGRESS, TabId.MORE), NavRules.tabsFor(student).map { it.id })
        assertTrue(NavRules.isImmersiveRoute("/decks/d1/try"))
        assertTrue(NavRules.isImmersiveRoute("/library/l1/try"))
        assertFalse(NavRules.isImmersiveRoute("/decks/d1"))
    }

    @Test fun landing() {
        assertEquals(LandingPage.STUDENTS, NavRules.resolveLanding(LandingPage.STUDENTS, false, 12, false))
        assertEquals(LandingPage.DECKS, NavRules.resolveLanding(LandingPage.DECKS, true, 0, false))
        assertEquals(LandingPage.STUDY, NavRules.resolveLanding(LandingPage.STUDY, true, 0, false))
        assertEquals(LandingPage.STUDENTS, NavRules.resolveLanding(LandingPage.STUDENTS, true, 0, true))
        assertEquals(LandingPage.STUDY, NavRules.resolveLanding(null, false, 0, false))
        assertEquals(LandingPage.STUDY, NavRules.resolveLanding(null, false, 40, false))
        assertEquals(LandingPage.STUDENTS, NavRules.resolveLanding(null, true, 0, false))
        assertEquals(LandingPage.STUDY, NavRules.resolveLanding(null, true, 3, false))
        assertEquals(LandingPage.STUDY, NavRules.resolveLanding(null, true, 0, true))
        assertEquals(LandingPage.STUDY, NavRules.resolveLanding(null, false, 0, true))
        assertEquals(LandingPage.STUDENTS, NavRules.resolveLanding(null, false, 12, false, true))
        assertEquals(LandingPage.STUDENTS, NavRules.resolveLanding(null, true, 0, true, true))
        assertEquals(LandingPage.DECKS, NavRules.resolveLanding(LandingPage.DECKS, true, 0, false, true))
        assertEquals("/", NavRules.LANDING_PATHS[LandingPage.STUDY])
        assertEquals("/connections", NavRules.LANDING_PATHS[LandingPage.STUDENTS])
        assertEquals("/decks", NavRules.LANDING_PATHS[LandingPage.DECKS])
        assertEquals(LandingPage.STUDENTS, LandingPage.fromWire("students"))
        assertNull(LandingPage.fromWire(null))
    }

    @Test fun webDestinationsCoverEveryTabAndMostSpecificWins() {
        assertEquals("Deck", WebDestinations.find("/decks/abc")?.title)
        assertEquals("Try it as a student", WebDestinations.find("/decks/abc/try")?.title)
        assertEquals("Chat", WebDestinations.find("/connections/r1/chat/c1")?.title)
        assertEquals("New story", WebDestinations.find("/readers/generate")?.title)
        assertEquals("Sentence Coach", WebDestinations.find("/coach?text=你好")?.title)
        for (tab in listOf(NavRules.STUDY, NavRules.CHATS, NavRules.TUTOR, NavRules.LIBRARY, NavRules.PROGRESS, NavRules.MORE)) {
            assertTrue(tab.to, WebDestinations.find(tab.to) != null)
        }
        assertNull(WebDestinations.find("/nope/nothing/here"))
    }
}
