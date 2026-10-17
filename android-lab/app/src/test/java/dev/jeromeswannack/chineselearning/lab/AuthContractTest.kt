package dev.jeromeswannack.chineselearning.lab

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.AuthExchange
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.revokeSession
import dev.jeromeswannack.chineselearning.lab.data.signOutAllDevices
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID

/**
 * The sign-in hand-off against a real local worker (E2E_TEST_MODE):
 * `LAB_E2E_API=http://localhost:8787 ./gradlew :app:testDebugUnitTest --tests '*AuthContractTest*'`.
 * /api/test/auth-code stands in for Google + the callback; the rest is the real thing.
 */
class AuthContractTest {
    private val base = System.getenv("LAB_E2E_API")
    private val json = Json { ignoreUnknownKeys = true }

    private fun raw(path: String, body: String): String =
        OkHttpClient().newCall(Request.Builder().url(base + path).post(body.toRequestBody("application/json".toMediaType())).build())
            .execute().use { it.body!!.string() }

    @Test fun codeExchangeLogoutAndLogoutAll() = runBlocking {
        assumeTrue("set LAB_E2E_API to run against a local worker", base != null)
        val email = "lab-auth-${UUID.randomUUID()}@example.com"
        raw("/api/test/auth", """{"email":"$email","name":"Lab Auth"}""")

        val verifier = AuthExchange.makeVerifier()
        val code = json.parseToJsonElement(raw("/api/test/auth-code", """{"email":"$email","challenge":"${AuthExchange.challengeFor(verifier)}","client":"lab"}"""))
            .jsonObject["code"]!!.jsonPrimitive.content
        val anon = Api(base) { null }

        // Someone else's verifier burns the code; ours works once.
        val other = AuthExchange.exchange(anon, code, AuthExchange.makeVerifier())
        assertTrue(other is AuthExchange.Outcome.Failed)
        val code2 = json.parseToJsonElement(raw("/api/test/auth-code", """{"email":"$email","challenge":"${AuthExchange.challengeFor(verifier)}","client":"lab"}"""))
            .jsonObject["code"]!!.jsonPrimitive.content
        val token = (AuthExchange.exchange(anon, code2, verifier) as AuthExchange.Outcome.Token).token
        assertTrue(AuthExchange.exchange(anon, code2, verifier) is AuthExchange.Outcome.Failed)

        val api = Api(base) { token }
        assertEquals(email, api.me().email)
        api.revokeSession()
        try {
            api.me(); fail("the session was revoked")
        } catch (_: UnauthorizedException) { }

        // Sign out of all devices: two sessions, both gone.
        val t1 = json.parseToJsonElement(raw("/api/test/auth", """{"email":"$email"}""")).jsonObject["session_token"]!!.jsonPrimitive.content
        val t2 = json.parseToJsonElement(raw("/api/test/auth", """{"email":"$email"}""")).jsonObject["session_token"]!!.jsonPrimitive.content
        assertTrue(Api(base) { t1 }.signOutAllDevices().signed_out >= 2)
        try {
            Api(base) { t2 }.me(); fail("every session was revoked")
        } catch (_: UnauthorizedException) { }
    }
}
