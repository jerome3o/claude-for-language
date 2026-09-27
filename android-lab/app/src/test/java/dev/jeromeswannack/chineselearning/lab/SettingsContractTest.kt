package dev.jeromeswannack.chineselearning.lab

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.bio
import dev.jeromeswannack.chineselearning.lab.data.api.commentOnFeatureRequest
import dev.jeromeswannack.chineselearning.lab.data.api.createFeatureRequest
import dev.jeromeswannack.chineselearning.lab.data.api.exportBackup
import dev.jeromeswannack.chineselearning.lab.data.api.featureRequest
import dev.jeromeswannack.chineselearning.lab.data.api.featureRequests
import dev.jeromeswannack.chineselearning.lab.data.api.myCardReviews
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveBio
import dev.jeromeswannack.chineselearning.lab.data.api.saveLandingPage
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.sentenceCoverage
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID

/**
 * Package D's endpoints against a real local worker (E2E_TEST_MODE):
 * `LAB_E2E_API=http://localhost:8787 ./gradlew :app:testDebugUnitTest --tests '*SettingsContractTest*'`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SettingsContractTest {
    private val base = System.getenv("LAB_E2E_API")
    private val json = Json { ignoreUnknownKeys = true }

    private fun raw(method: String, path: String, token: String?, body: String? = null): String {
        val b = Request.Builder().url(base + path)
        token?.let { b.header("Authorization", "Bearer $it") }
        b.method(method, body?.toRequestBody("application/json".toMediaType()))
        return OkHttpClient().newCall(b.build()).execute().use { it.body!!.string() }
    }

    @Test fun settingsAndProgressEndpoints() = runBlocking {
        assumeTrue("set LAB_E2E_API to run against a local worker", base != null)
        val token = json.parseToJsonElement(raw("POST", "/api/test/auth", null, """{"email":"lab-d-${UUID.randomUUID()}@example.com","name":"Lab D"}"""))
            .jsonObject["session_token"]!!.jsonPrimitive.content
        val api = Api(base) { token }

        assertEquals(StudyBudgetDto(7, 2), api.saveStudyBudget(StudyBudgetDto(7, 2)))
        val me = json.parseToJsonElement(raw("GET", "/api/auth/me", token)).jsonObject
        assertEquals(7, me["new_cards_per_day"]!!.jsonPrimitive.content.toInt())
        try {
            api.saveStudyBudget(StudyBudgetDto(201, 2)); fail("201 is over the max")
        } catch (e: HttpException) {
            assertEquals(400, e.code); assertTrue(e.problems().isNotEmpty())
        }

        assertEquals("decks", api.saveLandingPage("decks"))
        assertNull(api.saveLandingPage(null)) // "Automatic"

        assertEquals("I like 咖啡.", api.saveBio("I like 咖啡."))
        assertEquals("I like 咖啡.", api.bio())
        assertNull(api.saveBio(null))

        val backup = json.parseToJsonElement(api.exportBackup()).jsonObject
        assertTrue(backup.isNotEmpty())

        val id = api.createFeatureRequest("Streak on the Lab home screen", "Lab app (Android) · Settings").id
        api.commentOnFeatureRequest(id, "and the heatmap")
        assertTrue(api.featureRequests().any { it.id == id })
        assertEquals("and the heatmap", api.featureRequest(id).comments.single().content)

        val stats = api.sentenceCoverage()
        assertEquals(0, stats.notes.total)

        // A review's recording URL for the card-on-a-day screen.
        val deckId = json.parseToJsonElement(raw("POST", "/api/decks", token, """{"name":"D"}""")).jsonObject["id"]!!.jsonPrimitive.content
        raw("POST", "/api/decks/$deckId/notes", token, """{"hanzi":"猫","pinyin":"māo","english":"cat"}""")
        val deck = json.parseToJsonElement(raw("GET", "/api/decks/$deckId", token)).jsonObject
        val cardId = deck["notes"]!!.jsonArray[0].jsonObject["cards"]!!.jsonArray[0].jsonObject["id"]!!.jsonPrimitive.content
        val at = "2026-09-20T08:00:00.000Z"
        raw("POST", "/api/reviews", token, """{"events":[{"id":"ev-${UUID.randomUUID()}","card_id":"$cardId","rating":2,"reviewed_at":"$at"}]}""")
        val reviews = api.myCardReviews("2026-09-20", cardId).reviews
        assertEquals(1, reviews.size)
        assertEquals(2, reviews[0].rating)
    }
}
