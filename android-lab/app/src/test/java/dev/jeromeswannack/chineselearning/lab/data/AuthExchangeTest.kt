package dev.jeromeswannack.chineselearning.lab.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The native sign-in hand-off (data/AuthExchange.kt, port of shared/auth/signin.ts). */
class AuthExchangeTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private var token: String? = null

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = Api(server.url("").toString().trimEnd('/')) { token }
    }

    @After fun tearDown() = server.shutdown()

    @Test fun challengeIsPkceS256() {
        // RFC 7636 appendix B — the same vector shared/auth/signin.test.ts checks.
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", AuthExchange.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        val a = AuthExchange.makeVerifier()
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(a))
        assertNotEquals(a, AuthExchange.makeVerifier())
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(AuthExchange.challengeFor(a)))
    }

    @Test fun exchangePostsCodeAndVerifierWithoutASession() = runBlocking {
        token = "old-token"
        server.enqueue(MockResponse().setBody("""{"session_token":"tok-new","expires_at":"2026-11-16T00:00:00Z"}"""))
        val out = AuthExchange.exchange(api, "the-code", "v".repeat(43))
        assertEquals(AuthExchange.Outcome.Token("tok-new"), out)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/auth/exchange", req.path)
        assertNull(req.getHeader("Authorization"))
        val body = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("the-code", body["code"]!!.jsonPrimitive.content)
        assertEquals("v".repeat(43), body["verifier"]!!.jsonPrimitive.content)
    }

    @Test fun refusalsBecomeSentences() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"x","reason":"expired"}"""))
        assertEquals(AuthExchange.Outcome.Failed(AuthExchange.errorMessage("expired")), AuthExchange.exchange(api, "c", "v".repeat(43)))
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"reason":"nonce_mismatch"}"""))
        val mismatch = AuthExchange.exchange(api, "c", "v".repeat(43)) as AuthExchange.Outcome.Failed
        assertTrue(mismatch.message.contains("wasn’t started on this device"))
        // No verifier kept (the app was reinstalled mid-sign-in): nothing is sent.
        val before = server.requestCount
        assertEquals(AuthExchange.Outcome.Failed(AuthExchange.errorMessage("no_verifier")), AuthExchange.exchange(api, "c", null))
        assertEquals(before, server.requestCount)
    }

    @Test fun networkFailureSaysSo() = runBlocking {
        server.shutdown()
        assertEquals(AuthExchange.Outcome.Failed(AuthExchange.errorMessage("network")), AuthExchange.exchange(api, "c", "v".repeat(43)))
    }

    @Test fun revokeSessionSendsTheBearerAndNeverThrows() = runBlocking {
        token = "tok-1"
        server.enqueue(MockResponse().setBody("""{"success":true,"revoked":true}"""))
        api.revokeSession()
        val req = server.takeRequest()
        assertEquals("/api/auth/logout", req.path)
        assertEquals("POST", req.method)
        assertEquals("Bearer tok-1", req.getHeader("Authorization"))
        server.shutdown()
        api.revokeSession() // offline: quietly nothing
    }

    @Test fun signOutAllDevicesPostsWithTheSession() = runBlocking {
        token = "tok-1"
        server.enqueue(MockResponse().setBody("""{"success":true,"signed_out":3}"""))
        assertEquals(3, api.signOutAllDevices().signed_out)
        val req = server.takeRequest()
        assertEquals("/api/auth/logout-all", req.path)
        assertEquals("Bearer tok-1", req.getHeader("Authorization"))
    }
}
