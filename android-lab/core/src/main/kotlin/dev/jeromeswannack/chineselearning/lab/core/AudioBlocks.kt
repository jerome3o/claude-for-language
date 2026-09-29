package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/reader/audioBlocks.ts: reader narration split into phrase-sized blocks
 * at the pauses (an adaptive quiet threshold from the clip's own 10 ms RMS envelope,
 * interior quiet runs of ≥ 350 ms, a 150 ms lead-in before the next phrase, blocks
 * under 0.8 s merged into the shorter neighbour, blocks over 7 s split at their longest
 * ≥ 150 ms dip). Parity-tested against the TypeScript (parity/fixtures/reader-blocks.ts).
 * No pause / silent / undecodable → one block, the old single-anchor behaviour.
 */
object AudioBlocks {
    data class Block(val startMs: Int, val endMs: Int)

    data class Options(
        val frameMs: Int = 10,
        val minSilenceMs: Int = 350,
        val bridgeFrames: Int = 2,
        val minBlockMs: Int = 800,
        val maxBlockMs: Int = 7000,
        val splitSilenceMs: Int = 150,
        val leadMs: Int = 150,
        val thresholdMix: Double = 0.1,
    )

    /** `AUDIO_BLOCKS_VERSION`: bump with the TS when the segmentation changes (cached boundaries recompute). */
    const val VERSION = 1

    private const val MAX_BELOW_SPEECH = 0.1778279410038923
    private const val MIN_BELOW_SPEECH = 0.005623413251903491

    /** `rmsEnvelope`: RMS of each frame of mono PCM (−1..1), the last frame partial. */
    fun rmsEnvelope(samples: FloatArray, count: Int, sampleRate: Int, frameMs: Int = 10): DoubleArray {
        if (sampleRate <= 0 || count <= 0) return DoubleArray(0)
        val frame = Math.max(1.0, Js.round(sampleRate.toDouble() * frameMs / 1000)).toInt()
        val out = DoubleArray((count + frame - 1) / frame)
        var f = 0
        var start = 0
        while (start < count) {
            val end = Math.min(count, start + frame)
            var sum = 0.0
            for (i in start until end) {
                val v = samples[i].toDouble()
                sum += v * v
            }
            out[f++] = Math.sqrt(sum / (end - start))
            start += frame
        }
        return out
    }

    /** `clipDurationMs`. */
    fun clipDurationMs(sampleCount: Long, sampleRate: Int): Int =
        if (sampleRate <= 0) 0 else Js.round(sampleCount.toDouble() * 1000 / sampleRate).toInt()

    private fun quantile(sorted: DoubleArray, q: Double): Double = sorted[Math.floor(q * (sorted.size - 1)).toInt()]

    /** `silenceThreshold`. */
    fun silenceThreshold(envelope: DoubleArray, o: Options = Options()): Double {
        if (envelope.isEmpty()) return 0.0
        val sorted = envelope.copyOf().also { it.sort() }
        val floor = quantile(sorted, 0.1)
        val speech = quantile(sorted, 0.9)
        if (!(speech > 0)) return 0.0
        var thr = floor + o.thresholdMix * (speech - floor)
        thr = Math.min(thr, speech * MAX_BELOW_SPEECH)
        thr = Math.max(thr, speech * MIN_BELOW_SPEECH)
        return thr
    }

    data class QuietRun(val start: Int, val end: Int)

    /** `quietRuns`: frames below the threshold, joined across ≤ bridgeFrames loud frames. */
    fun quietRuns(envelope: DoubleArray, threshold: Double, bridgeFrames: Int): List<QuietRun> {
        val merged = ArrayList<QuietRun>()
        var i = 0
        while (i < envelope.size) {
            if (envelope[i] < threshold) {
                val start = i
                while (i < envelope.size && envelope[i] < threshold) i++
                val last = merged.lastOrNull()
                if (last != null && start - last.end <= bridgeFrames) merged[merged.size - 1] = QuietRun(last.start, i)
                else merged += QuietRun(start, i)
            } else {
                i++
            }
        }
        return merged
    }

