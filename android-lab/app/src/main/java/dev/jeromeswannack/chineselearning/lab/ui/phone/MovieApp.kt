package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.MovieFilm
import dev.jeromeswannack.chineselearning.lab.core.phone.MovieShow
import dev.jeromeswannack.chineselearning.lab.core.phone.MovieWorld
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy.ZH
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneMovie
import kotlinx.coroutines.launch

/*
 * 爆米花电影 (web apps/MovieApp.tsx) — 正在热映 → a film → 特惠购票 → cinemas (date tabs, IMAX filter,
 * distance, ¥起) → 场次 (版本, 厅, 散场 time) → 选座 (银幕中央, 已售, 情侣座 pairs, at most 4, "don't
 * leave a lone seat") → 确认订单 (小食 套餐) → pay → 取票码.
 */

private const val APP = "movie"
private val ACCENT = Color(0xFFE23D4B)

@Composable
private fun world(): MovieWorld = LocalPhone.current.spec.world.movie!!

private fun filmDate(p: PhoneRuntime, filmId: String): String = p.getState(APP, "date:$filmId", p.clock.date)

private fun selected(p: PhoneRuntime, showId: String): List<String> = p.getState(APP, "seats:$showId", emptyList())

@Composable
fun MovieApp(screen: PhoneScreen) {
    when (screen.name) {
        "film" -> Film(screen.p("film"))
        "cinemas" -> Cinemas(screen.p("film"))
        "shows" -> Shows(screen.p("film"), screen.p("cinema"))
        "seats" -> Seats(screen.p("show"))
        "confirm" -> Confirm(screen.p("show"))
        "ticket" -> Ticket(screen.p("id"))
        else -> MovieHome()
    }
}

private fun filmBrush(f: MovieFilm) = Brush.linearGradient(listOf(PC.hex(f.colors?.getOrNull(0), Color(0xFF444444)), PC.hex(f.colors?.getOrNull(1), Color(0xFF111111))))

@Composable
private fun Poster(f: MovieFilm, big: Boolean = false) {
    val w: Dp = if (big) 100.dp else 72.dp
    Box(Modifier.width(w).aspectRatio(0.72f).clip(RoundedCornerShape(6.dp)).background(filmBrush(f)).padding(6.dp), contentAlignment = Alignment.BottomStart) {
        Text(f.title, color = Color.White, fontSize = if (big) 14.sp else 11.sp, fontWeight = FontWeight.Bold, lineHeight = if (big) 18.sp else 14.sp)
    }
}

