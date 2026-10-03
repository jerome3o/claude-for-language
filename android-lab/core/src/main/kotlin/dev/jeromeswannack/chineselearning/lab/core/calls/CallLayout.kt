package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Port of shared/calls/layout.ts — the call's layout, as tiles. Both apps follow the same pure
 * rules; parity-tested against the TypeScript (parity/fixtures/calls-layout.ts → CallsLayoutParityTest).
 *
 * Tiles: the other person's camera ([TileId.REMOTE]), my camera ([TileId.SELF]), a shared screen
 * ([TileId.SCREEN] — theirs or mine), the text board ([TileId.TEXT]), the drawing board
 * ([TileId.DRAW]) and the chat ([TileId.CHAT]). A layout is FOCUS (one tile on the stage), SPLIT
 * (two tiles with a draggable divider) or GRID (every open tile). The other person's camera is never
 * hidden: off the stage it floats (or sits in the rail when floating is off). Phones (< 640 wide)
 * use focus only, the cameras float and a swipe moves between tiles.
 *
 * Faces together (round 3, like Preply): content on the stage and neither camera → BOTH cameras
 * float as ONE box, the other person first ([Pip.PAIR], the default); it snaps to [Layout.pairCorner]
 * (top-left), resizes ([Layout.pairScale]) and a tap goes to Speaker ([Action.PairTap]). Only the
 * user's "Cameras: together / separate" changes [Layout.pip], so a stored SEPARATE is always their
 * own choice; a layout stored before round 3 has no `pip` and reads as PAIR.
 */
object CallLayout {
    /** `TileId`. */
    enum class TileId(val wire: String) {
        REMOTE("remote"), SELF("self"), SCREEN("screen"),
        /** Round 4: a lesson material being presented — like a shared screen, while one is open. */
        MATERIAL("material"),
        /** An in-call activity being played (shared/call-activities) — transient the same way. */
        ACTIVITY("activity"),
        TEXT("text"), DRAW("draw"), CHAT("chat");

