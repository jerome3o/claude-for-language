package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallGloss
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTextDoc
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.glossBoardText
import kotlinx.coroutines.CancellationException

/**
 * The text board's tab-complete lookup (web: services/calls/boardGloss.ts fetchBoardGloss): null when
 * the server can't help — no key (503), Claude down (502 / 503), asked too often (429) — after which
 * it stays quiet for a minute; offline / any other failure is null too. The reply is flattened to one
 * line again here, whatever arrives. The direction follows the segment (CallGloss.directionOf): a
 * Chinese run → pinyin + meaning, an English run → the Chinese + its pinyin.
 */
object BoardGlossFetcher {
    @Volatile private var quietUntil = 0L

    suspend fun fetch(api: Api, callId: String, segment: String, now: () -> Long = System::currentTimeMillis): BoardGloss? {
        if (now() < quietUntil) return null
        return try {
            val direction = CallGloss.directionOf(segment)
            val r = api.glossBoardText(callId, CallGloss.cacheKey(segment), direction)
            val pinyin = CallGloss.oneLine(r.pinyin)
            if (direction == CallGloss.EN) {
                val chinese = CallGloss.oneLine(r.chinese).replace(" ", "")
                if (pinyin.isEmpty() || CallTextDoc.splitChars(chinese).none { CallGloss.isHan(it) }) null else BoardGloss(pinyin, "", chinese)
            } else {
                val english = CallGloss.oneLine(r.english)
                if (pinyin.isEmpty() || english.isEmpty()) null else BoardGloss(pinyin, english)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            if (e.code == 503 || e.code == 502 || e.code == 429) quietUntil = now() + 60_000
            null
        } catch (e: Exception) {
            null
        }
    }
}