@Composable
private fun MovieHome() {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    var tab by remember { mutableStateOf("showing") }
    val home = p.getState(APP, "tab", "films")
    val films = w.films.filter { (it.status ?: "showing") == tab }
    val orders = p.recordsOf("movie_order").filter { PhoneJs.sOrNull(it.data, "status") == "paid" }.reversed()
    PScreen("movie-home") {
        PColumn {
            if (home == "films") {
                Row(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PText("${w.city} ▾", weight = FontWeight.Bold)
                    Box(Modifier.weight(1f).heightIn(min = 36.dp).clip(RoundedCornerShape(18.dp)).background(Color(0xFFF1F3F5)).tap { p.toast("搜索影片、影院：暂未开放") }.padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {
                        PText("🔍 找影视剧、影院", color = PC.ph, size = 13.sp)
                    }
                }
                PTabs(listOf("showing" to "正在热映", "coming" to "即将上映"), tab, ACCENT) { tab = it }
                PBody {
                    for (f in films) {
                        Row(Modifier.fillMaxWidth().background(Color.White).hairline().padding(12.dp).testTag("movie-film-${f.id}"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(Modifier.weight(1f).tap { nav.push("film", "film" to f.id) }, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Poster(f)
                                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    PText(f.title, size = 16.sp, weight = FontWeight.Bold)
                                    if (f.status == "coming") PText(f.release ?: "", size = 12.sp, color = PC.muted)
                                    else Row { PText("观众评分 ", size = 12.sp, color = PC.muted); PText(PhoneJs.numStr(f.score), size = 13.sp, color = Color(0xFFF7A400), weight = FontWeight.Bold) }
                                    PText(f.genres.joinToString("/"), size = 12.sp, color = PC.muted)
                                    f.cast?.let { PText(it, size = 12.sp, color = PC.muted, maxLines = 1) }
                                }
                            }
                            if (f.status == "coming") PBtn("想看", small = true, kind = BtnKind.LINE, accent = Color(0xFFF7A400)) { p.toast("已加入想看，上映时提醒你") }
                            else PBtn("购票", small = true, accent = ACCENT, tag = "movie-buy-${f.id}") { nav.push("cinemas", "film" to f.id) }
                        }
                    }
                }
            } else {
                PBody {
                    PBar("我的")
                    PGroup("电影票") {
                        if (orders.isEmpty()) PEmpty("还没有电影票", "🎬")
                        for (r in orders) PCell(PhoneJs.s(r.data, "film"), sub = "${PhoneDates.zhMonthDay(PhoneJs.s(r.data, "date"))} ${PhoneJs.s(r.data, "start")} · ${PhoneJs.s(r.data, "cinema")}", tag = "movie-order-${r.id}", onClick = { nav.push("ticket", "id" to r.id) })
                    }
                }
            }
            PTabBar(listOf(Triple("films", "电影", "🎬"), Triple("me", "我的", "👤")), home, ACCENT, "movie") { p.setState(APP, "tab", it) }
        }
    }
}

@Composable
private fun Film(filmId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val f = w.films.first { it.id == filmId }
    PScreen("movie-film-page") {
        PColumn {
            PBar(f.title, onBack = nav::pop)
            PBody {
                Row(Modifier.fillMaxWidth().background(filmBrush(f)).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Poster(f, big = true)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        PText(f.title, size = 20.sp, weight = FontWeight.Bold, color = Color.White)
                        f.original?.let { PText(it, size = 12.sp, color = Color(0xFFDDDDDD)) }
                        PText("${f.genres.joinToString(" / ")} · ${f.region ?: ""} · ${f.minutes}分钟", size = 12.sp, color = Color(0xFFDDDDDD))
                        if (f.status != "coming") Row(verticalAlignment = Alignment.Bottom) {
                            PText(PhoneJs.numStr(f.score), size = 22.sp, weight = FontWeight.Bold, color = Color(0xFFFFC53D))
                            PText(" 观众评分", size = 12.sp, color = Color(0xFFDDDDDD))
                        }
                    }
                }
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PText(f.cast ?: "", color = PC.muted)
                    PText("剧情简介：一段关于选择与勇气的故事，上映以来口碑持续发酵，适合与家人朋友一起观看。", lineHeight = 22.sp)
                }
            }
            if (f.status != "coming") PFooter { PBtn("特惠购票", Modifier.weight(1f), accent = ACCENT, tag = "movie-film-buy") { nav.push("cinemas", "film" to f.id) } }
        }
    }
}

@Composable
private fun DateTabs(dates: List<String>, value: String, today: String, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().background(Color.White).horizontalScroll(rememberScrollState()).hairline().padding(horizontal = 8.dp)) {
        for (d in dates) {
            val on = d == value
            val rel = PhoneDates.zhRelativeDay(d, today)
            Box(
                Modifier.heightIn(min = 44.dp).tap { onChange(d) }.then(if (on) Modifier.hairline(ACCENT) else Modifier).padding(horizontal = 12.dp).testTag("movie-date-$d"),
                contentAlignment = Alignment.Center,
            ) {
                PText("${if (rel == PhoneDates.zhWeekday(d)) PhoneDates.zhWeekday(d) else rel}${PhoneDates.zhMonthDay(d).replace("日", "")}", size = 14.sp, color = if (on) ACCENT else PC.value, weight = if (on) FontWeight.Bold else null)
            }
        }
    }
}

