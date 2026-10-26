package dev.jeromeswannack.chineselearning.lab.core.phone

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Port of shared/phone/validate.ts `validateScenarioSpec`: structural + referential checks of a
 * scenario held as a JSON tree, so a spec that passes is playable. Returns problems (empty =
 * valid), each saying where — the same strings, in the same order, as the web (parity-tested).
 */
object PhoneValidate {
    object Limits {
        const val GOALS = 12
        const val HINTS = 16
        const val VOCAB = 40
        const val PERSONAS = 6
        const val TRAINS = 80
        const val SHOPS = 20
        const val SHOWS = 80
        const val TEXT = 600
    }

    val KNOWN_RECORDS = listOf("rail_order", "rail_passenger", "ride_order", "food_order", "food_address", "movie_order", "dine_queue", "dine_booking", "transfer", "qr_payment", "payment", "red_packet_opened")
    val KNOWN_EVENTS = listOf("persona.action", "persona.message", "app.open", "login", "hint", "error", "ride.rated", "chat.message", "notification.open")

    private val ID_RE = Regex("^[a-z0-9][a-z0-9_-]{0,63}$")
    private val ACTION_RE = Regex("^[a-z][a-z0-9_]*$")
    private val TRAIN_NO_RE = Regex("^[GCDZTKLY]?[0-9]{1,5}$")
    private val SEAT_RE = Regex("^([0-9]+)-([0-9]+)$")
    private val OPS = listOf("eq", "ne", "in", "nin", "gt", "gte", "lt", "lte", "contains", "every", "some", "size", "exists", "match", "has_all")

    private fun isObj(v: JsonElement?): Boolean = v is JsonObject

    private fun get(v: JsonElement?, key: String): JsonElement? = (v as? JsonObject)?.get(key)

    private fun str(v: JsonElement?, max: Int = Limits.TEXT): Boolean {
        val s = JsJson.str(v) ?: return false
        return JsJson.trim(s).isNotEmpty() && s.length <= max
    }

    private fun num(v: JsonElement?, min: Double = 0.0): Boolean {
        val n = JsJson.num(v) ?: return false
        return n.isFinite() && n >= min
    }

    private fun s(v: JsonElement?): String = PhoneJs.jsString(v)

    private fun han(v: JsonElement?): Boolean = JsJson.str(v)?.let(PhoneJs::hasHan) ?: false

    private fun includes(list: List<String>, v: JsonElement?): Boolean = JsJson.str(v)?.let { it in list } ?: false

    /** `Set.has` over JS values (SameValueZero ≈ strict equality for primitives). */
    private fun hasValue(set: List<JsonElement?>, v: JsonElement?): Boolean = set.any { JsJson.strictEquals(it, v) }

    private fun arr(v: JsonElement?): JsonArray? = v as? JsonArray

    private fun bilingual(v: JsonElement?, path: String, out: MutableList<String>) {
        if (!isObj(v)) {
            out.add("$path: must be { en, zh }")
            return
        }
        if (!str(get(v, "en"))) out.add("$path.en: required text")
        if (!str(get(v, "zh"))) out.add("$path.zh: required text")
        else if (!han(get(v, "zh"))) out.add("$path.zh: must be in Chinese")
    }

    private fun matcherProblems(m: JsonElement?, path: String, out: MutableList<String>) {
        if (m is JsonNull || m is JsonPrimitive) return
        if (m !is JsonObject) {
            out.add("$path: a matcher is a value or an object of operators")
            return
        }
        if (m.keys.isEmpty()) out.add("$path: empty matcher")
        for (k in m.keys) if (k !in OPS) out.add("$path: unknown operator \"$k\"")
        if (m["in"] != null && m["in"] !is JsonArray) out.add("$path.in: must be a list")
        if (m["nin"] != null && m["nin"] !is JsonArray) out.add("$path.nin: must be a list")
        if (m["has_all"] != null && m["has_all"] !is JsonArray) out.add("$path.has_all: must be a list")
        m["every"]?.let { matcherProblems(it, "$path.every", out) }
        m["some"]?.let { matcherProblems(it, "$path.some", out) }
        m["match"]?.let { whereProblems(it, "$path.match", out) }
    }

