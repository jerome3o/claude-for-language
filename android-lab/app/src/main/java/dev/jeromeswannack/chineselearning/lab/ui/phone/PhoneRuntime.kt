package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.phone.PersonaMessage
import dev.jeromeswannack.chineselearning.lab.core.phone.PersonaReply
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEvent
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhonePersona
import dev.jeromeswannack.chineselearning.lab.core.phone.PhonePersonas
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneRecord
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneScenarios
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneWorlds
import dev.jeromeswannack.chineselearning.lab.core.phone.ScenarioSpec
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** One screen of an app's navigation stack (web runtime.tsx `Screen`). */
data class PhoneScreen(val key: Int, val name: String, val params: Map<String, String> = emptyMap()) {
    fun p(k: String): String = params[k] ?: ""
}

/** Where a notification / SMS banner opens. */
data class OpenTarget(val app: String, val screen: String? = null, val params: Map<String, String> = emptyMap())

data class PhoneNotification(val id: String, val app: String, val title: String, val body: String, val at: Long, val open: OpenTarget? = null)

data class PayRequest(val app: String, val title: String, val payee: String, val amount: Double)

data class PayResult(val method: String, val paymentId: String)

class PendingPay(val req: PayRequest, val result: CompletableDeferred<PayResult?>)

/** No connection (the message waits with "对方暂时无法回复（需要联网）" and 重试). */
class PersonaOfflineException(cause: Throwable? = null) : java.io.IOException("offline", cause)

/** The persona chat endpoint (POST /api/phone/persona-reply), fakeable in tests. */
fun interface PersonaClient {
    /** Throws [PersonaOfflineException] when offline / unreachable, anything else when it failed. */
    suspend fun reply(scenarioId: String, personaId: String, messages: List<PersonaMessage>, context: String?): PersonaReply
}

/** A line of a persona chat (web persona.tsx `ChatLine`). */
data class ChatLine(val from: String, val text: String, val english: String?, val at: Long, val system: Boolean)

/**
 * The simulated phone's runtime (web frontend/src/phone/runtime.tsx): the scenario, its EVENT
 * LOG (the only state that matters — records, persona chats, SMS; checked by core PhoneEngine),
 * the per-app navigation stacks (every layer stays composed under the top one, like the web, so a
 * form keeps its fields and a trip's timers keep running), app-level UI state, notifications /
 * toasts, the shared pay sheet, the clock and the persona chats. Compose snapshot state, so every
 * screen recomposes from it; no Android dependency (renders in screenshot tests).
 */
