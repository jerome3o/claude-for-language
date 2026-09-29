package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/reader/blockPlayback.ts — the reader scrubber's restart point moving with
 * the audio block by block (parity-tested against the TypeScript):
 * - play starts from the anchor; when playback enters a block that starts after the anchor,
 *   the anchor advances to that block's start (a hand-placed anchor wins until then);
 * - pause keeps the anchor at the start of the block that was playing — except within the
 *   first [GRACE_MS] of a block playback just crossed into: then the previous block (or the
 *   hand-placed point in it);
 * - ended = pause at the end without the grace; place = a free anchor (drag); jump = a
 *   block's start (tap); step = ⏭ next block / ⏮ start of this block when past its first
 *   second (or a hand-placed mid-block anchor while stopped), else the previous block.
 */
object BlockPlayback {
    const val GRACE_MS = 1000.0

    data class State(
        val anchorMs: Double = 0.0,
        val manual: Boolean = false,
        val playing: Boolean = false,
        val crossedFromMs: Double? = null,
    )

    sealed interface Event {
        data object Play : Event
        data class Tick(val posMs: Double) : Event
        data class Pause(val posMs: Double) : Event
        data object Ended : Event
        data class Place(val ms: Double) : Event
        data class Jump(val index: Int) : Event
        data class Step(val dir: Int, val posMs: Double) : Event
    }

    data class Result(val state: State, val seekToMs: Double?)

    private fun startOf(blocks: List<AudioBlocks.Block>, index: Int): Double =
        if (blocks.isEmpty()) 0.0 else blocks[index.coerceIn(0, blocks.size - 1)].startMs.toDouble()

    private fun endOf(blocks: List<AudioBlocks.Block>): Double = if (blocks.isEmpty()) 0.0 else blocks.last().endMs.toDouble()

    private fun advance(s: State, blocks: List<AudioBlocks.Block>, posMs: Double): State {
        if (!s.playing || blocks.isEmpty()) return s
        val start = startOf(blocks, AudioBlocks.indexAt(blocks, posMs))
        if (start <= s.anchorMs) return s
        return s.copy(anchorMs = start, manual = false, crossedFromMs = s.anchorMs)
    }

    private fun settle(s: State, anchorMs: Double, manual: Boolean) = State(anchorMs, manual, s.playing, null)

    /** `blockPlayback`. */
    fun reduce(state: State, event: Event, blocks: List<AudioBlocks.Block>, graceMs: Double = GRACE_MS): Result = when (event) {
        Event.Play -> Result(state.copy(playing = true, crossedFromMs = null), state.anchorMs)
        is Event.Tick -> Result(advance(state, blocks, event.posMs), null)
        is Event.Pause -> {
            val s = advance(state, blocks, event.posMs)
            val idx = AudioBlocks.indexAt(blocks, event.posMs)
            val start = startOf(blocks, idx)
            var anchor = s.anchorMs
            var manual = s.manual
            val crossed = s.crossedFromMs
            if (crossed != null && idx > 0 && s.anchorMs == start && event.posMs - start < graceMs) {
                val prev = startOf(blocks, idx - 1)
                anchor = Math.max(crossed, prev)
                manual = anchor != prev
            }
            Result(State(anchor, manual, false, null), null)
        }
        Event.Ended -> {
            val s = advance(state, blocks, Math.max(0.0, endOf(blocks) - 1))
            Result(State(s.anchorMs, s.manual, false, null), null)
        }
        is Event.Place -> {
            val ms = Math.max(0.0, Math.min(endOf(blocks), Js.round(event.ms)))
            Result(settle(state, ms, true), if (state.playing) ms else null)
        }
        is Event.Jump -> {
            val ms = startOf(blocks, event.index)
            Result(settle(state, ms, false), if (state.playing) ms else null)
        }
        is Event.Step -> {
            val ref = if (state.playing) event.posMs else state.anchorMs
            val idx = AudioBlocks.indexAt(blocks, ref)
            val into = ref - startOf(blocks, idx)
            val target = if (event.dir > 0) idx + 1 else if (into > (if (state.playing) graceMs else 0.0)) idx else idx - 1
            val ms = startOf(blocks, target)
            Result(settle(state, ms, false), if (state.playing) ms else null)
        }
    }

    /** `activeBlockIndex`: the block to highlight — the one playing, else the anchor's. */
    fun activeIndex(state: State, blocks: List<AudioBlocks.Block>, posMs: Double): Int =
        if (blocks.isEmpty()) -1 else AudioBlocks.indexAt(blocks, if (state.playing) posMs else state.anchorMs)
}