    private fun boundaryFor(run: QuietRun, o: Options): Int {
        val startMs = run.start * o.frameMs
        val endMs = run.end * o.frameMs
        return Math.max(Math.floorDiv(startMs + endMs, 2), endMs - o.leadMs)
    }

    private fun mergeShort(blocks: List<Block>, minBlockMs: Int): List<Block> {
        val out = blocks.toMutableList()
        while (out.size > 1) {
            var shortest = -1
            for (i in out.indices) {
                val len = out[i].endMs - out[i].startMs
                if (len < minBlockMs && (shortest < 0 || len < out[shortest].endMs - out[shortest].startMs)) shortest = i
            }
            if (shortest < 0) break
            val into = when (shortest) {
                0 -> 1
                out.size - 1 -> shortest - 1
                else -> {
                    val prev = out[shortest - 1].endMs - out[shortest - 1].startMs
                    val next = out[shortest + 1].endMs - out[shortest + 1].startMs
                    if (next < prev) shortest + 1 else shortest - 1
                }
            }
            val a = Math.min(shortest, into)
            val joined = Block(out[a].startMs, out[a + 1].endMs)
            out.removeAt(a + 1)
            out[a] = joined
        }
        return out
    }

    private fun splitLong(block: Block, runs: List<QuietRun>, o: Options, out: MutableList<Block>) {
        if (block.endMs - block.startMs <= o.maxBlockMs) { out += block; return }
        val mid = (block.startMs + block.endMs) / 2.0
        var bestB = 0
        var bestLen = -1
        var bestDist = 0.0
        for (run in runs) {
            val len = (run.end - run.start) * o.frameMs
            if (len < o.splitSilenceMs) continue
            if (run.start * o.frameMs <= block.startMs || run.end * o.frameMs >= block.endMs) continue
            val b = boundaryFor(run, o)
            if (b - block.startMs < o.minBlockMs || block.endMs - b < o.minBlockMs) continue
            val dist = Math.abs(b - mid)
            if (bestLen < 0 || len > bestLen || (len == bestLen && dist < bestDist)) { bestB = b; bestLen = len; bestDist = dist }
        }
        if (bestLen < 0) { out += block; return }
        splitLong(Block(block.startMs, bestB), runs, o, out)
        splitLong(Block(bestB, block.endMs), runs, o, out)
    }

    /** `segmentAudioBlocks`: contiguous blocks covering [0, durationMs]; one block when no pause is found. */
    fun segment(envelope: DoubleArray, durationMs: Double, o: Options = Options()): List<Block> {
        val duration = Math.max(0.0, Js.round(durationMs)).toInt()
        if (duration == 0) return emptyList()
        val whole = listOf(Block(0, duration))
        if (envelope.isEmpty()) return whole
        val thr = silenceThreshold(envelope, o)
        if (!(thr > 0)) return whole

        val runs = quietRuns(envelope, thr, o.bridgeFrames)
        val n = envelope.size
        val boundaries = ArrayList<Int>()
        for (run in runs) {
            if (run.start == 0 || run.end >= n) continue
            if ((run.end - run.start) * o.frameMs < o.minSilenceMs) continue
            val b = boundaryFor(run, o)
            if (b <= 0 || b >= duration) continue
            if (boundaries.isNotEmpty() && b <= boundaries.last()) continue
            boundaries += b
        }
        val starts = listOf(0) + boundaries
        val initial = starts.mapIndexed { i, s -> Block(s, if (i + 1 < starts.size) starts[i + 1] else duration) }
        val merged = mergeShort(initial, o.minBlockMs)
        val interior = runs.filter { it.start > 0 && it.end < n }
        val out = ArrayList<Block>()
        for (block in merged) splitLong(block, interior, o, out)
        return out
    }

    /** `blockIndexAt`: the block containing [ms], clamped to the first / last. */
    fun indexAt(blocks: List<Block>, ms: Double): Int {
        var idx = 0
        for (i in 1 until blocks.size) {
            if (blocks[i].startMs <= ms) idx = i else break
        }
        return idx
    }
}