private fun filmDates(w: MovieWorld, filmId: String, today: String): List<String> {
    val set = w.shows.filter { it.film == filmId }.map { it.date }.toSet()
    return (0 until 5).map { PhoneDates.addDays(today, it) }.filter { it in set || it == today }
}

@Composable
private fun CinemaTags(tags: List<String>?) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { for (t in tags ?: emptyList()) PLineTag(t, color = Color(0xFF3A8EE6), border = Color(0xFFB9D6F6)) }
}

@Composable
private fun Cinemas(filmId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val f = w.films.first { it.id == filmId }
    val date = filmDate(p, filmId)
    var filter by remember { mutableStateOf("all") }
    val cinemas = w.cinemas
        .map { it to PhoneMovie.showsFor(w, filmId, date, it.id) }
        .filter { it.second.isNotEmpty() }
        .filter { (_, shows) -> filter != "imax" || shows.any { it.format.startsWith("IMAX") } }
        .sortedBy { it.first.km }
    PScreen("movie-cinemas") {
        PColumn {
            PBar(f.title, onBack = nav::pop)
            DateTabs(filmDates(w, filmId, p.clock.date), date, p.clock.date) { p.setState(APP, "date:$filmId", it) }
            PChipsBar {
                PChip("全城", on = filter == "all", accent = ACCENT) { filter = "all" }
                PChip("离我最近", on = filter == "near", accent = ACCENT) { filter = "near" }
                PChip("特色：IMAX厅", on = filter == "imax", accent = ACCENT, tag = "movie-filter-imax") { filter = "imax" }
            }
            PBody {
                if (cinemas.isEmpty()) PEmpty("当天没有该影片的场次，换个日期看看", "🎬")
                for ((c, shows) in cinemas) {
                    Column(Modifier.fillMaxWidth().background(Color.White).tap { nav.push("shows", "film" to filmId, "cinema" to c.id) }.hairline().padding(14.dp).testTag("movie-cinema-${c.id}"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            PText(c.name, size = 16.sp, weight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            PPrice(shows.minOf { it.price }, color = ACCENT)
                            PText("起", size = 12.sp, color = PC.muted)
                        }
                        Row { PText(c.address, size = 12.sp, color = PC.muted, modifier = Modifier.weight(1f), maxLines = 1); PText("${PhoneJs.numStr(c.km)}km", size = 12.sp, color = PC.muted) }
                        CinemaTags(c.tags)
                        PText("近期场次：${shows.take(4).joinToString(" | ") { it.start }}", size = 12.sp, color = PC.value)
                    }
                }
            }
        }
    }
}

@Composable
private fun Shows(filmId: String, cinemaId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val c = w.cinemas.first { it.id == cinemaId }
    val f = w.films.first { it.id == filmId }
    val date = filmDate(p, filmId)
    val shows = PhoneMovie.showsFor(w, filmId, date, cinemaId)
    fun started(s: MovieShow) = s.date == p.clock.date && PhoneDates.minutesOf(s.start) <= PhoneDates.minutesOf(p.clock.time)
    PScreen("movie-shows") {
        PColumn {
            PBar(c.name, onBack = nav::pop)
            Column(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 14.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                PText(c.address, size = 12.sp, color = PC.muted)
                CinemaTags(c.tags)
            }
            Row(Modifier.fillMaxWidth().background(Color(0xFF2B2B2B)).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Poster(f)
                Column {
                    PText(f.title, color = Color.White, size = 16.sp, weight = FontWeight.Bold)
                    PText("${f.minutes}分钟 | ${f.genres.joinToString("/")}", color = Color(0xFFCCCCCC), size = 12.sp)
                }
            }
            DateTabs(filmDates(w, filmId, p.clock.date), date, p.clock.date) { p.setState(APP, "date:$filmId", it) }
            PBody {
                if (shows.isEmpty()) PEmpty("今日场次已售完或已结束", "🎬")
                for (s in shows) {
                    val past = started(s)
                    Row(Modifier.fillMaxWidth().background(Color.White).hairline().alpha(if (past) 0.5f else 1f).padding(horizontal = 14.dp, vertical = 12.dp).testTag("movie-show-${s.id}"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.width(70.dp)) {
                            PText(s.start, size = 18.sp, weight = FontWeight.Bold)
                            PText("${PhoneMovie.showEnd(w, s)}散场", size = 11.sp, color = PC.muted)
                        }
                        Column(Modifier.weight(1f)) {
                            PText("${s.language} ${s.format}", size = 14.sp)
                            PText(s.hall, size = 11.sp, color = PC.muted)
                        }
                        PPrice(s.price, color = ACCENT)
                        PBtn(if (past) "已开场" else "购票", small = true, kind = if (past) BtnKind.GREY else BtnKind.LINE, accent = ACCENT, enabled = !past, tag = "movie-show-buy-${s.id}") { nav.push("seats", "show" to s.id) }
                    }
                }
            }
        }
    }
}

private val SEAT = 24.dp

@Composable
private fun SeatBox(kind: String, size: Dp = SEAT, modifier: Modifier = Modifier) {
    val (bg, border) = when (kind) {
        "sold" -> Color(0xFFD5D8DD) to Color(0xFFD5D8DD)
        "on" -> Color(0xFF29B35A) to Color(0xFF29B35A)
        "couple" -> Color(0xFFFFF0F4) to Color(0xFFF59AB4)
        else -> Color.White to Color(0xFFB9BEC6)
    }
    Box(modifier.size(size, size * 0.86f).clip(RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp, bottomStart = 3.dp, bottomEnd = 3.dp)).background(bg).border(1.dp, border, RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp, bottomStart = 3.dp, bottomEnd = 3.dp)))
}

