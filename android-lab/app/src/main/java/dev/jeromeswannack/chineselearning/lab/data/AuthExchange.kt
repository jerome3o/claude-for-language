package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.data.api.post
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * Sign-in hand-off — port of shared/auth/signin.ts (worker services/auth.ts "one-time sign-in codes").
 *
 * [MainActivity.startSignIn] keeps a random verifier in [Prefs.pendingAuthVerifier] and sends only
 * its SHA-256 (`challenge`, PKCE S256) to /api/auth/login with the echo nonce; the worker redirects
 * to `chineselearning-lab://auth?code=…&nonce=…`, and [exchange] trades code + verifier for the
 * session token at POST /api/auth/exchange. The long-lived token never rides the custom-scheme
 * redirect, so an app that grabbed the link gets nothing it can use.
 */
object AuthExchange {
    private val base64Url = Base64.getUrlEncoder().withoutPadding()
    private val json = Json { ignoreUnknownKeys = true }

    /** 32 random bytes, base64url (43 characters) — the web's makeVerifier(). */
    fun makeVerifier(random: SecureRandom = SecureRandom()): String =
        base64Url.encodeToString(ByteArray(32).also { random.nextBytes(it) })

    /** base64url(SHA-256(verifier)), no padding — the web's challengeFor(). */
    fun challengeFor(verifier: String): String =
        base64Url.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** Port of exchangeErrorMessage() (shared/auth/signin.ts). */
    fun errorMessage(reason: String?): String = when (reason) {
        "expired" -> "That sign-in took too long. Please sign in again."
        "nonce_mismatch", "no_verifier" -> "That sign-in link wasn’t started on this device. Please sign in again."
        "invalid_code" -> "That sign-in link was already used. Please sign in again."
        "network" -> "Couldn’t finish signing in — check your connection and try again."
        else -> "Sign-in failed. Please try again."
    }

    sealed interface Outcome {
        data class Token(val token: String) : Outcome
        data class Failed(val message: String) : Outcome
    }

    @Serializable
    private data class ExchangeBody(val code: String, val verifier: String)

    /** POST /api/auth/exchange `{ code, verifier }` → the session token (no session needed). */
    suspend fun exchange(api: Api, code: String, verifier: String?): Outcome {
        if (verifier.isNullOrBlank()) return Outcome.Failed(errorMessage("no_verifier"))
        return withContext(Dispatchers.IO) {
            try {
                val body = json.encodeToString(ExchangeBody.serializer(), ExchangeBody(code, verifier))
                    .toRequestBody("application/json".toMediaType())
                // No Authorization header: the code is the credential.
                val req = Request.Builder().url("${api.baseUrl}/api/auth/exchange").post(body).build()
                api.http.newCall(req).execute().use { res ->
                    val obj = runCatching { json.parseToJsonElement(res.body?.string().orEmpty()) as? JsonObject }.getOrNull()
                    val token = (obj?.get("session_token") as? JsonPrimitive)?.contentOrNull
                    if (res.isSuccessful && !token.isNullOrBlank()) Outcome.Token(token)
                    else Outcome.Failed(errorMessage((obj?.get("reason") as? JsonPrimitive)?.contentOrNull))
                }
            } catch (e: java.io.IOException) {
                Outcome.Failed(errorMessage("network"))
            }
        }
    }
}

@Serializable
data class SignedOutAllDto(val signed_out: Int = 0)

/**
 * POST /api/auth/logout — revokes THIS device's session (the Bearer token). Best effort with a short
 * deadline: signing out never waits on a dead connection (the session expires by itself).
 */
suspend fun Api.revokeSession() {
    runCatching {
        withContext(Dispatchers.IO) {
            val quick = http.newBuilder().callTimeout(4, TimeUnit.SECONDS).build()
            quick.newCall(request("/api/auth/logout").post(ByteArray(0).toRequestBody(null)).build()).execute().close()
        }
    }
}

/** POST /api/auth/logout-all — "Sign out of all devices"; throws when it didn't happen (offline, 401). */
suspend fun Api.signOutAllDevices(): SignedOutAllDto = post("/api/auth/logout-all")
