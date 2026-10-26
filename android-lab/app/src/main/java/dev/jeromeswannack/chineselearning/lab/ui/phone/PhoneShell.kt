package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneDates
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import kotlinx.coroutines.delay

/*
 * The phone itself (web PhoneShell.tsx): status bar, home screen of app icons, the open apps
 * (each a stack of screens kept composed, so switching apps keeps where you were and a trip keeps
 * moving), notification banners, the toast, the pay sheet, the recents switcher and the
 * Android-style navigation bar (◁ back · ○ home · ▢ recents) with the task card 📋 and the hint 💡
 * at its ends.
 */

/** The simulated apps by id (web apps/index.ts). */
@Composable
fun AppScreen(app: String, screen: PhoneScreen) {
    when (app) {
        "rail" -> RailApp(screen)
        "ride" -> RideApp(screen)
        "food" -> FoodApp(screen)
        "movie" -> MovieApp(screen)
        "dine" -> DineApp(screen)
        "chat" -> ChatApp(screen)
        "wallet" -> WalletApp()
        "sms" -> SmsApp(screen)
    }
}

@Composable
private fun StatusBar(p: PhoneRuntime, inApp: Boolean) {
    val ink = if (inApp) Color(0xFF111111) else Color.White
    Row(
        Modifier.fillMaxWidth().height(28.dp).background(if (inApp) Color.White.copy(alpha = 0.92f) else Color.Transparent).padding(start = 22.dp, end = 18.dp).testTag("phone-status"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(p.clock.time, color = ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        if (p.online) Text("5G", color = ink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) else Text("无服务", color = Color(0xFFCC0000), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Text(if (p.online) " ▂▄▆█" else " ▂___", color = ink, fontSize = 9.sp, letterSpacing = (-2).sp)
        if (p.online) Text(" ◠", color = ink, fontSize = 11.sp)
        Box(Modifier.padding(start = 5.dp).size(22.dp, 11.dp).border(1.5.dp, ink, RoundedCornerShape(3.dp)).padding(1.5.dp)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(0.78f).clip(RoundedCornerShape(1.dp)).background(ink))
        }
        Text(" 78", color = ink, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Unread badges on the home screen (web `unreadFor`). */
fun unreadFor(app: String, p: PhoneRuntime): Int {
    if (app == "chat") {
        val read = p.events.filter { PhoneEngine.type(it) == "chat.read" }.map { PhoneJs.s(it, "contact") }.toSet()
        return (p.spec.world.chat?.threads ?: emptyList()).filter { it.contact !in read }.sumOf { it.unread ?: 0 }
    }
    if (app == "sms") {
        var n = 0
        for (e in p.events) {
            if (PhoneEngine.type(e) == "sms") n++
            else if (PhoneEngine.type(e) == "app.open" && PhoneJs.sOrNull(e, "app") == "sms") n = 0
        }
        return if (p.current == "sms") 0 else n
    }
    return 0
}

private val HOME_BG = Brush.linearGradient(
    0f to Color(0xFF3B6AA8), 0.55f to Color(0xFF6B4F9C), 1f to Color(0xFFC5677D),
    start = androidx.compose.ui.geometry.Offset(0f, 0f), end = androidx.compose.ui.geometry.Offset(400f, 2400f),
)

@Composable
private fun HomeScreen(p: PhoneRuntime) {
    Column(Modifier.fillMaxSize().background(HOME_BG).padding(start = 18.dp, end = 18.dp, top = 48.dp, bottom = 16.dp).testTag("phone-home")) {
        Column(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 26.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(p.clock.time, color = Color.White, fontSize = 56.sp, fontWeight = FontWeight.Light, letterSpacing = 1.sp)
            Text("${PhoneDates.zhMonthDay(p.clock.date)} ${PhoneDates.zhWeekdayLong(p.clock.date)}", color = Color.White.copy(alpha = 0.9f), fontSize = 15.sp, modifier = Modifier.padding(top = 6.dp))
        }
        val dim = listOf(Triple("相机", "◉", Color(0xFF596275)), Triple("图库", "▣", Color(0xFFE77F67)), Triple("设置", "⚙", Color(0xFF8395A7)), Triple("日历", "历", Color(0xFFF8A5C2)))
        val cells: List<@Composable () -> Unit> = PhoneCopy.HOME_SCREEN_ORDER.map { app ->
            @Composable {
                HomeApp(PhoneCopy.app(app).name, "home-app-$app", onClick = { p.openApp(app) }) {
                    AppIcon(app, badge = unreadFor(app, p))
                }
            }
        } + dim.map { (name, glyph, color) ->
            @Composable {
                HomeApp(name, null, dim = true, onClick = { p.toast("本次练习不需要这个应用") }) {
                    Box(Modifier.size(54.dp).clip(RoundedCornerShape(15.dp)).background(color), contentAlignment = Alignment.Center) { Text(glyph, color = Color.White, fontSize = 24.sp) }
                }
            }
        }
        cells.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(bottom = 18.dp)) {
                for (c in row) Box(Modifier.weight(1f), contentAlignment = Alignment.TopCenter) { c() }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        Spacer(Modifier.weight(1f))
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(Color.White.copy(alpha = 0.18f)).padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterHorizontally),
        ) {
            for (app in PhoneCopy.DOCK_ORDER) {
                Box(Modifier.clickable { p.openApp(app) }.testTag("home-app-$app")) { AppIcon(app, badge = unreadFor(app, p)) }
            }
        }
    }
}

@Composable
private fun HomeApp(name: String, tag: String?, dim: Boolean = false, onClick: () -> Unit, icon: @Composable () -> Unit) {
    Column(
        Modifier.widthIn(min = 64.dp).heightIn(min = 44.dp).alpha(if (dim) 0.75f else 1f).clickable(onClick = onClick).then(if (tag != null) Modifier.testTag(tag) else Modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        icon()
        Spacer(Modifier.height(6.dp))
        PText(name, size = 12.sp, color = Color.White, maxLines = 1)
    }
}

/** Places only the visible layer (hidden ones stay composed: their state and timers live on). */
private fun Modifier.shown(visible: Boolean) = layout { m, c ->
    val pl = m.measure(c)
    layout(pl.width, pl.height) { if (visible) pl.place(0, 0) }
}

@Composable
private fun AppView(p: PhoneRuntime, app: String) {
    val stack = p.stacks[app] ?: emptyList()
    val appVisible = p.current == app
    Box(Modifier.fillMaxSize().shown(appVisible).testTag("app-$app")) {
        stack.forEachIndexed { i, screen ->
            key(screen.key) {
                val top = i == stack.size - 1
                Box(Modifier.fillMaxSize().shown(top).background(PC.bg)) {
                    // A pushed screen slides in a little from the right (web `ph-slide`, 0.18 s).
                    val slide = remember { androidx.compose.animation.core.Animatable(if (i > 0) 0.24f else 0f) }
                    LaunchedEffect(Unit) { slide.animateTo(0f, androidx.compose.animation.core.tween(180)) }
                    Box(Modifier.fillMaxSize().graphicsLayer { translationX = size.width * slide.value; alpha = 1f - slide.value * 1.6f }) {
                        AppScreen(app, screen)
                    }
                }
            }
        }
    }
}

@Composable
private fun BoxScope.Banners(p: PhoneRuntime) {
    if (p.notifications.isEmpty()) return
    Column(Modifier.align(Alignment.TopCenter).padding(start = 8.dp, end = 8.dp, top = 30.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (n in p.notifications.take(2)) {
            key(n.id) {
                Row(
                    Modifier.fillMaxWidth().shadow(10.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp)).background(Color(0xF7FAFAFC))
                        .clickable {
                            p.dismissNotification(n.id)
                            p.emit("notification.open", "app" to kotlinx.serialization.json.JsonPrimitive(n.app))
                            n.open?.let { p.openApp(it.app, it.screen, it.params) }
                        }
                        .testTag("phone-notification").padding(horizontal = 12.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    AppIcon(n.app, small = true)
                    Column(Modifier.weight(1f)) {
                        Row {
                            PText(n.title, size = 13.sp, weight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1)
                            Text("现在", fontSize = 13.sp, color = Color(0xFF888888))
                        }
                        PText(n.body, size = 13.sp, color = Color(0xFF333333), maxLines = 2)
                    }
                }
            }
        }
    }
}

@Composable
private fun BoxScope.Recents(p: PhoneRuntime, onClose: () -> Unit) {
    Box(
        Modifier.matchParentSize().background(Color(0xD114161C)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose).testTag("phone-recents"),
        contentAlignment = Alignment.Center,
    ) {
        if (p.recents.isEmpty()) Text("近期没有使用的应用", color = Color(0xFFDDDDDD), fontSize = 14.sp)
        else Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            for (app in p.recents) {
                val meta = PhoneCopy.app(app)
                Column(
                    Modifier.size(190.dp, 360.dp).clip(RoundedCornerShape(18.dp)).background(Color.White).clickable { p.openApp(app); onClose() },
                ) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AppIcon(app, small = true)
                        PText(meta.name, weight = FontWeight.SemiBold)
                    }
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(PC.of(meta.colors.first).copy(alpha = 0.13f), Color.White))))
                }
            }
        }
    }
}

