package dev.jeromeswannack.chineselearning.lab.data.holds

import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardHold
import dev.jeromeswannack.chineselearning.lab.core.CardHolds
import dev.jeromeswannack.chineselearning.lab.core.HoldListRow
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueHolds
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.CardHoldEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.api.CardHoldDto
import dev.jeromeswannack.chineselearning.lab.data.api.HoldBody
import dev.jeromeswannack.chineselearning.lab.data.api.HoldClearBody
import dev.jeromeswannack.chineselearning.lab.data.api.HoldItemBody
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.PlatformDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * Suspend & snooze on this phone (core CardHolds.kt; web services/cardHolds.ts; docs/STUDY_SESSION.md
 * "Suspend & snooze").
 *
 *  - A hold is written to Room at once (`card_holds`, pending "add") so the queue, Home and the widget
 *    follow immediately, offline too, and queued in the Outbox as `POST /api/me/card-holds` with its
 *    client id (idempotent), drained now when online.
 *  - Unsuspend / Wake now marks the rows pending "clear" (out of the queue at once) and queues
 *    `POST /api/me/card-holds/clear` with the time it was made (idempotent).
 *  - Every sync replaces the synced rows with the server's FULL active list ([replaceFromServer]); a row
 *    whose Outbox item is still pending stays on top as made here.
 * Which holds are on TODAY is decided with the phone's local date (a snooze ends on a date).
 */
object HoldStore {
    const val OUTBOX_ADD = "card-hold"
    const val OUTBOX_CLEAR = "card-hold-clear"
    const val PENDING_ADD = "add"
    const val PENDING_CLEAR = "clear"

