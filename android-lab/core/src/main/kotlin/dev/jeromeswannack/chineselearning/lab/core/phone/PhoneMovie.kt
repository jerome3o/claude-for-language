package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * Port of shared/phone/movie.ts — 爆米花电影: show lists, the seat map and its rules (at most 4
 * seats, 情侣座 in pairs, "don't leave a single empty seat") and seat labels. Seat ids are
 * "排-座" (row-seat, 1-based): "7-8" is 7排8座.
 */
object PhoneMovie {
    const val MAX_SEATS = 4
    private val SEAT_RE = Regex("^([0-9]+)-([0-9]+)$")

    fun seatId(row: Int, col: Int): String = "$row-$col"

    data class Seat(val row: Int, val col: Int)

    fun parseSeat(id: String): Seat? = SEAT_RE.matchEntire(id)?.let { m ->
        val r = m.groupValues[1].toIntOrNull()
        val c = m.groupValues[2].toIntOrNull()
        if (r == null || c == null) null else Seat(r, c)
    }

    /** 7排8座 */
    fun seatLabel(id: String): String = parseSeat(id)?.let { "${it.row}排${it.col}座" } ?: id

    fun seatExists(map: MovieSeatMap, id: String): Boolean {
        val p = parseSeat(id) ?: return false
        return p.row >= 1 && p.row <= map.rows && p.col >= 1 && p.col <= map.cols && id !in (map.missing ?: emptyList())
    }

    /** Seats sold in the world plus those bought on this phone. */
    fun soldSeats(show: MovieShow, records: List<PhoneRecord> = emptyList()): Set<String> {
        val s = LinkedHashSet(show.seats.sold ?: emptyList())
        for (r in records) {
            val st = JsJson.str(r.data["status"])
            val ids = r.data["seat_ids"] as? JsonArray
            if (r.record == "movie_order" && JsJson.str(r.data["show_id"]) == show.id && (st == "paid" || st == "unpaid") && ids != null) {
                for (id in ids) s.add(PhoneJs.jsString(id))
            }
        }
        return s
    }

    /** The couple pair a seat belongs to ([left, right]) or null. */
    fun couplePair(map: MovieSeatMap, id: String): Pair<String, String>? {
        val p = parseSeat(id) ?: return null
        for (left in map.couple ?: emptyList()) {
            val l = parseSeat(left) ?: continue
            if (l.row != p.row) continue
            if (l.col == p.col || l.col + 1 == p.col) return left to seatId(l.row, l.col + 1)
        }
        return null
    }

    data class Toggle(val selected: List<String>, val problem: String?)

    /** Tap a seat: the new selection (a couple seat toggles its pair), or a problem (the toast). */
    fun toggleSeat(map: MovieSeatMap, sold: Set<String>, selected: List<String>, id: String): Toggle {
        if (!seatExists(map, id) || id in sold) return Toggle(selected.toList(), if (id in sold) "该座位已售出" else null)
        val pair = couplePair(map, id)
        val group = pair?.let { listOf(it.first, it.second) } ?: listOf(id)
        val on = group.all { it in selected }
        if (on) return Toggle(selected.filter { it !in group }, null)
        if (group.any { it in sold }) return Toggle(selected.toList(), "该座位已售出")
        val next = selected.filter { it !in group } + group
        if (next.size > MAX_SEATS) return Toggle(selected.toList(), "一次最多选择${MAX_SEATS}个座位")
        return Toggle(next, null)
    }

    /** Columns split into blocks by the aisles (1-based columns). */
    fun blocks(map: MovieSeatMap): List<Pair<Int, Int>> {
        val cuts = (map.aislesAfter ?: emptyList()).filter { it > 0 && it < map.cols }.sorted()
        val out = mutableListOf<Pair<Int, Int>>()
        var start = 1
        for (c in cuts) {
            out.add(start to c)
            start = c + 1
        }
        out.add(start to map.cols)
        return out
    }

    /** The "don't leave one empty seat" rule; null = fine. */
    fun singleGapProblem(map: MovieSeatMap, sold: Set<String>, selected: List<String>): String? {
        val chosen = selected.toSet()
        val rows = LinkedHashSet(selected.mapNotNull { parseSeat(it)?.row?.takeIf { r -> r != 0 } })
        for (row in rows) {
            for ((a, b) in blocks(map)) {
                val cols = (a..b).filter { seatExists(map, seatId(row, it)) }
                val taken = cols.map { seatId(row, it) in sold || seatId(row, it) in chosen }
                for (i in cols.indices) {
                    if (taken[i]) continue
                    val leftTaken = i == 0 || taken[i - 1]
                    val rightTaken = i == cols.size - 1 || taken[i + 1]
                    if (!leftTaken || !rightTaken) continue
                    val nextToMine = (i > 0 && seatId(row, cols[i - 1]) in chosen) || (i < cols.size - 1 && seatId(row, cols[i + 1]) in chosen)
                    if (nextToMine) return "座位旁边不要留下单个空座哦"
                }
            }
        }
        return null
    }