    private fun whereProblems(w: JsonElement?, path: String, out: MutableList<String>) {
        if (w == null) return
        if (w !is JsonObject) {
            out.add("$path: must be an object of field → matcher")
            return
        }
        for ((k, v) in w) matcherProblems(v, "$path.$k", out)
    }

    private class Wait(val persona: JsonElement?, val action: JsonElement?, val path: String)

    private fun conditionProblems(c: JsonElement?, path: String, out: MutableList<String>, waits: MutableList<Wait>, depth: Int = 0) {
        if (depth > 8) {
            out.add("$path: nested too deep")
            return
        }
        if (c !is JsonObject) {
            out.add("$path: must be a condition object")
            return
        }
        when (JsJson.str(c["kind"])) {
            "record" -> {
                if (s(c["record"]) !in KNOWN_RECORDS) out.add("$path.record: unknown record \"${s(c["record"])}\" (one of ${KNOWN_RECORDS.joinToString(", ")})")
                whereProblems(c["where"], "$path.where", out)
            }
            "event" -> {
                if (s(c["event"]) !in KNOWN_EVENTS) out.add("$path.event: unknown event \"${s(c["event"])}\" (one of ${KNOWN_EVENTS.joinToString(", ")})")
                whereProblems(c["where"], "$path.where", out)
                val where = c["where"]
                if (JsJson.str(c["event"]) == "persona.action" && where is JsonObject) waits.add(Wait(where["persona"], where["action"], path))
            }
            "all_of", "any_of" -> {
                val list = arr(c["conditions"])
                if (list == null || list.isEmpty()) out.add("$path.conditions: a non-empty list")
                else list.forEachIndexed { i, x -> conditionProblems(x, "$path.conditions[$i]", out, waits, depth + 1) }
            }
            "not" -> conditionProblems(c["condition"], "$path.condition", out, waits, depth + 1)
            else -> out.add("$path.kind: one of record, event, all_of, any_of, not")
        }
    }

    private fun personaProblems(p: JsonElement?, i: Int, out: MutableList<String>) {
        val path = "personas[$i]"
        if (p !is JsonObject) {
            out.add("$path: must be an object")
            return
        }
        if (!str(p["id"], 64) || !ID_RE.matches(JsJson.str(p["id"])!!)) out.add("$path.id: lowercase id")
        if (!str(p["name"], 40)) out.add("$path.name: required")
        if (!str(p["role"])) out.add("$path.role: required")
        if (!str(p["personality"])) out.add("$path.personality: required")
        if (!str(p["knows"], 1500)) out.add("$path.knows: required (what they know, ≤ 1500 characters)")
        if (p["opening"] != null && (!str(p["opening"], 200) || !han(p["opening"]))) out.add("$path.opening: a short Chinese message")
        val actions = p["actions"]
        if (actions != null) {
            if (actions !is JsonArray) out.add("$path.actions: a list")
            else actions.forEachIndexed { j, a ->
                if (!isObj(a) || !str(get(a, "name"), 40) || !ACTION_RE.matches(JsJson.str(get(a, "name"))!!)) out.add("$path.actions[$j].name: snake_case name")
                if (!isObj(a) || !str(get(a, "description"))) out.add("$path.actions[$j].description: required")
                if (isObj(a) && get(a, "params") != null && !isObj(get(a, "params"))) out.add("$path.actions[$j].params: an object of name → description")
            }
        }
        val fake = p["fake_action"]
        if (fake != null) {
            val names = (actions as? JsonArray)?.map { a -> if (a is JsonObject) a["name"] else JsonNull } ?: emptyList()
            if (fake !is JsonObject || !hasValue(names, fake["name"])) out.add("$path.fake_action: must name one of its actions")
        }
    }

