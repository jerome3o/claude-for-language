package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Jerome (Nov 2026): ✨ Show a fixed version said "needs a connection" while he was online — the server had answered
 * 502 (Claude couldn't fix it), and HttpException is an IOException. Only a real network failure is "offline".
 */
class IsOfflineTest {
    @Test
    fun theServersAnswerIsNeverOffline() {
        assertFalse(HttpException(502, "Bad Gateway", "{\"retryable\":false}").isOffline())
        assertFalse(HttpException(503, "Service Unavailable").isOffline())
        assertFalse(UnauthorizedException().isOffline())
        assertFalse(AnswerCheckUnavailable("HTTP 503").isOffline())
        assertFalse(IllegalStateException("bad reply").isOffline())
    }

    @Test
    fun aNetworkFailureIsOffline() {
        assertTrue(java.io.IOException("offline").isOffline())
        assertTrue(UnknownHostException("api").isOffline())
        assertTrue(SocketTimeoutException("timeout").isOffline())
        assertTrue(AnswerCheckUnavailable("network", offline = true).isOffline())
    }

    @Test
    fun theFixRequestCarriesTheProblem() {
        val json = Api(baseUrl = "http://test") { null }.json
        val body = SentenceFixBody(listOf("角度"), null, "从我妈妈的角度来看我和我妹妹住在很远的地方", "spoken", "从…的角度 used right — unclear what the angle reveals")
        val o = json.encodeToJsonElement(SentenceFixBody.serializer(), body).jsonObject
        assertEquals("从…的角度 used right — unclear what the angle reveals", o["problem"]!!.jsonPrimitive.content)
    }
}