@Composable
private fun Seats(showId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val show = w.shows.first { it.id == showId }
    val f = w.films.first { it.id == show.film }
    val sel = selected(p, showId)
    val sold = PhoneMovie.soldSeats(show, p.records)
    val map = show.seats
    fun tap(id: String) {
        val r = PhoneMovie.toggleSeat(map, sold, selected(p, showId), id)
        r.problem?.let { p.toast(it) }
        p.setState(APP, "seats:$showId", r.selected)
    }
    fun go() {
        val problem = PhoneMovie.singleGapProblem(map, sold, sel)
        if (problem != null) {
            p.emit("error", mapOf("code" to "seat_gap", "app" to APP))
            return p.toast(problem)
        }
        nav.push("confirm", "show" to showId)
    }
    PScreen("movie-seats") {
        PColumn {
            PBar(w.cinemas.firstOrNull { it.id == show.cinema }?.name ?: "", onBack = nav::pop)
            Column(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 14.dp, vertical = 8.dp)) {
                PText(f.title, size = 16.sp, weight = FontWeight.Bold)
                PText("${PhoneDates.zhRelativeDay(show.date, p.clock.date)} ${PhoneDates.zhMonthDay(show.date)} ${show.start} · ${show.language} ${show.format} · ${show.hall}", size = 12.sp, color = PC.muted)
            }
            Row(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                for ((k, label) in listOf("" to "可选", "sold" to "已售", "on" to "已选")) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) { SeatBox(k, 16.dp); PText(label, size = 12.sp, color = PC.value) }
                if (!map.couple.isNullOrEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) { SeatBox("couple", 16.dp); SeatBox("couple", 16.dp); PText(" 情侣座", size = 12.sp, color = PC.value) }
            }
            Column(Modifier.weight(1f).fillMaxWidth().background(Color(0xFFF2F3F5)).padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                PText("${show.hall} 银幕中央", size = 12.sp, color = PC.muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth(0.7f).clip(RoundedCornerShape(bottomStart = 40.dp, bottomEnd = 40.dp)).background(Color(0xFFDCDFE4)).padding(4.dp))
                Gap(16.dp)
                Column(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp).testTag("movie-seat-grid"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (row in 1..map.rows) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            PText(row.toString(), size = 11.sp, color = PC.muted, modifier = Modifier.width(18.dp))
                            for (col in 1..map.cols) {
                                val id = PhoneMovie.seatId(row, col)
                                val couple = PhoneMovie.couplePair(map, id)
                                Box(Modifier.size(SEAT + 4.dp, SEAT), contentAlignment = Alignment.Center) {
                                    if (PhoneMovie.seatExists(map, id)) {
                                        val kind = when {
                                            id in sold -> "sold"
                                            id in sel -> "on"
                                            couple != null -> "couple"
                                            else -> ""
                                        }
                                        SeatBox(kind, modifier = Modifier.tap(id !in sold) { tap(id) }.testTag("movie-seat-$id"))
                                    }
                                }
                                if (col in (map.aislesAfter ?: emptyList())) Box(Modifier.width(14.dp))
                            }
                        }
                    }
                }
            }
            Column(Modifier.fillMaxWidth().background(Color.White).hairline(PC.line, top = true).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (sel.isEmpty()) PText("请选择座位（一次最多4个）", color = PC.muted)
                    for (id in sel) {
                        Column(Modifier.clip(RoundedCornerShape(6.dp)).background(Color(0xFFF6F7F9)).tap { tap(id) }.padding(horizontal = 10.dp, vertical = 6.dp).testTag("movie-picked-$id")) {
                            PText(PhoneMovie.seatLabel(id), size = 13.sp, weight = FontWeight.SemiBold)
                            PText("¥${PhoneDates.yuan(show.price)} ✕", size = 11.sp, color = ACCENT)
                        }
                    }
                }
                PBtn(if (sel.isNotEmpty()) "¥${PhoneDates.yuan(show.price * sel.size)} 确认选座" else "请先选座", Modifier.fillMaxWidth(), accent = ACCENT, enabled = sel.isNotEmpty(), tag = "movie-seats-ok") { go() }
            }
        }
    }
}