    /** All chosen seats in one row, side by side within one block. */
    fun seatsAdjacent(map: MovieSeatMap, selected: List<String>): Boolean {
        if (selected.size < 2) return selected.size == 1
        val ps = selected.map(::parseSeat)
        if (ps.any { it == null }) return false
        val row = ps[0]!!.row
        if (ps.any { it!!.row != row }) return false
        val cols = ps.map { it!!.col }.sorted()
        val blk = blocks(map).firstOrNull { (a, b) -> cols[0] >= a && cols[0] <= b }
        if (blk == null || cols.last() > blk.second) return false
        return cols.withIndex().all { (i, c) -> i == 0 || c == cols[i - 1] + 1 }
    }

    fun isCoupleSeat(map: MovieSeatMap, id: String): Boolean = couplePair(map, id) != null

    /** Shows of a film on a day at a cinema (or all), by start time. */
    fun showsFor(world: MovieWorld, filmId: String, date: String, cinemaId: String? = null): List<MovieShow> =
        world.shows.filter { it.film == filmId && it.date == date && (cinemaId.isNullOrEmpty() || it.cinema == cinemaId) }
            .sortedWith { a, b -> PhoneDates.minutesOf(a.start) - PhoneDates.minutesOf(b.start) }

    /** End time of a show (film length + ~10 minutes of adverts: 散场). */
    fun showEnd(world: MovieWorld, show: MovieShow): String {
        val film = world.films.firstOrNull { it.id == show.film }
        val m = PhoneDates.minutesOf(show.start) + (film?.minutes ?: 120) + 10
        return "${PhoneDates.pad2((m / 60) % 24)}:${PhoneDates.pad2(m % 60)}"
    }

    /** 取票码: 4+4 digits, stable per order. */
    fun ticketCode(orderId: String): String {
        var h = 7L
        orderId.codePoints().forEach { cp ->
            // `for (const ch of orderId)` + `ch.charCodeAt(0)`: a code point's first UTF-16 unit.
            val unit = Character.toChars(cp)[0].code
            h = (h * 31 + unit) and 0xFFFFFFFFL
        }
        val s = (h % 100_000_000).toString().padStart(8, '0')
        return "${s.substring(0, 4)} ${s.substring(4)}"
    }

    data class SnackLine(val name: String, val price: Double, val qty: Int)

    /** The record an order writes (movie_order). */
    fun movieOrderData(world: MovieWorld, show: MovieShow, seatIds: List<String>, snacks: List<SnackLine>, orderId: String, status: String): JsonObject {
        val film = world.films.firstOrNull { it.id == show.film }
        val cinema = world.cinemas.firstOrNull { it.id == show.cinema }
        val ids = seatIds.sortedWith { a, b ->
            val pa = parseSeat(a)!!
            val pb = parseSeat(b)!!
            (pa.row - pb.row).takeIf { it != 0 } ?: (pa.col - pb.col)
        }
        val snackTotal = snacks.fold(0.0) { s, x -> s + x.price * x.qty }
        return PhoneJs.obj(
            "order_id" to PhoneJs.str(orderId),
            "show_id" to PhoneJs.str(show.id),
            "film_id" to PhoneJs.str(show.film),
            "film" to PhoneJs.str(film?.title ?: ""),
            "cinema_id" to PhoneJs.str(show.cinema),
            "cinema" to PhoneJs.str(cinema?.name ?: ""),
            "cinema_km" to PhoneJs.num(cinema?.km ?: 0.0),
            "date" to PhoneJs.str(show.date),
            "start" to PhoneJs.str(show.start),
            "hall" to PhoneJs.str(show.hall),
            "format" to PhoneJs.str(show.format),
            "language" to PhoneJs.str(show.language),
            "seat_ids" to PhoneJs.strs(ids),
            "seats" to PhoneJs.strs(ids.map(::seatLabel)),
            "seat_count" to PhoneJs.num(ids.size),
            "adjacent" to PhoneJs.bool(seatsAdjacent(show.seats, ids)),
            "couple" to PhoneJs.bool(ids.isNotEmpty() && ids.all { isCoupleSeat(show.seats, it) }),
            "snacks" to PhoneJs.strs(snacks.filter { it.qty > 0 }.map { it.name }),
            "total" to PhoneJs.num(Js.round((show.price * ids.size + snackTotal) * 100) / 100),
            "code" to PhoneJs.str(ticketCode(orderId)),
            "status" to PhoneJs.str(status),
        )
    }
}