class PhoneRuntime(
    val spec: ScenarioSpec,
    val startedAt: Long,
    initialEvents: List<PhoneEvent>,
    val scope: CoroutineScope,
    private val personaClient: PersonaClient,
    val track: (String, Map<String, Any?>) -> Unit = { _, _ -> },
    val now: () -> Long = System::currentTimeMillis,
) {
    var online by mutableStateOf(true)
    var events by mutableStateOf(initialEvents.ifEmpty { PhoneWorlds.seedEvents(spec, startedAt) })
        private set
    val records: List<PhoneRecord> by derivedStateOf { PhoneEngine.recordsFrom(events) }
    val stacks = mutableStateMapOf<String, List<PhoneScreen>>()
    var current by mutableStateOf<String?>(null)
        private set
    /** Apps opened this play, most recent first (the recents switcher). */
    var recents by mutableStateOf(listOf<String>())
        private set
    /** Every app opened (kept composed, in first-opened order, so switching keeps its screens). */
    var opened by mutableStateOf(listOf<String>())
        private set
    var notifications by mutableStateOf(listOf<PhoneNotification>())
        private set
    var toastText by mutableStateOf<String?>(null)
        private set
    var payRequest by mutableStateOf<PendingPay?>(null)
        private set
    var clockMs by mutableLongStateOf(now())
    /** The 🎤 take under way (the shell draws its "正在听…" card). */
    var voice by mutableStateOf<dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationController?>(null)
    private val appState = mutableStateMapOf<String, Any?>()
    private val backHandlers = mutableListOf<() -> Boolean>()
    private var keySeq = 0
    private var toastJob: Job? = null
    /** Told about every new log (the play saves it). */
    var onEvents: (List<PhoneEvent>) -> Unit = {}

    val clock: PhoneWorlds.Clock get() = PhoneWorlds.phoneClock(spec.today, spec.now, startedAt, clockMs)

    // ── the log ──

    private fun append(e: PhoneEvent) {
        events = events + e
        onEvents(events)
    }

    fun emit(type: String, vararg extra: Pair<String, JsonElement?>) = append(PhoneEngine.event(type, now(), *extra))

    fun emit(type: String, extra: Map<String, Any?>) = emit(type, *extra.map { (k, v) -> k to jsonOf(v) }.toTypedArray())

    /** Write (or update) a record: the latest version is what goals see. */
    fun write(record: String, id: String, data: JsonObject) = append(PhoneEngine.recordEvent(record, id, data, now()))

    fun write(record: String, id: String, vararg fields: Pair<String, Any?>) = write(record, id, obj(*fields))

    fun newId(record: String, prefix: String): String = PhoneWorlds.nextRecordId(events, record, prefix)

    fun recordsOf(record: String): List<PhoneRecord> = records.filter { it.record == record }

    fun record(record: String, id: String): JsonObject? = records.firstOrNull { it.record == record && it.id == id }?.data

    // ── navigation ──

    private fun screen(name: String, params: Map<String, String> = emptyMap()) = PhoneScreen(++keySeq, name, params)

    fun openApp(app: String, screen: String? = null, params: Map<String, String> = emptyMap()) {
        val stack = stacks[app] ?: listOf(screen("home"))
        stacks[app] = when {
            screen == null -> stack
            screen == "home" -> listOf(stack[0])
            else -> listOf(stack[0], screen(screen, params))
        }
        current = app
        recents = listOf(app) + recents.filter { it != app }
        if (app !in opened) opened = opened + app
        append(PhoneEngine.event("app.open", now(), "app" to JsonPrimitive(app)))
    }

    fun goHome() {
        current = null
    }

    fun push(app: String, name: String, params: Map<String, String> = emptyMap()) {
        stacks[app] = (stacks[app] ?: listOf(screen("home"))) + screen(name, params)
    }

    fun pop(app: String) {
        val stack = stacks[app] ?: return
        if (stack.size > 1) stacks[app] = stack.dropLast(1)
    }

    /** Replace the stack with [root, …screens] (after an order: the order page with back → home). */
    fun resetTo(app: String, screens: List<Pair<String, Map<String, String>>>) {
        val root = stacks[app]?.firstOrNull() ?: screen("home")
        stacks[app] = listOf(root) + screens.map { screen(it.first, it.second) }
    }

    /** System back: an open sheet first (registered with [PhoneBackHandler]), else the app's stack, else home. */
    fun back(): Boolean {
        for (h in backHandlers.toList().asReversed()) if (h()) return true
        val app = current ?: return false
        val stack = stacks[app] ?: emptyList()
        if (stack.size > 1) pop(app) else current = null
        return true
    }

    fun registerBack(fn: () -> Boolean): () -> Unit {
        backHandlers.add(fn)
        return { backHandlers.remove(fn) }
    }

    fun nav(app: String) = AppNav(this, app)

    // ── notifications, SMS, toast ──

    fun notify(app: String, title: String, body: String, open: OpenTarget? = null) {
        val item = PhoneNotification("n${++keySeq}", app, title, body, now(), open)
        notifications = (listOf(item) + notifications).take(4)
        scope.launch {
            delay(4500)
            notifications = notifications.filter { it.id != item.id }
        }
    }

    fun dismissNotification(id: String) {
        notifications = notifications.filter { it.id != id }
    }

    fun sms(from: String, text: String, open: OpenTarget? = null) {
        append(PhoneEngine.event("sms", now(), "from" to JsonPrimitive(from), "text" to JsonPrimitive(text)))
        notify("sms", from, text, open ?: OpenTarget("sms"))
    }

    fun toast(text: String) {
        toastText = text
        toastJob?.cancel()
        toastJob = scope.launch {
            delay(2200)
            toastText = null
        }
    }

    // ── the pay sheet ──

    suspend fun pay(req: PayRequest): PayResult? {
        val d = CompletableDeferred<PayResult?>()
        payRequest = PendingPay(req, d)
        return d.await()
    }

    fun finishPay(r: PayResult?) {
        val p = payRequest ?: return
        payRequest = null
        p.result.complete(r)
    }

    // ── app-level UI state (search forms, carts): survives screen changes and app switches ──

    @Suppress("UNCHECKED_CAST")
    fun <T> getState(app: String, key: String, init: T): T {
        val k = "$app:$key"
        return if (appState.containsKey(k)) appState[k] as T else init
    }

    fun <T> setState(app: String, key: String, value: T) {
        appState["$app:$key"] = value
    }

    fun <T> updateState(app: String, key: String, init: T, f: (T) -> T) = setState(app, key, f(getState(app, key, init)))

    // ── persona chats (web persona.tsx usePersona) ──

    val personaPending = mutableStateMapOf<String, Boolean>()
    /** offline | failed per persona. */
    val personaError = mutableStateMapOf<String, String>()
    private val personaJobs = HashMap<String, Job>()

    fun persona(id: String?): PhonePersona? = PhoneScenarios.persona(spec, id)

    fun personaLines(id: String?): List<ChatLine> = if (id == null) emptyList() else events
        .filter { PhoneEngine.type(it) == "persona.message" && PhoneJs.sOrNull(it, "persona") == id }
        .map { e ->
            ChatLine(
                if (PhoneJs.sOrNull(e, "from") == "me") "me" else "them",
                PhoneJs.s(e, "text").let { if (e["text"] == null) "" else it },
                PhoneJs.sOrNull(e, "english"),
                PhoneEngine.at(e),
                (e["system"] as? JsonPrimitive)?.content == "true",
            )
        }

    /** The persona's opening line (once). */
    fun personaStart(id: String?) {
        val p = persona(id) ?: return
        val opening = p.opening ?: return
        if (personaLines(p.id).any { it.from == "them" }) return
        emit("persona.message", "persona" to JsonPrimitive(p.id), "from" to JsonPrimitive("them"), "text" to JsonPrimitive(opening))
    }

    private fun history(id: String) = personaLines(id).map { PersonaMessage(it.from, it.text) }

    private fun ask(id: String, history: List<PersonaMessage>, via: String, context: String?) {
        val p = persona(id) ?: return
        val turn = history.count { it.from == "me" }
        if (!online) {
            personaError[id] = "offline"
            track("phone.persona_message", mapOf("scenario" to spec.id, "persona" to p.id, "turn" to turn, "actions" to 0, "outcome" to "offline", "via" to via))
            return
        }
        personaPending[id] = true
        personaError.remove(id)
        personaJobs[id]?.cancel()
        personaJobs[id] = scope.launch {
            try {
                val reply = personaClient.reply(spec.id, p.id, PhonePersonas.trim(history), context?.takeIf { it.isNotBlank() })
                emit("persona.message", "persona" to JsonPrimitive(p.id), "from" to JsonPrimitive("them"), "text" to JsonPrimitive(reply.reply), "english" to JsonPrimitive(reply.english))
                for (a in reply.actions) {
                    emit("persona.action", "persona" to JsonPrimitive(p.id), "action" to JsonPrimitive(a.name), "params" to JsonObject(a.params.mapValues { JsonPrimitive(it.value) }))
                }
                track("phone.persona_message", mapOf("scenario" to spec.id, "persona" to p.id, "turn" to turn, "actions" to reply.actions.size, "outcome" to "ok", "via" to via))
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val offline = !online || e is PersonaOfflineException
                personaError[id] = if (offline) "offline" else "failed"
                track("phone.persona_message", mapOf("scenario" to spec.id, "persona" to p.id, "turn" to turn, "actions" to 0, "outcome" to if (offline) "offline" else "failed", "via" to via))
            } finally {
                personaPending.remove(id)
            }
        }
    }

    fun personaSend(id: String?, text: String, via: String = "typed", context: String? = null) {
        val t = text.trim()
        val p = persona(id) ?: return
        if (t.isEmpty()) return
        emit("persona.message", "persona" to JsonPrimitive(p.id), "from" to JsonPrimitive("me"), "text" to JsonPrimitive(t))
        ask(p.id, history(p.id), via, context)
    }

    /** A note the persona sees in the chat (a transfer: "[转账] ¥6500.00 押金") — asks for a reply. */
    fun personaSendEvent(id: String?, text: String, context: String? = null) {
        val p = persona(id) ?: return
        emit("persona.message", "persona" to JsonPrimitive(p.id), "from" to JsonPrimitive("me"), "text" to JsonPrimitive(text), "system" to JsonPrimitive(true))
        ask(p.id, history(p.id), "quick", context)
    }

    fun personaRetry(id: String?, context: String? = null) {
        val p = persona(id) ?: return
        ask(p.id, history(p.id), "typed", context)
    }

    fun hasAction(persona: String?, action: String): Boolean =
        persona != null && events.any { PhoneEngine.type(it) == "persona.action" && PhoneJs.sOrNull(it, "persona") == persona && PhoneJs.sOrNull(it, "action") == action }

    companion object {
        fun jsonOf(v: Any?): JsonElement? = when (v) {
            null -> null
            is JsonElement -> v
            is String -> JsonPrimitive(v)
            is Boolean -> JsonPrimitive(v)
            is Int -> JsonPrimitive(v)
            is Long -> JsonPrimitive(v)
            is Double -> PhoneJs.num(v)
            is List<*> -> kotlinx.serialization.json.JsonArray(v.mapNotNull { jsonOf(it) })
            is Map<*, *> -> JsonObject(v.entries.mapNotNull { (k, x) -> jsonOf(x)?.let { k.toString() to it } }.toMap())
            else -> JsonPrimitive(v.toString())
        }

        fun obj(vararg fields: Pair<String, Any?>): JsonObject = PhoneJs.obj(*fields.map { (k, v) -> k to jsonOf(v) }.toTypedArray())
    }
}

/** An app's own navigation (web `useAppNav`). */
class AppNav(private val p: PhoneRuntime, private val app: String) {
    fun push(name: String, vararg params: Pair<String, String>) = p.push(app, name, params.toMap())
    fun pop() = p.pop(app)
    fun resetTo(vararg screens: Pair<String, Map<String, String>>) = p.resetTo(app, screens.toList())
    fun home() = p.resetTo(app, emptyList())
}

val LocalPhone = staticCompositionLocalOf<PhoneRuntime> { error("no phone") }

/** Long-press on phone text → the explorer (null: plain text, e.g. screenshots). */
val LocalPhoneWord = staticCompositionLocalOf<((ExplorerItem) -> Unit)?> { null }

/** While [active], system back calls [onBack] first (a sheet closes instead of the screen). */
@Composable
fun PhoneBackHandler(active: Boolean, onBack: () -> Unit) {
    val p = LocalPhone.current
    val latest by rememberUpdatedState(onBack)
    DisposableEffect(active, p) {
        if (!active) return@DisposableEffect onDispose { }
        val remove = p.registerBack { latest(); true }
        onDispose { remove() }
    }
}