    fun today(nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().toString()

    private fun hold(e: CardHoldEntity) = CardHold(e.id, e.cardId, e.kind, e.until, e.createdAt)

    /** Rows that count (a pending clear is out at once). */
    suspend fun live(dao: LabDao): List<CardHoldEntity> = try {
        dao.cardHolds().filter { it.pending != PENDING_CLEAR }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Throwable) {
        android.util.Log.w("HoldStore", "holds unavailable", e); emptyList()
    }

    /** card id → the hold keeping it out of study today (suspend wins; else the snooze ending last). */
    suspend fun activeByCard(dao: LabDao, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Map<String, CardHold> {
        val today = today(nowMs, zone)
        return live(dao).groupBy { it.cardId }.mapNotNull { (id, rows) -> CardHolds.activeHoldFor(rows.map(::hold), today)?.let { id to it } }.toMap()
    }

    /** Card ids held out of study today. */
    suspend fun heldIds(dao: LabDao, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Set<String> =
        CardHolds.heldCardIds(live(dao).map(::hold), today(nowMs, zone))

    /**
     * Every StudyQueue.build's `holds`: suspended / snoozed cards and — with "Don't show a word's other
     * card types on the same day" on ([Prefs.burySiblings]) — the cards reviewed since local midnight.
     * Null when there is nothing to hold back.
     */
    suspend fun queueHolds(dao: LabDao, prefs: Prefs, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): QueueHolds? =
        queueHolds(dao, prefs.burySiblings, nowMs, zone)

    suspend fun queueHolds(dao: LabDao, bury: Boolean, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): QueueHolds? {
        val held = heldIds(dao, nowMs, zone)
        if (held.isEmpty() && !bury) return null
        val reviewedToday = if (bury) dao.cardIdsReviewedSince(Js.toIsoString(StudyQueue.startOfDay(nowMs, zone))).toSet() else null
        return QueueHolds(held, reviewedToday)
    }

    /** One row of "Suspended & snoozed cards", built from this phone's own cards (works offline). */
    data class Row(val list: HoldListRow, val noteId: String, val cardType: String, val deckId: String, val deckName: String)

    suspend fun rows(dao: LabDao, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): List<Row> {
        val active = activeByCard(dao, nowMs, zone)
        if (active.isEmpty()) return emptyList()
        val cards = dao.cardsByIds(active.keys.toList())
        val notes = dao.notes(cards.map { it.noteId }.distinct()).associateBy { it.id }
        val decks = dao.decks().associateBy { it.id }
        return cards.mapNotNull { c ->
            val n = notes[c.noteId] ?: return@mapNotNull null
            val d = decks[n.deckId] ?: return@mapNotNull null
            Row(HoldListRow(c.id, active.getValue(c.id), n.hanzi, n.pinyin, n.english), c.noteId, c.cardType, d.id, d.name)
        }
    }

    /**
     * Suspend or snooze [cardIds] now: Room at once, the Outbox after. [scope] / [source] are analytics
     * ("card" | "word"; "study" | "card_hub" | "held_list" | …). Returns the toast line.
     */
    suspend fun hold(app: LabApp, cardIds: List<String>, kind: String, length: String?, scope: String, source: String, nowMs: Long = System.currentTimeMillis()): String {
        val ids = cardIds.distinct()
        if (ids.isEmpty()) return ""
        val until = if (kind == CardHolds.SNOOZE) CardHolds.snoozeUntil(today(nowMs), length ?: "tomorrow") else null
        val at = Js.toIsoString(nowMs)
        val items = ids.map { HoldItemBody(UUID.randomUUID().toString(), it, kind, until, at, "app") }
        val dao = app.repo.dao
        withContext(Dispatchers.IO) {
            val outboxId = items.first().id
            app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/card-holds", HoldBody(items), id = outboxId)
            app.repo.db.withTransaction {
                // The newest hold on a card is the one that counts (the server clears the older ones too);
                // a pending clear stays — it goes up with its earlier time.
                val old = dao.cardHolds().filter { it.cardId in ids && it.pending != PENDING_CLEAR }
                if (old.isNotEmpty()) dao.deleteCardHolds(old.map { it.id })
                dao.upsertCardHolds(items.map { CardHoldEntity(it.id, it.card_id, kind, until, at, PENDING_ADD, outboxId) })
            }
        }
        if (kind == CardHolds.SUSPEND) app.analytics.track("card.suspend", mapOf("scope" to scope, "count" to ids.size, "source" to source))
        else app.analytics.track("card.snooze", mapOf("scope" to scope, "length" to (length ?: "tomorrow"), "count" to ids.size, "source" to source))
        app.repo.notifyLocalChange()
        send(app)
        return CardHolds.message(kind, ids.size, length)
    }

    /** Undo of a release: the same holds again (new client ids, same kind and end date). */
    suspend fun restore(app: LabApp, holds: List<CardHold>, nowMs: Long = System.currentTimeMillis()) {
        if (holds.isEmpty()) return
        val at = Js.toIsoString(nowMs)
        val items = holds.map { HoldItemBody(UUID.randomUUID().toString(), it.cardId, it.kind, it.until, at, "app") }
        val dao = app.repo.dao
        withContext(Dispatchers.IO) {
            val outboxId = items.first().id
            app.outbox.enqueueJson(OUTBOX_ADD, "POST", "/api/me/card-holds", HoldBody(items), id = outboxId)
            app.repo.db.withTransaction {
                val ids = items.map { it.card_id }.toSet()
                val old = dao.cardHolds().filter { it.cardId in ids && it.pending != PENDING_CLEAR }
                if (old.isNotEmpty()) dao.deleteCardHolds(old.map { it.id })
                dao.upsertCardHolds(items.map { CardHoldEntity(it.id, it.card_id, it.kind, it.until, at, PENDING_ADD, outboxId) })
            }
        }
        app.repo.notifyLocalChange()
        send(app)
    }

    /** Unsuspend / Wake now: out of the holds at once, `POST /api/me/card-holds/clear` through the Outbox. Returns the toast line. */
    suspend fun release(app: LabApp, cardIds: List<String>, source: String, nowMs: Long = System.currentTimeMillis()): String {
        val ids = cardIds.distinct()
        if (ids.isEmpty()) return ""
        val dao = app.repo.dao
        val active = activeByCard(dao, nowMs)
        val suspended = ids.count { active[it]?.kind == CardHolds.SUSPEND }
        val snoozed = ids.count { active[it]?.kind == CardHolds.SNOOZE }
        val at = Js.toIsoString(nowMs)
        withContext(Dispatchers.IO) {
            val outboxId = app.outbox.enqueueJson(OUTBOX_CLEAR, "POST", "/api/me/card-holds/clear", HoldClearBody(ids, at))
            val rows = dao.cardHolds().filter { it.cardId in ids && it.pending != PENDING_CLEAR }
            dao.upsertCardHolds(rows.map { it.copy(pending = PENDING_CLEAR, outboxId = outboxId, clearedAt = at) })
        }
        if (suspended > 0) app.analytics.track("card.unsuspend", mapOf("count" to suspended, "source" to source))
        if (snoozed > 0) app.analytics.track("card.wake", mapOf("count" to snoozed, "source" to source))
        app.repo.notifyLocalChange()
        send(app)
        return CardHolds.releaseMessage(ids.size)
    }

    private fun send(app: LabApp) {
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } } else app.scheduleBackgroundUpload()
    }

    /**
     * The server's FULL active list replaces the synced rows; a row whose Outbox item is still pending
     * keeps the local change (for its card). A row whose item has gone (sent, or refused for good)
     * follows the server.
     */
    suspend fun replaceFromServer(db: LabDatabase, platform: PlatformDao, server: List<CardHoldDto>) {
        val dao = db.dao()
        val pendingOutbox = platform.allOutbox().filter { it.state == Outbox.PENDING }.mapTo(HashSet()) { it.id }
        db.withTransaction {
            val local = dao.cardHolds()
            val keep = local.filter { it.pending != null && it.outboxId != null && it.outboxId in pendingOutbox }
            val keptCards = keep.mapTo(HashSet()) { it.cardId }
            val keptIds = keep.mapTo(HashSet()) { it.id }
            val drop = local.map { it.id }.filter { it !in keptIds }
            drop.chunked(500).forEach { dao.deleteCardHolds(it) }
            dao.upsertCardHolds(server.filter { it.card_id !in keptCards }.map {
                CardHoldEntity(it.id, it.card_id, if (it.kind == CardHolds.SNOOZE) CardHolds.SNOOZE else CardHolds.SUSPEND, it.until, it.created_at)
            })
        }
    }

    /** "Don't show a word's other card types on the same day": the phone's copy at once, then the server. */
    suspend fun setBurySiblings(app: LabApp, on: Boolean) {
        app.prefs.burySiblings = on
        app.analytics.track("settings.bury_siblings", mapOf("on" to on))
        app.repo.notifyLocalChange()
        app.outbox.enqueueJson("bury-siblings", "PUT", "/api/profile/bury-siblings", dev.jeromeswannack.chineselearning.lab.data.api.BurySiblingsBody(on))
        send(app)
    }

    /** Today's local date, for labels. */
    fun localToday(zone: ZoneId = ZoneId.systemDefault()): String = LocalDate.now(zone).toString()
}