@Composable
private fun Confirm(showId: String) {
    val p = LocalPhone.current
    val w = world()
    val nav = p.nav(APP)
    val show = w.shows.first { it.id == showId }
    val f = w.films.first { it.id == show.film }
    val cinema = w.cinemas.first { it.id == show.cinema }
    val sel = selected(p, showId)
    var snacks by remember { mutableStateOf(mapOf<String, Int>()) }
    val snackList = (w.snacks ?: emptyList()).map { PhoneMovie.SnackLine(it.name, it.price, snacks[it.id] ?: 0) }
    val total = PhoneDates.round2(show.price * sel.size + snackList.fold(0.0) { t, s -> t + s.price * s.qty })
    fun submit() {
        val id = p.newId("movie_order", "M")
        p.write("movie_order", id, PhoneMovie.movieOrderData(w, show, sel, snackList, id, "unpaid"))
        p.scope.launch {
            val r = p.pay(PayRequest(APP, "${f.title} ${sel.size}张", "爆米花电影", total))
            if (r == null) {
                p.write("movie_order", id, "status" to "cancelled")
                return@launch p.toast("支付未完成，座位已释放")
            }
            p.write("movie_order", id, "status" to "paid", "pay_method" to r.method)
            p.setState(APP, "seats:$showId", emptyList<String>())
            p.sms("10690000", "【爆米花电影】取票码${PhoneMovie.ticketCode(id)}，${PhoneDates.zhMonthDay(show.date)} ${show.start}《${f.title}》${cinema.name}${show.hall}，请提前到影院自助取票机取票。")
            nav.resetTo("ticket" to mapOf("id" to id))
        }
    }
    PScreen("movie-confirm") {
        PColumn {
            PBar("确认订单", onBack = nav::pop)
            PBody {
                Row(Modifier.fillMaxWidth().padding(10.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Poster(f)
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        PText(f.title, size = 16.sp, weight = FontWeight.Bold)
                        PText("${PhoneDates.zhRelativeDay(show.date, p.clock.date)} ${PhoneDates.zhMonthDay(show.date)} ${show.start} · ${show.language} ${show.format}", size = 12.sp, color = PC.value)
                        PText("${cinema.name} · ${show.hall}", size = 12.sp, color = PC.value)
                        PText(sel.joinToString("　") { PhoneMovie.seatLabel(it) }, size = 14.sp, weight = FontWeight.SemiBold, color = ACCENT, modifier = Modifier.testTag("movie-confirm-seats"))
                    }
                }
                PGroup("小食") {
                    for (s in w.snacks ?: emptyList()) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp).testTag("movie-snack-row-${s.id}"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f)) {
                                PText("🍿 ${s.name}", weight = FontWeight.Bold)
                                s.desc?.let { PText(it, size = 12.sp, color = PC.muted) }
                            }
                            PPrice(s.price, color = ACCENT)
                            PStepper(snacks[s.id] ?: 0, max = 4, tag = "movie-snack-${s.id}") { n -> snacks = snacks + (s.id to n) }
                        }
                    }
                }
                PGroup {
                    PCell("购票手机号", value = p.spec.profile.phone.replace(Regex("(\\d{3})\\d{4}(\\d{4})"), "$1****$2"), arrow = false)
                    PCell("优惠券", value = "暂无可用", arrow = false)
                }
                PNote("· 电影票一经售出，开场前60分钟以上可改签/退票，具体以影院规定为准\n· 请提前到影院取票，迟到可能影响观影")
            }
            PFooter {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) { PText("实付 ", size = 13.sp); PPrice(total, big = true, color = ACCENT) }
                PBtn(ZH.submitOrder, accent = ACCENT, tag = "movie-submit") { submit() }
            }
        }
    }
}

