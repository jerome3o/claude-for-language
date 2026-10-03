package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.MeDto
import dev.jeromeswannack.chineselearning.lab.data.ChangesDto
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetInfoDto
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveOwnStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudentStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.studentStudyBudget
import dev.jeromeswannack.chineselearning.lab.ui.settings.budgetSetByLine
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.ZoneId

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class TutorBudgetLogicTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val minghui = """{"new_cards_per_day":5,"secondary_cards_per_day":10,"is_default":false,"set_by_id":"t1","set_by_name":"Minghui Wang","set_by_tutor":true,"set_at":"2026-10-02T23:30:00.000Z"}"""

    @Test fun tutorEndpointsSendNullsAndReadTheInfo() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }

        server.enqueue(MockResponse().setBody("""{"budget":$minghui,"default":{"new_cards_per_day":3,"secondary_cards_per_day":6},"top_deck":{"id":"d1","name":"HSK 1","words_to_go":41}}"""))
        val got = api.studentStudyBudget("rel1")
        assertEquals("GET /api/relationships/rel1/student-study-budget", server.takeRequest().let { "${it.method} ${it.path}" })
        assertEquals(StudyBudget(5, 10), got.budget.toInfo().budget)
        assertEquals(41, got.top_deck?.words_to_go)
        assertEquals(StudyBudget(3, 6), got.default.toBudget())

        server.enqueue(MockResponse().setBody("""{"budget":$minghui,"changed":true,"message_sent":true}"""))
        val saved = api.saveStudentStudyBudget("rel1", 5, 10)
        assertTrue(saved.message_sent)
        server.takeRequest().let {
            assertEquals("PUT /api/relationships/rel1/student-study-budget", "${it.method} ${it.path}")
            assertEquals("""{"new_cards_per_day":5,"secondary_cards_per_day":10}""", it.body.readUtf8())
        }

        // Reset to default: both null, sent explicitly (the API's Json would drop them).
        server.enqueue(MockResponse().setBody("""{"budget":{"new_cards_per_day":3,"secondary_cards_per_day":6,"is_default":true,"set_by_id":"t1","set_by_name":"Minghui","set_by_tutor":true,"set_at":"2026-10-03T10:00:00Z"},"changed":true,"message_sent":true}"""))
        assertTrue(api.saveStudentStudyBudget("rel1", null, null).budget.is_default)
        assertEquals("""{"new_cards_per_day":null,"secondary_cards_per_day":null}""", server.takeRequest().body.readUtf8())

        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"x","problems":["new_cards_per_day must be a whole number between 0 and 200"]}"""))
        try {
            api.saveStudentStudyBudget("rel1", 500, 6)
            fail("expected a 400")
        } catch (e: HttpException) {
            assertEquals(listOf("new_cards_per_day must be a whole number between 0 and 200"), e.problems())
        }
        server.takeRequest()

        // The learner's own save returns the info with set_by_tutor false.
        server.enqueue(MockResponse().setBody("""{"new_cards_per_day":4,"secondary_cards_per_day":6,"is_default":false,"set_by_id":"me","set_by_name":"Jerome","set_by_tutor":false,"set_at":"2026-10-03T11:00:00Z"}"""))
        val own = api.saveOwnStudyBudget(4, 6).toInfo()
        assertFalse(own.setByTutor)
        assertEquals("PUT /api/profile/study-budget", server.takeRequest().let { "${it.method} ${it.path}" })
        server.shutdown()
    }

    @Test fun meChangesAndOverviewCarryTheBudget() {
        val me = json.decodeFromString(MeDto.serializer(), """{"id":"me","new_cards_per_day":5,"secondary_cards_per_day":10,"study_budget":$minghui}""")
        assertEquals("Minghui Wang", me.study_budget?.set_by_name)
        // An older server: no object, the flat numbers stay.
        assertNull(json.decodeFromString(MeDto.serializer(), """{"id":"me"}""").study_budget)
        val ch = json.decodeFromString(ChangesDto.serializer(), """{"server_time":"2026-10-03T10:00:00Z","study_budget":$minghui}""")
        assertTrue(ch.study_budget!!.set_by_tutor)
        val ov = json.decodeFromString(StudentOverviewDto.serializer(), """{"relationship_id":"r","student":{"id":"s"},"study_budget":$minghui}""")
        assertEquals(10, ov.study_budget?.secondary_cards_per_day)
    }

    @Test fun prefsKeepWhoSetItAndTheStudyQueueReadsTheNumbers() {
        val prefs = Prefs(RuntimeEnvironment.getApplication())
        val info = json.decodeFromString(StudyBudgetInfoDto.serializer(), minghui).toInfo()
        prefs.budgetInfo = info
        assertEquals(StudyBudget(5, 10), prefs.budget) // what the study queue / Home read
        assertEquals(info, prefs.budgetInfo)
        prefs.budgetInfo = info.copy(setByTutor = false, setByName = "Jerome")
        assertFalse(prefs.budgetInfo.setByTutor)
    }

    @Test fun wordsOnTheRowChipAndSettings() {
        val info = json.decodeFromString(StudyBudgetInfoDto.serializer(), minghui)
        assertEquals("5 new words + 10 extra a day", budgetRowValue(info.toInfo()))
        assertEquals("3 new words + 6 extra a day · default", budgetRowValue(StudyBudgetInfoDto(3, 6, is_default = true).toInfo()))
        assertEquals("📚 5 + 10 a day", budgetChip(info))
        assertNull(budgetChip(StudyBudgetInfoDto(3, 6, is_default = true)))
        assertNull(budgetChip(null))
        // 23:30 UTC on 2 Oct is 3 Oct in Shanghai and 2 Oct in London-in-winter/UTC.
        assertEquals("Set by Minghui · 3 Oct", budgetSetByLine(info.toInfo(), ZoneId.of("Asia/Shanghai")))
        assertEquals("Set by Minghui · 2 Oct", budgetSetByLine(info.toInfo(), ZoneId.of("UTC")))
        assertNull(budgetSetByLine(info.toInfo().copy(setByTutor = false), ZoneId.of("UTC")))
    }
}