    fun validate(raw: JsonElement?): List<String> {
        val out = mutableListOf<String>()
        if (raw !is JsonObject) return listOf("spec: must be an object")
        val sp = raw

        if (!str(sp["id"], 64) || !ID_RE.matches(JsJson.str(sp["id"])!!)) out.add("id: lowercase letters, digits, - or _ (≤ 64)")
        if (JsJson.num(sp["version"]) != 1.0) out.add("version: must be 1")
        bilingual(sp["title"], "title", out)
        if (!includes(PHONE_DIFFICULTIES, sp["difficulty"])) out.add("difficulty: one of ${PHONE_DIFFICULTIES.joinToString(", ")}")
        val apps = arr(sp["apps"])
        if (apps == null || apps.isEmpty()) out.add("apps: at least one app")
        else apps.forEachIndexed { i, a -> if (!includes(PHONE_APP_IDS, a)) out.add("apps[$i]: unknown app \"${s(a)}\" (one of ${PHONE_APP_IDS.joinToString(", ")})") }
        if (!str(sp["situation"])) out.add("situation: required text")
        bilingual(sp["goal"], "goal", out)
        val facts = sp["facts"]
        if (facts != null) {
            if (facts !is JsonArray) out.add("facts: a list")
            else facts.forEachIndexed { i, f -> bilingual(f, "facts[$i]", out) }
        }
        if (!PhoneDates.isDate(JsJson.str(sp["today"]))) out.add("today: YYYY-MM-DD")
        if (!PhoneDates.isTime(JsJson.str(sp["now"]))) out.add("now: HH:MM")

        // Profile + wallet
        val profile = sp["profile"]
        if (profile !is JsonObject) out.add("profile: required")
        else {
            if (!str(profile["name"], 60)) out.add("profile.name: required")
            if (!str(profile["passport_no"], 20)) out.add("profile.passport_no: required")
            if (!str(profile["nationality"], 20)) out.add("profile.nationality: required")
            if (!str(profile["phone"], 20) || !PhoneJs.isMobile(JsJson.str(profile["phone"])!!)) out.add("profile.phone: an 11-digit mobile number")
        }
        val wallet = sp["wallet"]
        if (wallet !is JsonObject) out.add("wallet: required")
        else {
            if (!num(wallet["balance"])) out.add("wallet.balance: a number ≥ 0")
            val cards = wallet["cards"]
            if (cards !is JsonArray) out.add("wallet.cards: a list (may be empty)")
            else cards.forEachIndexed { i, c ->
                if (!isObj(c) || !str(get(c, "id"), 40) || !str(get(c, "bank"), 20) || !PhoneJs.allDigits(s(get(c, "last4")), 4) || !num(get(c, "balance"))) {
                    out.add("wallet.cards[$i]: { id, bank, kind, last4 (4 digits), balance }")
                }
            }
            val pw = JsJson.str(wallet["pay_password"])
            if (pw == null || !PhoneJs.allDigits(pw, 6)) out.add("wallet.pay_password: six digits")
        }

        // Worlds per app
        val w = sp["world"] as? JsonObject
        if (w == null) out.add("world: required")
        val needing = (apps ?: JsonArray(emptyList())).filter { a -> !(JsJson.str(a) == "wallet" || JsJson.str(a) == "sms") }
        for (a in needing) if (w != null && !isObj(w[s(a)])) out.add("world.${s(a)}: required because apps includes \"${s(a)}\"")

        val personaIds = mutableListOf<String>()
        val personasEl = sp["personas"]
        val personas = (personasEl as? JsonArray) ?: JsonArray(emptyList())
        if (personasEl != null && personasEl !is JsonArray) out.add("personas: a list")
        if (personas.size > Limits.PERSONAS) out.add("personas: at most ${Limits.PERSONAS}")
        personas.forEachIndexed { i, p ->
            personaProblems(p, i, out)
            val pid = JsJson.str(get(p, "id"))
            if (p is JsonObject && pid != null) {
                if (pid in personaIds) out.add("personas[$i].id: duplicate \"$pid\"")
                personaIds.add(pid)
            }
        }
        fun needPersona(id: JsonElement?, path: String) {
            if (id != null && (JsJson.str(id) == null || JsJson.str(id) !in personaIds)) out.add("$path: no persona \"${s(id)}\"")
        }

        if (JsJson.truthy(w?.get("rail"))) railProblems(w!!["rail"], out)
        if (JsJson.truthy(w?.get("ride"))) {
            val r = w!!["ride"]
            val start = get(r, "start")
            if (!isObj(start) || !str(get(start, "name"), 40)) out.add("world.ride.start: { name, address }")
            val pois = arr(get(r, "pois"))
            if (pois == null || pois.isEmpty()) out.add("world.ride.pois: at least one")
            else pois.forEachIndexed { i, p ->
                if (!isObj(p) || !str(get(p, "id"), 40) || !str(get(p, "name"), 40) || !str(get(p, "address"), 80) || !num(get(p, "km"), 0.1)) out.add("world.ride.pois[$i]: { id, name, address, km }")
            }
            val cars = arr(get(r, "cars"))
            if (cars == null || cars.isEmpty()) out.add("world.ride.cars: at least one")
            else cars.forEachIndexed { i, c ->
                if (!isObj(c) || !includes(RIDE_CAR_TYPES, get(c, "type")) || !num(get(c, "base")) || !num(get(c, "per_km")) || !num(get(c, "eta_min"))) {
                    out.add("world.ride.cars[$i]: { type (${RIDE_CAR_TYPES.joinToString("/")}), base, per_km, eta_min }")
                }
            }
            val driver = get(r, "driver")
            if (!isObj(driver) || !str(get(driver, "name"), 20) || !str(get(driver, "plate"), 20) || !str(get(driver, "car"), 40)) out.add("world.ride.driver: { name, car, plate, rating, trips }")
            else needPersona(get(driver, "persona"), "world.ride.driver.persona")
            needPersona(get(r, "arrival_persona"), "world.ride.arrival_persona")
            (arr(get(r, "trips")) ?: JsonArray(emptyList())).forEachIndexed { i, t ->
                if (!isObj(t) || !str(get(t, "id"), 40) || !PhoneDates.isDate(JsJson.str(get(t, "date"))) || !str(get(t, "from")) || !str(get(t, "to"))) {
                    out.add("world.ride.trips[$i]: { id, date, time, from, to, car_type, price, driver }")
                } else if (isObj(get(t, "driver"))) needPersona(get(get(t, "driver"), "persona"), "world.ride.trips[$i].driver.persona")
            }
        }

        if (JsJson.truthy(w?.get("food"))) {
            val f = w!!["food"]
            val shops = arr(get(f, "shops"))
            if (shops == null || shops.isEmpty()) out.add("world.food.shops: at least one")
            else {
                if (shops.size > Limits.SHOPS) out.add("world.food.shops: at most ${Limits.SHOPS}")
                shops.forEachIndexed { i, sh ->
                    val p = "world.food.shops[$i]"
                    if (!isObj(sh) || !str(get(sh, "id"), 40) || !str(get(sh, "name"), 30)) {
                        out.add("$p: { id, name, … }")
                        return@forEachIndexed
                    }
                    if (!num(get(sh, "rating")) || JsJson.num(get(sh, "rating"))!! > 5) out.add("$p.rating: 0–5")
                    if (!num(get(sh, "min_order")) || !num(get(sh, "delivery_fee")) || !num(get(sh, "delivery_min"), 1.0)) out.add("$p: min_order, delivery_fee, delivery_min")
                    val menu = arr(get(sh, "menu"))
                    if (menu == null || menu.isEmpty()) out.add("$p.menu: at least one category")
                    else menu.forEachIndexed { j, cat ->
                        val items = arr(get(cat, "items"))
                        if (!isObj(cat) || !str(get(cat, "category"), 20) || items == null || items.isEmpty()) {
                            out.add("$p.menu[$j]: { category, items }")
                            return@forEachIndexed
                        }
                        items.forEachIndexed { k, it ->
                            val ip = "$p.menu[$j].items[$k]"
                            if (!isObj(it) || !str(get(it, "id"), 40) || !str(get(it, "name"), 30) || !num(get(it, "price"), 0.01)) {
                                out.add("$ip: { id, name, price }")
                                return@forEachIndexed
                            }
                            (arr(get(it, "options")) ?: JsonArray(emptyList())).forEachIndexed { m, g ->
                                val choices = arr(get(g, "choices"))
                                if (!isObj(g) || !str(get(g, "name"), 12) || choices == null || choices.isEmpty()) out.add("$ip.options[$m]: { name, required, choices }")
                            }
                        }
                    }
                    needPersona(get(sh, "persona"), "$p.persona")
                }
            }
            if (get(f, "addresses") !is JsonArray) out.add("world.food.addresses: a list (may be empty)")
            needPersona(get(f, "rider_persona"), "world.food.rider_persona")
        }

        if (JsJson.truthy(w?.get("movie"))) {
            val m = w!!["movie"]
            val filmsArr = arr(get(m, "films"))
            val cinemasArr = arr(get(m, "cinemas"))
            val films = (filmsArr ?: JsonArray(emptyList())).map { x -> if (x is JsonObject) x["id"] else null }
            val cinemas = (cinemasArr ?: JsonArray(emptyList())).map { x -> if (x is JsonObject) x["id"] else null }
            if (filmsArr == null || filmsArr.isEmpty()) out.add("world.movie.films: at least one")
            else filmsArr.forEachIndexed { i, f ->
                if (!isObj(f) || !str(get(f, "id"), 40) || !str(get(f, "title"), 30) || !num(get(f, "minutes"), 30.0) || !num(get(f, "score"))) out.add("world.movie.films[$i]: { id, title, genres, minutes, score }")
            }
            if (cinemasArr == null || cinemasArr.isEmpty()) out.add("world.movie.cinemas: at least one")
            val shows = arr(get(m, "shows"))
            if (shows == null || shows.isEmpty()) out.add("world.movie.shows: at least one")
            else {
                if (shows.size > Limits.SHOWS) out.add("world.movie.shows: at most ${Limits.SHOWS}")
                shows.forEachIndexed { i, sh ->
                    val p = "world.movie.shows[$i]"
                    if (!isObj(sh) || !str(get(sh, "id"), 40)) {
                        out.add("$p: { id, film, cinema, date, start, hall, format, language, price, seats }")
                        return@forEachIndexed
                    }
                    if (!hasValue(films, get(sh, "film"))) out.add("$p.film: no film \"${s(get(sh, "film"))}\"")
                    if (!hasValue(cinemas, get(sh, "cinema"))) out.add("$p.cinema: no cinema \"${s(get(sh, "cinema"))}\"")
                    if (!PhoneDates.isDate(JsJson.str(get(sh, "date"))) || !PhoneDates.isTime(JsJson.str(get(sh, "start")))) out.add("$p: date / start")
                    if (!num(get(sh, "price"), 0.01)) out.add("$p.price: a price")
                    val map = get(sh, "seats")
                    if (!isObj(map) || !num(get(map, "rows"), 1.0) || !num(get(map, "cols"), 1.0) || JsJson.num(get(map, "rows"))!! > 20 || JsJson.num(get(map, "cols"))!! > 24) {
                        out.add("$p.seats: rows 1–20, cols 1–24")
                    } else {
                        val rows = JsJson.num(get(map, "rows"))!!
                        val cols = JsJson.num(get(map, "cols"))!!
                        val ids = listOf("sold", "couple", "missing").flatMap { k -> arr(get(map, k)) ?: emptyList() }
                        for (id in ids) {
                            val mm = SEAT_RE.matchEntire(s(id))
                            if (mm == null || mm.groupValues[1].toDouble() > rows || mm.groupValues[2].toDouble() > cols) out.add("$p.seats: bad seat id \"${s(id)}\" (row-col)")
                        }
                    }
                }
            }
        }

        if (JsJson.truthy(w?.get("dine"))) {
            val d = w!!["dine"]
            val rs = arr(get(d, "restaurants"))
            if (rs == null || rs.isEmpty()) out.add("world.dine.restaurants: at least one")
            else rs.forEachIndexed { i, r ->
                val p = "world.dine.restaurants[$i]"
                if (!isObj(r) || !str(get(r, "id"), 40) || !str(get(r, "name"), 30) || !num(get(r, "rating")) || !num(get(r, "avg_price"))) {
                    out.add("$p: { id, name, cuisine, rating, avg_price, … }")
                    return@forEachIndexed
                }
                (arr(get(r, "queue")) ?: JsonArray(emptyList())).forEachIndexed { j, t ->
                    if (!isObj(t) || !str(get(t, "id"), 4) || !num(get(t, "min"), 1.0) || !num(get(t, "max"), 1.0) || JsJson.num(get(t, "min"))!! > JsJson.num(get(t, "max"))!!) {
                        out.add("$p.queue[$j]: { id, name, min ≤ max, waiting, minutes }")
                    }
                }
                val b = get(r, "booking")
                if (JsJson.truthy(b)) {
                    val dates = arr(get(b, "dates"))
                    if (dates == null || dates.any { x -> !PhoneDates.isDate(JsJson.str(x)) }) out.add("$p.booking.dates: YYYY-MM-DD list")
                    val times = arr(get(b, "times"))
                    if (times == null || times.any { x -> !PhoneDates.isTime(JsJson.str(x)) }) out.add("$p.booking.times: HH:MM list")
                    if (!num(get(b, "max_people"), 1.0)) out.add("$p.booking.max_people: ≥ 1")
                }
                needPersona(get(r, "persona"), "$p.persona")
            }
        }

        if (JsJson.truthy(w?.get("chat"))) {
            val c = w!!["chat"]
            val contactsArr = arr(get(c, "contacts"))
            val contacts = (contactsArr ?: JsonArray(emptyList())).map { x -> if (x is JsonObject) x["id"] else null }
            val me = get(c, "me")
            if (!isObj(me) || !str(get(me, "name"), 30)) out.add("world.chat.me: { name, id }")
            if (contactsArr == null) out.add("world.chat.contacts: a list")
            else contactsArr.forEachIndexed { i, x ->
                if (!isObj(x) || !str(get(x, "id"), 40) || !str(get(x, "name"), 30)) out.add("world.chat.contacts[$i]: { id, name }")
                else needPersona(get(x, "persona"), "world.chat.contacts[$i].persona")
            }
            (arr(get(c, "threads")) ?: JsonArray(emptyList())).forEachIndexed { i, t ->
                val contact = if (t is JsonObject) t["contact"] else null
                if (!hasValue(contacts, contact)) out.add("world.chat.threads[$i].contact: no contact \"${s(contact)}\"")
            }
            (arr(get(c, "qr_codes")) ?: JsonArray(emptyList())).forEachIndexed { i, q ->
                val kind = JsJson.str(get(q, "kind"))
                if (!isObj(q) || !str(get(q, "id"), 40) || !str(get(q, "payee"), 30) || (kind != "pay" && kind != "contact")) out.add("world.chat.qr_codes[$i]: { id, payee, label, kind: pay | contact }")
            }
        }

        // Goals, mistakes, hints
        val waits = mutableListOf<Wait>()
        val goals = arr(sp["goals"])
        if (goals == null || goals.isEmpty()) out.add("goals: at least one")
        else {
            if (goals.size > Limits.GOALS) out.add("goals: at most ${Limits.GOALS}")
            if (goals.none { g -> g is JsonObject && !JsJson.truthy(g["optional"]) }) out.add("goals: at least one required (not optional) goal")
            val ids = mutableListOf<String>()
            goals.forEachIndexed { i, g ->
                if (!isObj(g) || !str(get(g, "id"), 40)) {
                    out.add("goals[$i]: { id, label, condition }")
                    return@forEachIndexed
                }
                val gid = JsJson.str(get(g, "id"))!!
                if (gid in ids) out.add("goals[$i].id: duplicate \"$gid\"")
                ids.add(gid)
                bilingual(get(g, "label"), "goals[$i].label", out)
                conditionProblems(get(g, "condition"), "goals[$i].condition", out, waits)
            }
        }
        (arr(sp["mistakes"]) ?: JsonArray(emptyList())).forEachIndexed { i, m ->
            if (!isObj(m) || !str(get(m, "id"), 40)) {
                out.add("mistakes[$i]: { id, label, when }")
                return@forEachIndexed
            }
            bilingual(get(m, "label"), "mistakes[$i].label", out)
            conditionProblems(get(m, "when"), "mistakes[$i].when", out, mutableListOf())
        }
        val hints = arr(sp["hints"])
        if (hints == null || hints.isEmpty()) out.add("hints: at least one")
        else {
            if (hints.size > Limits.HINTS) out.add("hints: at most ${Limits.HINTS}")
            hints.forEachIndexed { i, h ->
                bilingual(h, "hints[$i]", out)
                if (h is JsonObject && h["done"] != null) conditionProblems(h["done"], "hints[$i].done", out, mutableListOf())
            }
        }
        val vocab = arr(sp["vocab"])
        if (vocab == null) out.add("vocab: a list")
        else {
            if (vocab.size > Limits.VOCAB) out.add("vocab: at most ${Limits.VOCAB}")
            vocab.forEachIndexed { i, v ->
                if (!isObj(v) || !str(get(v, "hanzi"), 20) || !han(get(v, "hanzi")) || !str(get(v, "pinyin"), 60) || !str(get(v, "english"), 80)) out.add("vocab[$i]: { hanzi, pinyin, english }")
            }
        }

        // A goal waiting for a persona's action needs that persona and that action.
        for (wt in waits) {
            val pid = JsJson.str(wt.persona)
            if (pid == null) {
                out.add("${wt.path}: a persona.action condition needs where.persona")
                continue
            }
            val p = personas.firstOrNull { x -> x is JsonObject && JsJson.strictEquals(x["id"], wt.persona) } as? JsonObject
            if (p == null) out.add("${wt.path}: no persona \"$pid\"")
            else {
                val action = JsJson.str(wt.action)
                if (action != null && (arr(p["actions"]) ?: JsonArray(emptyList())).none { a -> JsJson.str(get(a, "name")) == action }) {
                    out.add("${wt.path}: persona \"$pid\" has no action \"$action\"")
                }
            }
        }
        return out
    }