@Composable
private fun Ticket(id: String) {
    val p = LocalPhone.current
    val nav = p.nav(APP)
    val o = p.record("movie_order", id)
    if (o == null) {
        PScreen("movie-ticket") { PEmpty("订单不存在") }
        return
    }
    val snacks = PhoneJs.list(o, "snacks")
    PScreen("movie-ticket") {
        PColumn {
            PBar("电影票", onBack = nav::home)
            PBody {
                Column(Modifier.fillMaxWidth().padding(14.dp).clip(RoundedCornerShape(14.dp)).background(Color.White).padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    PText(PhoneJs.s(o, "film"), size = 20.sp, weight = FontWeight.Bold)
                    PText("${PhoneDates.zhMonthDay(PhoneJs.s(o, "date"))} ${PhoneJs.s(o, "start")} · ${PhoneJs.s(o, "language")} ${PhoneJs.s(o, "format")}", size = 13.sp, color = PC.value)
                    PText("${PhoneJs.s(o, "cinema")} ${PhoneJs.s(o, "hall")}", size = 13.sp, color = PC.value)
                    PText(PhoneJs.list(o, "seats").joinToString("　"), size = 16.sp, weight = FontWeight.SemiBold, color = ACCENT)
                    Gap(6.dp)
                    PText("取票码", size = 12.sp, color = PC.muted)
                    PText(PhoneJs.s(o, "code"), size = 28.sp, weight = FontWeight.Bold, modifier = Modifier.testTag("movie-code"))
                    Column(Modifier.size(120.dp).padding(4.dp)) {
                        for (y in 0 until 7) Row(Modifier.weight(1f)) {
                            for (x in 0 until 7) {
                                val i = y * 7 + x
                                val on = (i * 5 + 3) % 3 == 0 || i in setOf(0, 1, 7, 8, 5, 6, 12, 13, 35, 36, 42, 43)
                                Box(Modifier.weight(1f).fillMaxSize().background(if (on) Color(0xFF111111) else Color.White))
                            }
                        }
                    }
                    PText("请于开场前到影院自助取票机输入取票码取票", size = 12.sp, color = PC.muted, align = TextAlign.Center)
                    if (snacks.isNotEmpty()) PText("小食：${snacks.joinToString("、")}（凭取票码到卖品部领取）", size = 12.sp, color = PC.muted, align = TextAlign.Center)
                }
            }
        }
    }
}
