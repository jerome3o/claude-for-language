package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.DropZone
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId

/**
 * Round 4 (Jerome's ask): a shared screen and the board together — read the slide and write about it at
 * once. Side by side when unfolded / in landscape, stacked when folded in portrait (core
 * `narrowSplitAllowed` / `splitDirFor`). The Lab's touch control for the web's drag-and-drop: long-press
 * the shared screen or the board (or the "📝 + 🖥️" chip on the screen) → a menu whose choices are
 * the same `drop` actions the web's drop zones dispatch.
 */
object ScreenBoardSplit {
    enum class Choice { BESIDE, BELOW, ABOVE, BOARD_ONLY, SCREEN_ONLY }

    data class Item(val choice: Choice, val label: String, val current: Boolean)

    private fun isBoard(t: TileId) = t == TileId.TEXT || t == TileId.DRAW

    /** The board the menu talks about: the long-pressed one, else the one on the stage, else the text board. */
    fun boardOf(l: CallLayout.Layout, pressed: TileId? = null): TileId = when {
        pressed != null && isBoard(pressed) -> pressed
        l.mode != CallLayout.Mode.GRID && isBoard(l.main) -> l.main
        l.mode == CallLayout.Mode.SPLIT && isBoard(l.second) -> l.second
        else -> TileId.TEXT
    }

    /** The shared screen (or a presented material) and a board are on the stage together. */
    fun isSplit(l: CallLayout.Layout): Boolean = CallLayout.narrowSplitAllowed(l)

    /**
     * Round 4 PR 5: what the menu pairs the board with — the long-pressed shared screen / material, else the one
     * already in a split, else whichever exists (a presented material first: it was put up for the lesson).
     */
    fun contentOf(l: CallLayout.Layout, available: CallLayout.Availability, pressed: TileId? = null): TileId? = when {
        pressed == TileId.SCREEN && available.screen -> TileId.SCREEN
        pressed == TileId.MATERIAL && available.material -> TileId.MATERIAL
        l.mode != CallLayout.Mode.GRID && (l.main == TileId.MATERIAL || l.second == TileId.MATERIAL) && available.material -> TileId.MATERIAL
        l.mode != CallLayout.Mode.GRID && (l.main == TileId.SCREEN || l.second == TileId.SCREEN) && available.screen -> TileId.SCREEN
        available.material -> TileId.MATERIAL
        available.screen -> TileId.SCREEN
        else -> null
    }

    /** The split's look in a [w] × [h] box (dp): side by side, or the board below / above the screen. Null = no split. */
    fun current(l: CallLayout.Layout, w: Double, h: Double, content: TileId = TileId.SCREEN): Choice? {
        if (isSplit(l)) {
            if (l.main != content && l.second != content) return null
            val dir = CallLayout.splitDirFor(l.dir, w, h)
            if (dir == CallLayout.Dir.ROW) return Choice.BESIDE
            return if (l.main == content) Choice.BELOW else Choice.ABOVE
        }
        if (l.mode != CallLayout.Mode.FOCUS) return null
        return when {
            l.main == content -> Choice.SCREEN_ONLY
            isBoard(l.main) -> Choice.BOARD_ONLY
            else -> null
        }
    }

    /**
     * The menu for a [w] × [h] tiles box: unfolded — beside / below; a phone in landscape — beside; a phone
     * in portrait — below / above (its split is always stacked); then "Board only" / "Screen only".
     * Empty while nothing is shared.
     */
    fun menu(l: CallLayout.Layout, available: CallLayout.Availability, w: Double, h: Double, pressed: TileId? = null): List<Item> {
        val content = contentOf(l, available, pressed) ?: return emptyList()
        val what = if (content == TileId.MATERIAL) "the material" else "the screen"
        val board = boardOf(l, pressed)
        val name = if (board == TileId.DRAW) "the drawing" else "the board"
        val only = if (board == TileId.DRAW) "Drawing only" else "Board only"
        val narrow = w < CallLayout.NARROW_WIDTH
        val splits = when {
            !narrow -> listOf(Choice.BESIDE, Choice.BELOW)
            w > h -> listOf(Choice.BESIDE)
            else -> listOf(Choice.BELOW, Choice.ABOVE)
        }
        val now = current(l, w, h, content)
        return splits.map { c ->
            val label = when (c) {
                Choice.BESIDE -> "Show $name beside $what"
                Choice.BELOW -> "Show $name below $what"
                else -> "Show $name above $what"
            }
            Item(c, label, now == c && boardOf(l) == board)
        } + listOf(
            Item(Choice.BOARD_ONLY, only, now == Choice.BOARD_ONLY && l.main == board),
            Item(Choice.SCREEN_ONLY, if (content == TileId.MATERIAL) "Material only" else "Screen only", now == Choice.SCREEN_ONLY),
        )
    }

    /**
     * The layout actions for a choice — the web's `drop` actions: a split drops the board on the right /
     * bottom / top half beside the shared screen (the screen first put on the stage when it isn't in a
     * screen + board split already, so a divider in the same direction is kept); "only" = the whole stage.
     */
    fun actions(l: CallLayout.Layout, choice: Choice, board: TileId, content: TileId = TileId.SCREEN): List<Action> {
        val zone = when (choice) {
            Choice.BESIDE -> DropZone.RIGHT
            Choice.BELOW -> DropZone.BOTTOM
            Choice.ABOVE -> DropZone.TOP
            Choice.BOARD_ONLY -> return listOf(Action.Drop(board, DropZone.FULL))
            Choice.SCREEN_ONLY -> return listOf(Action.Drop(content, DropZone.FULL))
        }
        val splitWithThisBoard = isSplit(l) && (l.main == board || l.second == board) && (l.main == content || l.second == content)
        return if (splitWithThisBoard) listOf(Action.Drop(board, zone))
        else listOf(Action.Drop(content, DropZone.FULL), Action.Drop(board, zone))
    }

    /** The "📝 + 🖥️" chip: split → the screen alone; otherwise the split this box shows best (stacked on a phone in portrait). */
    fun toggle(l: CallLayout.Layout, w: Double, h: Double): Choice = when {
        isSplit(l) -> Choice.SCREEN_ONLY
        w < CallLayout.NARROW_WIDTH && w <= h -> Choice.BELOW
        else -> Choice.BESIDE
    }
}