    private fun railProblems(r: JsonElement?, out: MutableList<String>) {
        val stations = mutableListOf<String>()
        val st = arr(get(r, "stations"))
        if (st == null || st.size < 2) out.add("world.rail.stations: at least two")
        else st.forEachIndexed { i, x ->
            if (!isObj(x) || !str(get(x, "name"), 20) || !str(get(x, "city"), 20) || !str(get(x, "pinyin"), 60)) out.add("world.rail.stations[$i]: { name, city, pinyin }")
            else stations.add(JsJson.str(get(x, "name"))!!)
        }
        val trains = arr(get(r, "trains"))
        if (trains == null || trains.isEmpty()) out.add("world.rail.trains: at least one")
        else {
            if (trains.size > Limits.TRAINS) out.add("world.rail.trains: at most ${Limits.TRAINS}")
            val seen = mutableListOf<String>()
            trains.forEachIndexed { i, t ->
                val p = "world.rail.trains[$i]"
                if (t !is JsonObject) {
                    out.add("$p: must be an object")
                    return@forEachIndexed
                }
                if (!str(t["no"], 8) || !TRAIN_NO_RE.matches(JsJson.str(t["no"])!!)) out.add("$p.no: a train number like G7311")
                if (!PhoneDates.isDate(JsJson.str(t["date"]))) out.add("$p.date: YYYY-MM-DD")
                if (JsJson.str(t["from"]) !in stations || JsJson.str(t["from"]) == null) out.add("$p.from: no station \"${s(t["from"])}\"")
                if (JsJson.str(t["to"]) !in stations || JsJson.str(t["to"]) == null) out.add("$p.to: no station \"${s(t["to"])}\"")
                if (JsJson.strictEquals(t["from"], t["to"])) out.add("$p: from and to are the same")
                if (!PhoneDates.isTime(JsJson.str(t["depart"])) || !PhoneDates.isTime(JsJson.str(t["arrive"]))) out.add("$p: depart / arrive HH:MM")
                val seats = arr(t["seats"])
                if (seats == null || seats.isEmpty()) out.add("$p.seats: at least one seat class")
                else seats.forEachIndexed { j, o ->
                    if (!isObj(o) || !includes(RAIL_SEAT_CLASSES, get(o, "class")) || !num(get(o, "price"), 0.01) || !num(get(o, "left"))) {
                        out.add("$p.seats[$j]: { class (${RAIL_SEAT_CLASSES.joinToString("/")}), price, left }")
                    }
                }
                val key = "${s(t["no"])}|${s(t["date"])}"
                if (key in seen) out.add("$p: duplicate ${s(t["no"])} on ${s(t["date"])}")
                seen.add(key)
            }
        }
        val pids = mutableListOf<String>()
        val pas = get(r, "passengers")
        if (pas !is JsonArray) out.add("world.rail.passengers: a list (may be empty)")
        else pas.forEachIndexed { i, pa ->
            if (!isObj(pa) || !str(get(pa, "id"), 40) || !str(get(pa, "name"), 60) || !includes(RAIL_ID_TYPES, get(pa, "id_type")) || !str(get(pa, "id_no"), 20)) {
                out.add("world.rail.passengers[$i]: { id, name, id_type, id_no }")
            } else pids.add(JsJson.str(get(pa, "id"))!!)
        }
        (arr(get(r, "orders")) ?: JsonArray(emptyList())).forEachIndexed { i, o ->
            val p = "world.rail.orders[$i]"
            if (!isObj(o) || !str(get(o, "id"), 40)) {
                out.add("$p: { id, train_no, date, seat_class, passengers, seats, price_each }")
                return@forEachIndexed
            }
            val found = trains?.any { t -> JsJson.strictEquals(get(t, "no"), get(o, "train_no")) && JsJson.strictEquals(get(t, "date"), get(o, "date")) } ?: false
            if (!found) out.add("$p: no train ${s(get(o, "train_no"))} on ${s(get(o, "date"))}")
            val opas = get(o, "passengers")
            if (opas !is JsonArray || opas.any { x -> JsJson.str(x) == null || JsJson.str(x) !in pids }) out.add("$p.passengers: passenger ids from world.rail.passengers")
            val passLen = when {
                opas is JsonArray -> opas.size
                JsJson.str(opas) != null -> JsJson.str(opas)!!.length
                else -> -1
            }
            val seats = get(o, "seats")
            if (seats !is JsonArray || seats.size != passLen) out.add("$p.seats: one per passenger")
            if (!num(get(o, "price_each"), 0.01)) out.add("$p.price_each: a price")
        }
    }
}