/**
 * The phone: fills its box. [onTask] / [onHint] are the nav bar's 📋 / 💡; [overlay] draws above
 * the phone's screen (task card, hint bubble) but below its nav bar.
 */
@Composable
fun PhoneShell(p: PhoneRuntime, onTask: () -> Unit, onHint: () -> Unit, hintDot: Boolean = false, showTaskButton: Boolean = true, recentsOpen: Boolean, setRecents: (Boolean) -> Unit, overlay: @Composable BoxScope.() -> Unit = {}) {
    LaunchedEffect(p) {
        while (true) {
            delay(15_000)
            p.clockMs = p.now()
        }
    }
    Column(Modifier.fillMaxSize().background(PC.bg)) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize()) {
                if (p.current != null) StatusBar(p, inApp = true)
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    if (p.current == null || p.opened.isEmpty()) HomeScreen(p)
                    for (app in p.opened) key(app) { AppView(p, app) }
                }
            }
            if (p.current == null) Box(Modifier.align(Alignment.TopCenter)) { StatusBar(p, inApp = false) }
            if (recentsOpen) Recents(p) { setRecents(false) }
            Banners(p)
            p.toastText?.let { t ->
                Box(Modifier.align(Alignment.Center).padding(bottom = 60.dp).widthIn(max = 320.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xC7000000)).padding(horizontal = 16.dp, vertical = 10.dp).testTag("phone-toast")) {
                    PText(t, color = Color.White, align = TextAlign.Center)
                }
            }
            PaySheet(p)
            PhoneVoiceOverlay(p)
            overlay()
        }
        Row(Modifier.fillMaxWidth().height(46.dp).background(Color.Black), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceAround) {
            NavKey("📋", "phone-task-button", alpha = if (showTaskButton) 0.9f else 0.35f, onClick = onTask)
            NavKey("◁", "phone-back") { if (recentsOpen) setRecents(false) else p.back() }
            NavKey("○", "phone-home-button") { setRecents(false); p.goHome() }
            NavKey("▢", "phone-recents-button") { setRecents(!recentsOpen) }
            Box {
                NavKey("💡", "phone-hint-button", alpha = 0.9f, onClick = onHint)
                if (hintDot) Box(Modifier.align(Alignment.TopEnd).padding(top = 10.dp, end = 14.dp).size(7.dp).clip(CircleShape).background(Color(0xFFFACC15)))
            }
        }
    }
}

@Composable
private fun NavKey(label: String, tag: String, alpha: Float = 1f, onClick: () -> Unit) {
    Box(Modifier.size(52.dp, 44.dp).clickable(onClick = onClick).testTag(tag), contentAlignment = Alignment.Center) {
        Text(label, color = Color.White, fontSize = if (label.length > 1 || label == "📋" || label == "💡") 18.sp else 20.sp, modifier = Modifier.alpha(alpha))
    }
}