        companion object {
            fun of(wire: String?): TileId? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `Corner`. */
    enum class Corner(val wire: String) {
        TL("tl"), TR("tr"), BL("bl"), BR("br");

        companion object {
            fun of(wire: String?): Corner? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `LayoutMode`. */
    enum class Mode(val wire: String) {
        FOCUS("focus"), SPLIT("split"), GRID("grid");

        companion object {
            fun of(wire: String?): Mode? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `CallLayout.dir`: side by side or stacked. */
    enum class Dir(val wire: String) {
        ROW("row"), COLUMN("column");

        companion object {
            fun of(wire: String?): Dir? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `PipMode`: over content the cameras float together (one box) or separately. */
    enum class Pip(val wire: String) {
        PAIR("pair"), SEPARATE("separate");

        companion object {
            fun of(wire: String?): Pip? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `PresetId`. */
    enum class PresetId(val wire: String) {
        SPEAKER("speaker"), BOARD("board"), SCREEN("screen"), SIDE("side"), GRID("grid");

        companion object {
            fun of(wire: String?): PresetId? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `ALL_TILES` — the order tiles are listed in everywhere. */
    val ALL_TILES: List<TileId> = listOf(TileId.REMOTE, TileId.SCREEN, TileId.MATERIAL, TileId.ACTIVITY, TileId.TEXT, TileId.DRAW, TileId.CHAT, TileId.SELF)

    /** `CallLayout` (the interface). */
    data class Layout(
        val mode: Mode,
        /** The focused tile (focus) / the first tile (split). */
        val main: TileId,
        /** The second tile of a split. */
        val second: TileId,
        /** The first tile's share of a split, 0.2 – 0.8. */
        val ratio: Double,
        val dir: Dir,
        val selfCorner: Corner,
        /** Floating camera size as a share of the default (0.6 – 2). */
        val selfScale: Double,
        /** The other person's camera floats over the stage when it isn't on it (else it goes in the rail). */
        val remoteFloat: Boolean,
        val remoteCorner: Corner,
        /** Which tiles are open. */
        val open: List<TileId>,
        /** Over content the two cameras float together (one box, both faces) or separately. Changed only by the user. */
        val pip: Pip = Pip.PAIR,
        /** The faces box's corner. */
        val pairCorner: Corner = Corner.TL,
        /** The faces box's size as a share of the default (0.6 – 2). */
        val pairScale: Double = 1.0,
    ) {
        /** What `JSON.stringify(layout)` stores (web localStorage `call-layout-v1:<userId>`). */
        fun toJson(): JsonObject = buildJsonObject {
            put("mode", mode.wire)
            put("main", main.wire)
            put("second", second.wire)
            put("ratio", ratio)
            put("dir", dir.wire)
            put("selfCorner", selfCorner.wire)
            put("selfScale", selfScale)
            put("remoteFloat", remoteFloat)
            put("remoteCorner", remoteCorner.wire)
            putJsonArray("open") { open.forEach { add(JsonPrimitive(it.wire)) } }
            put("pip", pip.wire)
            put("pairCorner", pairCorner.wire)
            put("pairScale", pairScale)
        }
    }

    const val MIN_RATIO = 0.2
    const val MAX_RATIO = 0.8
    const val MIN_SELF_SCALE = 0.6
    const val MAX_SELF_SCALE = 2.0
    const val MIN_PAIR_SCALE = 0.6
    const val MAX_PAIR_SCALE = 2.0

    /** `DEFAULT_LAYOUT`. */
    val DEFAULT_LAYOUT = Layout(
        mode = Mode.FOCUS, main = TileId.REMOTE, second = TileId.TEXT, ratio = 0.62, dir = Dir.ROW,
        selfCorner = Corner.BR, selfScale = 1.0, remoteFloat = true, remoteCorner = Corner.TR,
        open = listOf(TileId.REMOTE, TileId.SELF),
        pip = Pip.PAIR, pairCorner = Corner.TL, pairScale = 1.0,
    )

    /** `PresetInfo`. */
    data class PresetInfo(val id: PresetId, val label: String, val key: String)

    /** `PRESETS`. */
    val PRESETS: List<PresetInfo> = listOf(
        PresetInfo(PresetId.SPEAKER, "Speaker", "1"),
        PresetInfo(PresetId.BOARD, "Board + camera", "2"),
        PresetInfo(PresetId.SCREEN, "Screen + camera", "3"),
        PresetInfo(PresetId.SIDE, "Side by side", "4"),
        PresetInfo(PresetId.GRID, "Grid", "5"),
    )

    /** `TileAvailability`: a screen tile only while someone shares; a material tile only while one is presented; an activity tile while one runs. */
    data class Availability(val screen: Boolean, val material: Boolean = false, val activity: Boolean = false)

    /** `isAvailable`. */
    fun isAvailable(t: TileId, a: Availability): Boolean = when (t) {
        TileId.SCREEN -> a.screen
        TileId.MATERIAL -> a.material
        TileId.ACTIVITY -> a.activity
        else -> true
    }

    /** `isTransient`: tiles that show only while they exist and are always "open" then (a shared screen, a presented material, an activity). */
    private fun isTransient(t: TileId): Boolean = t == TileId.SCREEN || t == TileId.MATERIAL || t == TileId.ACTIVITY

    private fun clamp(x: Double, lo: Double, hi: Double): Double = Math.min(hi, Math.max(lo, x))

    private fun withOpen(l: Layout, vararg tiles: TileId): List<TileId> {
        val set = l.open.toMutableSet()
        set.addAll(tiles)
        return ALL_TILES.filter { it in set }
    }

    /** `LayoutAction`. */
    sealed interface Action {
        data class Focus(val tile: TileId) : Action
        data class Preset(val preset: PresetId) : Action
        data class Split(val a: TileId, val b: TileId) : Action
        /** Put [to] where [from] is (Board ⇄ Draw in the same place). */
        data class Swap(val from: TileId, val to: TileId) : Action
        data class Ratio(val ratio: Double) : Action
        data class SetDir(val dir: Dir) : Action
        data class SelfCorner(val corner: Corner) : Action
        data class SelfScale(val scale: Double) : Action
        data class RemoteCorner(val corner: Corner) : Action
        data class RemoteFloat(val on: Boolean) : Action
        data class Open(val tile: TileId) : Action
        data class Close(val tile: TileId) : Action
        /** The layout menu's "Cameras: together / separate". */
        data class SetPip(val pip: Pip) : Action
        data class PairCorner(val corner: Corner) : Action
        data class PairScale(val scale: Double) : Action
        /** A tap (not a drag) on the faces box: the other person on the stage. */
        data object PairTap : Action
        /** The other person starts sharing: their screen on the stage; the cameras float as the user chose. */
        data object ShareStarted : Action
        /** A lesson material is now presented (by either person): it goes on the stage, the cameras float. */
        data object MaterialStarted : Action
        /** An in-call activity started (by either person): it goes on the stage, the cameras float. */
        data object ActivityStarted : Action
        /** A tile dragged (or moved from its menu) onto a drop zone of the stage ([layoutForDrop]). */
        data class Drop(val tile: TileId, val zone: DropZone) : Action
        /**
         * Round 5: the tutor showed this tile to the student ("Show for student", CallFollow): it goes on the
         * stage with the cameras floating — unless it is already there (a split keeps its partner).
         */
        data class Shown(val tile: TileId) : Action
    }

    /** `layoutReducer`. */
    fun reduce(l: Layout, action: Action): Layout = when (action) {
        is Action.Focus ->
            // Focusing a tile that is already the only one on the stage returns to the camera.
            if (l.mode == Mode.FOCUS && l.main == action.tile && action.tile != TileId.REMOTE) l.copy(main = TileId.REMOTE)
            else l.copy(mode = Mode.FOCUS, main = action.tile, open = withOpen(l, action.tile))
        is Action.Split ->
            if (action.a == action.b) reduce(l, Action.Focus(action.a))
            else l.copy(mode = Mode.SPLIT, main = action.a, second = action.b, open = withOpen(l, action.a, action.b))
        is Action.Preset -> when (action.preset) {
            PresetId.SPEAKER -> l.copy(mode = Mode.FOCUS, main = TileId.REMOTE, remoteFloat = true)
            PresetId.BOARD -> l.copy(mode = Mode.SPLIT, main = TileId.TEXT, second = TileId.REMOTE, ratio = 0.65, dir = Dir.ROW, open = withOpen(l, TileId.TEXT))
            PresetId.SCREEN -> l.copy(mode = Mode.FOCUS, main = TileId.SCREEN, remoteFloat = true)
            PresetId.SIDE -> l.copy(mode = Mode.SPLIT, main = TileId.REMOTE, second = TileId.SELF, ratio = 0.5, dir = Dir.ROW)
            PresetId.GRID -> l.copy(mode = Mode.GRID)
        }
        is Action.Swap -> {
            val open = withOpen(l, action.to)
            when {
                l.mode == Mode.SPLIT && l.main == action.from ->
                    l.copy(main = action.to, second = if (l.second == action.to) action.from else l.second, open = open)
                l.mode == Mode.SPLIT && l.second == action.from ->
                    l.copy(second = action.to, main = if (l.main == action.to) action.from else l.main, open = open)
                l.mode == Mode.FOCUS && l.main == action.from -> l.copy(main = action.to, open = open)
                else -> l.copy(open = open)
            }
        }
        is Action.Ratio -> l.copy(ratio = clamp(action.ratio, MIN_RATIO, MAX_RATIO))
        is Action.SetDir -> l.copy(dir = action.dir)
        is Action.SelfCorner -> l.copy(selfCorner = action.corner)
        is Action.SelfScale -> l.copy(selfScale = clamp(action.scale, MIN_SELF_SCALE, MAX_SELF_SCALE))
        is Action.RemoteCorner -> l.copy(remoteCorner = action.corner)
        is Action.RemoteFloat -> l.copy(remoteFloat = action.on)
        is Action.Open -> l.copy(open = withOpen(l, action.tile))
        is Action.SetPip -> l.copy(pip = action.pip)
        is Action.PairCorner -> l.copy(pairCorner = action.corner)
        is Action.PairScale -> l.copy(pairScale = clamp(action.scale, MIN_PAIR_SCALE, MAX_PAIR_SCALE))
        Action.PairTap -> reduce(l, Action.Preset(PresetId.SPEAKER))
        Action.ShareStarted -> reduce(l, Action.Preset(PresetId.SCREEN))
        Action.MaterialStarted -> l.copy(mode = Mode.FOCUS, main = TileId.MATERIAL, remoteFloat = true)
        Action.ActivityStarted -> l.copy(mode = Mode.FOCUS, main = TileId.ACTIVITY, remoteFloat = true)
        is Action.Drop -> layoutForDrop(l, action.tile, action.zone)
        is Action.Shown -> {
            val open = withOpen(l, action.tile)
            val onStage = when (l.mode) {
                Mode.FOCUS -> l.main == action.tile
                Mode.SPLIT -> l.main == action.tile || l.second == action.tile
                else -> false
            }
            if (onStage) l.copy(open = open) else l.copy(mode = Mode.FOCUS, main = action.tile, remoteFloat = true, open = open)
        }
        is Action.Close -> {
            if (action.tile == TileId.REMOTE || action.tile == TileId.SELF) l // cameras can't be closed
            else {
                var next = l.copy(open = l.open.filter { it != action.tile })
                if (l.mode == Mode.FOCUS && l.main == action.tile) next = next.copy(main = TileId.REMOTE)
                if (l.mode == Mode.SPLIT && (l.main == action.tile || l.second == action.tile)) {
                    val other = if (l.main == action.tile) l.second else l.main
                    next = next.copy(mode = Mode.FOCUS, main = other)
                }
                next
            }
        }
    }

    /** `Arrangement`: where every tile goes. */
    data class Floating(val tile: TileId, val corner: Corner)
    /** [pair]: both cameras together in one floating box, in this corner (null = no pair). */
    data class Arrangement(val stage: List<TileId>, val rail: List<TileId>, val floating: List<Floating>, val mode: Mode, val pair: Corner? = null)

    /** `NARROW_WIDTH`: phones (focus only, the cameras float). */
    const val NARROW_WIDTH = 640.0

    /** `present`: the tile a missing one falls back to (a screen share that ended → the camera). */
    private fun present(t: TileId, a: Availability): TileId = if (isAvailable(t, a)) t else TileId.REMOTE

    /**
     * `narrowSplitAllowed`: phones keep one tile on the stage — except a shared screen with a board
     * (round 4: read the slide and write about it at once), which may split: stacked in portrait,
     * side by side in landscape ([splitDirFor]).
     */
    fun narrowSplitAllowed(l: Layout): Boolean {
        if (l.mode != Mode.SPLIT) return false
        val pair = listOf(l.main, l.second)
        return (TileId.SCREEN in pair || TileId.MATERIAL in pair) && (TileId.TEXT in pair || TileId.DRAW in pair)
    }

    /** `splitDirFor`: the direction a split is drawn in — the user's on wide screens; on a phone by its orientation. */
    fun splitDirFor(dir: Dir, w: Double, h: Double): Dir {
        if (w >= NARROW_WIDTH) return dir
        return if (w > h) Dir.ROW else Dir.COLUMN
    }

    /** `arrangeTiles`. */
    fun arrangeTiles(l: Layout, a: Availability, width: Double): Arrangement {
        val narrow = width < NARROW_WIDTH
        val openTiles = ALL_TILES.filter { isAvailable(it, a) && (it in l.open || it == TileId.REMOTE || it == TileId.SELF || isTransient(it)) }
        val content = if (l.main == TileId.SCREEN || l.second == TileId.SCREEN) a.screen else a.material
        var mode = if (narrow) (if (narrowSplitAllowed(l) && content) Mode.SPLIT else Mode.FOCUS) else l.mode
        val stage: List<TileId>
        if (mode == Mode.GRID) {
            stage = openTiles
        } else if (mode == Mode.SPLIT) {
            val first = present(l.main, a)
            val second = present(l.second, a)
            if (first == second) {
                mode = Mode.FOCUS
                stage = listOf(first)
            } else stage = listOf(first, second)
        } else {
            stage = listOf(present(l.main, a))
        }
        val floating = ArrayList<Floating>()
        // Content on the stage and neither camera: both faces together in one box (the other person first).
        if (l.pip == Pip.PAIR && mode != Mode.GRID && TileId.REMOTE !in stage && TileId.SELF !in stage && (l.remoteFloat || narrow)) {
            val rail = if (narrow) emptyList() else openTiles.filter { it !in stage && it != TileId.REMOTE && it != TileId.SELF }
            return Arrangement(stage, rail, floating, mode, l.pairCorner)
        }
        // The other person's camera: never hidden.
        if (TileId.REMOTE !in stage && (l.remoteFloat || narrow)) {
            floating += Floating(TileId.REMOTE, if (l.remoteCorner == l.selfCorner) otherCorner(l.selfCorner) else l.remoteCorner)
        }
        // My camera floats unless it's on the stage (in a grid it's a tile).
        if (TileId.SELF !in stage) floating += Floating(TileId.SELF, l.selfCorner)
        val floated = floating.map { it.tile }.toSet()
        val rail = if (narrow) emptyList() else openTiles.filter { it !in stage && it !in floated }
        return Arrangement(stage, rail, floating, mode)
    }

    /** `otherCorner`: the nearest free corner for a second floating camera. */
    fun otherCorner(c: Corner): Corner = when (c) {
        Corner.BR -> Corner.TR
        Corner.TR -> Corner.BR
        Corner.BL -> Corner.TL
        Corner.TL -> Corner.BL
    }

    /** `snapCorner`: a dropped floating tile (its centre, as fractions of the stage) → the nearest corner. */
    fun snapCorner(cx: Double, cy: Double): Corner {
        val top = cy < 0.5
        val left = cx < 0.5
        return if (top) (if (left) Corner.TL else Corner.TR) else if (left) Corner.BL else Corner.BR
    }

    /** `swipeOrder`: phones — the order a swipe walks through (only what is open and exists). */
    fun swipeOrder(l: Layout, a: Availability): List<TileId> =
        ALL_TILES.filter { it != TileId.SELF && isAvailable(it, a) && (it == TileId.REMOTE || isTransient(it) || it in l.open) }

    /** `swipeFocus`: swipe left (+1) / right (-1) from the focused tile. */
    fun swipeFocus(l: Layout, a: Availability, delta: Int): Layout {
        val order = swipeOrder(l, a)
        val cur = order.indexOf(present(l.main, a))
        val idx = Math.min(order.size - 1, Math.max(0, (if (cur < 0) 0 else cur) + delta))
        val next = order.getOrNull(idx) ?: return l
        return l.copy(mode = Mode.FOCUS, main = next)
    }

    /** `boardOnStage`: the board is on the stage (focus / split, not a grid). */
    fun boardOnStage(l: Layout): Boolean = l.mode != Mode.GRID && (l.main == TileId.TEXT || l.main == TileId.DRAW ||
        (l.mode == Mode.SPLIT && (l.second == TileId.TEXT || l.second == TileId.DRAW)))

    /**
     * `boardButton` (📝): back to the camera when the board is up; otherwise the board — focused with the
     * faces over it (phones, a split, cameras together), or the "Board + camera" split for separate cameras.
     */
    fun boardButton(l: Layout, narrow: Boolean): Action = when {
        boardOnStage(l) -> Action.Focus(TileId.REMOTE)
        l.mode == Mode.SPLIT || narrow || l.pip == Pip.PAIR -> Action.Focus(TileId.TEXT)
        else -> Action.Preset(PresetId.BOARD)
    }

    /** `layoutShortcut`: keyboard shortcut → action (null = not ours). */
    fun layoutShortcut(key: String): Action? {
        PRESETS.firstOrNull { it.key == key }?.let { return Action.Preset(it.id) }
        return when (key.lowercase()) {
            "b" -> Action.Focus(TileId.TEXT)
            "d" -> Action.Focus(TileId.DRAW)
            "c" -> Action.Focus(TileId.CHAT)
            "v" -> Action.Focus(TileId.REMOTE)
            "s" -> Action.Focus(TileId.SCREEN)
            "m" -> Action.Focus(TileId.MATERIAL)
            "a" -> Action.Focus(TileId.ACTIVITY)
            else -> null
        }
    }

    /** `sanitizeLayout`: stored layouts are validated; anything odd falls back to the default. */
    fun sanitize(raw: JsonElement?): Layout {
        // JS: `!raw || typeof raw !== 'object'` → default; an array is an object with no such keys.
        if (raw is JsonArray) return sanitize(JsonObject(emptyMap()))
        if (raw !is JsonObject) return DEFAULT_LAYOUT
        fun str(k: String): String? = (raw[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun num(k: String, d: Double, lo: Double, hi: Double): Double {
            val p = raw[k] as? JsonPrimitive ?: return d
            if (p.isString) return d
            val v = p.doubleOrNull ?: return d
            return if (v.isFinite()) clamp(v, lo, hi) else d
        }
        val openRaw = raw["open"]
        val open = if (openRaw is JsonArray) {
            val wires = openRaw.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            ALL_TILES.filter { it.wire in wires }
        } else DEFAULT_LAYOUT.open
        val rf = (raw["remoteFloat"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
        return Layout(
            mode = Mode.of(str("mode")) ?: DEFAULT_LAYOUT.mode,
            main = TileId.of(str("main")) ?: DEFAULT_LAYOUT.main,
            second = TileId.of(str("second")) ?: DEFAULT_LAYOUT.second,
            ratio = num("ratio", DEFAULT_LAYOUT.ratio, MIN_RATIO, MAX_RATIO),
            dir = if (str("dir") == "column") Dir.COLUMN else Dir.ROW,
            selfCorner = Corner.of(str("selfCorner")) ?: DEFAULT_LAYOUT.selfCorner,
            selfScale = num("selfScale", 1.0, MIN_SELF_SCALE, MAX_SELF_SCALE),
            remoteFloat = rf ?: true,
            remoteCorner = Corner.of(str("remoteCorner")) ?: DEFAULT_LAYOUT.remoteCorner,
            open = LinkedHashSet(listOf(TileId.REMOTE, TileId.SELF) + open).toList(),
            // Before round 3 there was no choice: a missing / odd value = together.
            pip = if (str("pip") == "separate") Pip.SEPARATE else Pip.PAIR,
            pairCorner = Corner.of(str("pairCorner")) ?: DEFAULT_LAYOUT.pairCorner,
            pairScale = num("pairScale", 1.0, MIN_PAIR_SCALE, MAX_PAIR_SCALE),
        )
    }

    // ------------------------------------------------------------------ rectangles

    /** `TileBox`. */
    data class Box(val x: Double, val y: Double, val w: Double, val h: Double)

    /** `TileRole`. */
    enum class Role(val wire: String) { STAGE("stage"), RAIL("rail"), FLOATING("floating"), PAIR("pair"), HIDDEN("hidden") }

    /** `TileRect`: z = stacking (stage 1, rail 1, floating 3, self floating 4). */
    data class Rect(val x: Double, val y: Double, val w: Double, val h: Double, val role: Role, val z: Int)

    /** `LayoutRects.divider`. */
    data class Divider(val x: Double, val y: Double, val w: Double, val h: Double, val dir: Dir)

    /** `LayoutRects.pair`: the faces box (both cameras inside it). */
    data class PairBox(val x: Double, val y: Double, val w: Double, val h: Double, val corner: Corner)

    /**
     * `LayoutRects`. [textInsetTop]: room the text board leaves at its top so the faces box in a top
     * corner over it never hides its first lines (round 4) — from the tile's top edge, 0 = none.
     */
    data class Rects(val tiles: Map<TileId, Rect>, val divider: Divider?, val stage: Box, val pair: PairBox? = null, val textInsetTop: Double = 0.0)

    const val TILE_GAP = 8.0
    const val DIVIDER = 12.0
    private const val FLOAT_MARGIN = 12.0
    /** Inside the faces box: padding around the faces and the gap between them. */
    const val PAIR_PAD = 4.0
    const val PAIR_GAP = 4.0

    /**
     * `TILE_HEADER`: the controls along the top of a content tile — the Board / Draw tabs (48), on the
     * drawing also its tool row (+56), on a shared screen the drawing row (56): in a top corner the faces
     * box sits below them.
     */
    val TILE_HEADER: Map<TileId, Double> = mapOf(TileId.TEXT to 48.0, TileId.DRAW to 104.0, TileId.SCREEN to 56.0, TileId.MATERIAL to 56.0, TileId.ACTIVITY to 48.0)

    /** A face's shape in the pair: the camera's, kept between portrait 3:4 and 16:9. */
    private fun faceAspect(a: Double?): Double = clamp(if (a != null && a > 0 && a.isFinite()) a else 4.0 / 3, 3.0 / 4, 16.0 / 9)

    /** `pairSize`'s result. */
    data class PairSize(val w: Double, val h: Double, val faceH: Double, val remoteW: Double, val selfW: Double)

    /**
     * `pairSize`: one height for both faces (~15 % of the stage's shorter side, phones ~16 % and smaller),
     * each face as wide as its camera, × scale; within 60 % of the stage's width (phones 70 %) and 40 % of its height.
     */
    fun pairSize(stage: Box, aspects: Map<TileId, Double>, scale: Double, narrow: Boolean): PairSize {
        val short = Math.min(stage.w, stage.h)
        val ar = faceAspect(aspects[TileId.REMOTE])
        val sa = faceAspect(aspects[TileId.SELF])
        val base = clamp(short * (if (narrow) 0.16 else 0.15), if (narrow) 56.0 else 72.0, if (narrow) 96.0 else 140.0) * scale
        val maxW = stage.w * (if (narrow) 0.7 else 0.6) - 2 * PAIR_PAD - PAIR_GAP
        val maxH = stage.h * 0.4 - 2 * PAIR_PAD
        val k = Math.max(0.0, Math.min(1.0, Math.min(maxW / (base * (ar + sa)), maxH / base)))
        val faceH = Js.round(base * k)
        val remoteW = Js.round(faceH * ar)
        val selfW = Js.round(faceH * sa)
        return PairSize(remoteW + selfW + PAIR_GAP + 2 * PAIR_PAD, faceH + 2 * PAIR_PAD, faceH, remoteW, selfW)
    }

    /** `floatingSize`: ~⅓ of the stage's shorter side (phones ~30 %), shaped like the video, × scale. */
    fun floatingSize(stage: Box, aspect: Double, scale: Double, narrow: Boolean): Pair<Double, Double> {
        val short = Math.min(stage.w, stage.h)
        val base = Math.min(if (narrow) 150.0 else 260.0, Math.max(88.0, short * (if (narrow) 0.3 else 0.26))) * scale
        val a = if (aspect > 0 && aspect.isFinite()) aspect else 4.0 / 3
        // `base` is the longer side.
        val w = if (a >= 1) base else base * a
        val h = if (a >= 1) base / a else base
        val maxW = stage.w * 0.5
        val maxH = stage.h * 0.5
        val k = Math.min(1.0, Math.min(maxW / w, maxH / h))
        return Js.round(w * k) to Js.round(h * k)
    }

    private fun cornerRect(stage: Box, corner: Corner, w: Double, h: Double): Box {
        val left = corner == Corner.TL || corner == Corner.BL
        val top = corner == Corner.TL || corner == Corner.TR
        return Box(
            Js.round(if (left) stage.x + FLOAT_MARGIN else stage.x + stage.w - w - FLOAT_MARGIN),
            Js.round(if (top) stage.y + FLOAT_MARGIN else stage.y + stage.h - h - FLOAT_MARGIN),
            w, h,
        )
    }

    /** `gridColumns`: columns for n tiles in a w × h area (tiles as close to 16:9 as possible). */
    fun gridColumns(n: Int, w: Double, h: Double): Int {
        var best = 1
        var bestScore = -1.0
        for (cols in 1..n) {
            val rows = Math.ceil(n.toDouble() / cols)
            val tw = (w - TILE_GAP * (cols - 1)) / cols
            val th = (h - TILE_GAP * (rows - 1)) / rows
            val fit = Math.min(tw, (th * 16) / 9) // the width a 16:9 picture gets
            if (fit > bestScore + 0.5) {
                best = cols
                bestScore = fit
            }
        }
        return best
    }

    /** `layoutRects`: where every tile is drawn in [w] × [h] (controls excluded). [aspects] = the cameras' w / h. */
    fun layoutRects(l: Layout, arr: Arrangement, w: Double, h: Double, aspects: Map<TileId, Double> = emptyMap()): Rects {
        val narrow = w < NARROW_WIDTH
        val tiles = LinkedHashMap<TileId, Rect>()
        ALL_TILES.forEach { tiles[it] = Rect(0.0, 0.0, 0.0, 0.0, Role.HIDDEN, 0) }
        // The rail: a column on the right (wide) or a strip along the bottom (medium widths).
        var stage = Box(0.0, 0.0, w, h)
        if (arr.rail.isNotEmpty()) {
            if (w >= 1024) {
                val rw = Js.round(Math.min(240.0, Math.max(160.0, w * 0.16)))
                val th = Js.round((rw * 9) / 16)
                stage = Box(0.0, 0.0, w - rw - TILE_GAP, h)
                arr.rail.forEachIndexed { i, t -> tiles[t] = Rect(w - rw, i * (th + TILE_GAP), rw, th, Role.RAIL, 1) }
            } else {
                val rh = Js.round(Math.min(120.0, Math.max(72.0, h * 0.16)))
                val tw = Js.round((rh * 16) / 9)
                stage = Box(0.0, 0.0, w, h - rh - TILE_GAP)
                arr.rail.forEachIndexed { i, t -> tiles[t] = Rect(i * (tw + TILE_GAP), h - rh, tw, rh, Role.RAIL, 1) }
            }
        }
        var divider: Divider? = null
        if (arr.mode == Mode.SPLIT && arr.stage.size == 2) {
            val (a, b) = arr.stage
            if (splitDirFor(l.dir, w, h) == Dir.ROW) {
                val aw = Js.round((stage.w - DIVIDER) * l.ratio)
                tiles[a] = Rect(stage.x, stage.y, aw, stage.h, Role.STAGE, 1)
                tiles[b] = Rect(stage.x + aw + DIVIDER, stage.y, stage.w - aw - DIVIDER, stage.h, Role.STAGE, 1)
                divider = Divider(stage.x + aw, stage.y, DIVIDER, stage.h, Dir.ROW)
            } else {
                val ah = Js.round((stage.h - DIVIDER) * l.ratio)
                tiles[a] = Rect(stage.x, stage.y, stage.w, ah, Role.STAGE, 1)
                tiles[b] = Rect(stage.x, stage.y + ah + DIVIDER, stage.w, stage.h - ah - DIVIDER, Role.STAGE, 1)
                divider = Divider(stage.x, stage.y + ah, stage.w, DIVIDER, Dir.COLUMN)
            }
        } else if (arr.mode == Mode.GRID) {
            val n = arr.stage.size
            val cols = gridColumns(n, stage.w, stage.h)
            val rows = Math.ceil(n.toDouble() / cols)
            val tw = (stage.w - TILE_GAP * (cols - 1)) / cols
            val th = (stage.h - TILE_GAP * (rows - 1)) / rows
            arr.stage.forEachIndexed { i, t ->
                val c = i % cols
                val r = Math.floor(i.toDouble() / cols)
                tiles[t] = Rect(Js.round(stage.x + c * (tw + TILE_GAP)), Js.round(stage.y + r * (th + TILE_GAP)), Js.round(tw), Js.round(th), Role.STAGE, 1)
            }
        } else if (arr.stage.isNotEmpty()) {
            tiles[arr.stage[0]] = Rect(stage.x, stage.y, stage.w, stage.h, Role.STAGE, 1)
        }
        for (f in arr.floating) {
            val scale = if (f.tile == TileId.SELF) l.selfScale else if (narrow) 0.9 else 1.0
            val (fw, fh) = floatingSize(stage, aspects[f.tile] ?: (4.0 / 3), scale, narrow)
            val box = cornerRect(stage, f.corner, fw, fh)
            tiles[f.tile] = Rect(box.x, box.y, box.w, box.h, Role.FLOATING, if (f.tile == TileId.SELF) 4 else 3)
        }
        var pair: PairBox? = null
        arr.pair?.let { corner ->
            val s = pairSize(stage, aspects, l.pairScale, narrow)
            val at = cornerRect(stage, corner, s.w, s.h)
            var y = at.y
            if (corner == Corner.TL || corner == Corner.TR) {
                // Below the controls along the top of the tile under this corner.
                val px = at.x + s.w / 2
                val py = at.y
                val under = arr.stage.firstOrNull { t ->
                    val r = tiles.getValue(t)
                    px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h
                }
                if (under != null) y += TILE_HEADER[under] ?: 0.0
            }
            pair = PairBox(at.x, y, s.w, s.h, corner)
            tiles[TileId.REMOTE] = Rect(at.x + PAIR_PAD, y + PAIR_PAD, s.remoteW, s.faceH, Role.PAIR, 3)
            tiles[TileId.SELF] = Rect(at.x + PAIR_PAD + s.remoteW + PAIR_GAP, y + PAIR_PAD, s.selfW, s.faceH, Role.PAIR, 3)
        }
        var textInsetTop = 0.0
        val text = tiles.getValue(TileId.TEXT)
        val p = pair
        if (p != null && (p.corner == Corner.TL || p.corner == Corner.TR) && text.role == Role.STAGE) {
            val overlapsX = p.x < text.x + text.w && p.x + p.w > text.x
            val overlapsY = p.y < text.y + text.h && p.y + p.h > text.y
            // Below the box, minus the tabs the board draws itself.
            if (overlapsX && overlapsY) textInsetTop = Math.max(0.0, Js.round(p.y + p.h + 4 - text.y - (TILE_HEADER[TileId.TEXT] ?: 0.0)))
        }
        return Rects(tiles, divider, stage, pair, textInsetTop)
    }

    // ------------------------------------------------------------------ drag and drop (round 4)

    /**
     * `DropZone`: the stage's left / right / top / bottom half and the whole of it. Dropping a tile on
     * one arranges a split (or a focus) with it ([layoutForDrop]); the Lab's long-press menu dispatches
     * the same [Action.Drop].
     */
    enum class DropZone(val wire: String) {
        LEFT("left"), RIGHT("right"), TOP("top"), BOTTOM("bottom"), FULL("full");

        companion object {
            fun of(wire: String?): DropZone? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `DROP_ZONES`. */
    val DROP_ZONES: List<DropZone> = listOf(DropZone.LEFT, DropZone.RIGHT, DropZone.TOP, DropZone.BOTTOM, DropZone.FULL)

    /** `DROP_EDGE`: within this share of the stage from an edge, a point is in that edge's half; further in, FULL. */
    const val DROP_EDGE = 0.3

    /** `dropZoneAt`: the zone under a point given as fractions (0–1) of the stage. */
    fun dropZoneAt(fx: Double, fy: Double): DropZone {
        val x = clamp(fx, 0.0, 1.0)
        val y = clamp(fy, 0.0, 1.0)
        val edges = listOf(DropZone.LEFT to x, DropZone.RIGHT to 1 - x, DropZone.TOP to y, DropZone.BOTTOM to 1 - y)
        var best = edges[0]
        for (e in edges) if (e.second < best.second) best = e
        return if (best.second < DROP_EDGE) best.first else DropZone.FULL
    }

    /** `dropZoneBox`: the area a zone highlights (where the tile will go), inside the stage. */
    fun dropZoneBox(zone: DropZone, stage: Box): Box {
        val hw = Js.round(stage.w / 2)
        val hh = Js.round(stage.h / 2)
        return when (zone) {
            DropZone.LEFT -> Box(stage.x, stage.y, hw, stage.h)
            DropZone.RIGHT -> Box(stage.x + stage.w - hw, stage.y, hw, stage.h)
            DropZone.TOP -> Box(stage.x, stage.y, stage.w, hh)
            DropZone.BOTTOM -> Box(stage.x, stage.y + stage.h - hh, stage.w, hh)
            DropZone.FULL -> stage.copy()
        }
    }

    /**
     * `layoutForDrop`: the layout after dropping [tile] on [zone]. FULL focuses it. A half puts it on that
     * side and keeps, beside it, the tile that was on the stage — in a split, the pane on the OTHER side
     * (so dropping on the left replaces the left pane). A fresh split starts at half / half; one in the
     * same direction keeps its divider.
     */
    fun layoutForDrop(l: Layout, tile: TileId, zone: DropZone): Layout {
        if (zone == DropZone.FULL) return reduce(l, Action.Focus(tile)).copy(mode = Mode.FOCUS, main = tile)
        val first = zone == DropZone.LEFT || zone == DropZone.TOP
        val dir = if (zone == DropZone.LEFT || zone == DropZone.RIGHT) Dir.ROW else Dir.COLUMN
        var keep: TileId
        if (l.mode == Mode.SPLIT) {
            keep = if (first) l.second else l.main
            if (keep == tile) keep = if (first) l.main else l.second
        } else keep = l.main
        if (keep == tile) return reduce(l, Action.Focus(tile)).copy(mode = Mode.FOCUS, main = tile)
        val ratio = if (l.mode == Mode.SPLIT && l.dir == dir) l.ratio else 0.5
        val next = reduce(l, Action.Split(if (first) tile else keep, if (first) keep else tile))
        return next.copy(dir = dir, ratio = ratio)
    }

    /** `DROP_ZONE_LABELS`: the keyboard / menu fallback's labels. */
    val DROP_ZONE_LABELS: Map<DropZone, String> = mapOf(
        DropZone.LEFT to "Left half",
        DropZone.RIGHT to "Right half",
        DropZone.TOP to "Top half",
        DropZone.BOTTOM to "Bottom half",
        DropZone.FULL to "Whole stage",
    )
}
