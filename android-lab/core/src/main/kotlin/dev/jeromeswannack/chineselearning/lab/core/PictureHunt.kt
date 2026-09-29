package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.Normalizer

/*
 * Picture hunt (看图找词) — ports of shared/picture-hunt/{types,match,geometry}.ts.
 * A picture with the nameable objects in it found and named in Chinese; the learner types
 * what they see and each right answer lights up that object's outline. Geometry is
 * normalised to the image (0..1 from the top-left). Parity-tested against the TypeScript
 * (parity/fixtures/picture-hunt.ts → PictureHuntParityTest).
 */

/** PICTURE_HUNT_DEFAULT_SECONDS — the soft timer; when it runs out the hunt goes to reveal mode. */
const val PICTURE_HUNT_DEFAULT_SECONDS = 300

/** HuntBox: normalised image coordinates (0..1). */
@Serializable
data class HuntBox(val x: Double = 0.0, val y: Double = 0.0, val w: Double = 0.0, val h: Double = 0.0)

/** HuntRegion: a box and, when segmentation worked, the closed outline as [x, y] pairs. */
@Serializable
data class HuntRegion(val box: HuntBox = HuntBox(), val polygon: List<List<Double>>? = null)

/** HuntObject — one named thing in the picture (every place it appears = one region). */
@Serializable
data class HuntObject(
    val id: String,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val alternatives: List<String> = emptyList(),
    val difficulty: String? = null,
    @SerialName("fun_facts") val funFacts: String? = null,
    @SerialName("sentence_clue") val sentenceClue: String? = null,
    @SerialName("sentence_clue_pinyin") val sentenceCluePinyin: String? = null,
    @SerialName("sentence_clue_translation") val sentenceClueTranslation: String? = null,
    val regions: List<HuntRegion> = emptyList(),
)

/** HuntMatch — the verdict for one typed answer. */
sealed class HuntMatch {
    data class Found(val objectId: String, val via: String, val typed: String) : HuntMatch()
    data class Already(val objectId: String) : HuntMatch()
    data class Close(val objectId: String, val reason: String, val shared: String) : HuntMatch()
    data object Empty : HuntMatch()
    data object None : HuntMatch()

    companion object {
        const val VIA_HANZI = "hanzi"
        const val VIA_ALTERNATIVE = "alternative"
        const val VIA_PINYIN = "pinyin"
        const val SHARES_CHARACTER = "shares_character"
        const val MISSING_TONES = "missing_tones"
    }
}

data class PinyinKey(val letters: String, val tones: String, val hasTones: Boolean)

/** Port of shared/picture-hunt/match.ts. */
object PictureHuntMatch {
    private const val TRAD_TO_SIMP_PAIRS =
        "書书車车門门燈灯電电腦脑視视鐘钟錶表鍋锅盤盘雞鸡魚鱼鳥鸟馬马貓猫紙纸筆笔簾帘櫃柜麵面飯饭蘋苹葉叶樹树園园褲裤襪袜" +
        "錢钱機机們们個个張张隻只條条塊块雙双盞盏臺台輛辆頭头蘿萝蔔卜餅饼湯汤麥麦醬酱鹽盐壺壶爐炉燒烧籃篮鏡镜畫画牆墙樓楼" +
        "開开關关風风傘伞鑰钥鎖锁橋桥鐵铁飛飞雲云陽阳氣气報报話话線线網网鍵键聽听讀读寫写說说見见買买賣卖東东蝦虾貝贝蠟蜡" +
        "燭烛蓋盖廳厅廚厨臥卧廁厕龍龙輪轮號号碼码標标誌志貨货攤摊餃饺醫医藥药櫻樱檸柠鳳凤紅红綠绿藍蓝黃黄顏颜豬猪鴨鸭鵝鹅" +
        "蟲虫籠笼裡里邊边對对備备環环從从會会學学習习題题問问時时間间館馆場场廣广華华國国語语漢汉樣样還还這这過过進进運运" +
        "動动腳脚臉脸髮发衛卫牀床櫥橱屜屉鬧闹鈴铃罐罐壓压厭厌鍾钟銀银鋼钢釘钉針针錄录鞦秋韆千擺摆飾饰牌牌傢家俱具櫥橱窗窗" +
        "廈厦總总統统車车軌轨鐘钟錫锡鉛铅勺勺鑽钻劍剑盃杯碗碗罈坛蓮莲葡葡萄萄瓜瓜橘橘蕉蕉莓莓菇菇蘑蘑薑姜蔥葱蒜蒜筍笋菜菜肉肉"

    private val TRAD_TO_SIMP: Map<Int, Int> = run {
        val map = HashMap<Int, Int>()
        val chars = codePoints(TRAD_TO_SIMP_PAIRS)
        var i = 0
        while (i + 1 < chars.size) {
            if (chars[i] != chars[i + 1]) map[chars[i]] = chars[i + 1]
            i += 2
        }
        map
    }

    /** Characters too common to count as a near miss on their own (桌子 vs 椅子 share 子). */
    private val STOP_CHARS: Set<Int> = codePoints("子儿头的个一了小大上下里面边").toSet()

    private val LEADING_MEASURE = Regex(
        "^(?:[一二两三四五六七八九十几这那每0-9]+)(?:个|只|张|把|条|本|件|台|辆|双|块|杯|瓶|盏|棵|朵|支|根|顶|头|匹|座|间|扇|面|盘|碗|袋|包|盒|副|枝|片|颗|粒|套|架|盆|幅|位|群|堆|串)",
    )

    private val TONE_MARKED: Map<Int, Pair<Char, Int>> = mapOf(
        'ā' to ('a' to 1), 'á' to ('a' to 2), 'ǎ' to ('a' to 3), 'à' to ('a' to 4),
        'ē' to ('e' to 1), 'é' to ('e' to 2), 'ě' to ('e' to 3), 'è' to ('e' to 4),
        'ī' to ('i' to 1), 'í' to ('i' to 2), 'ǐ' to ('i' to 3), 'ì' to ('i' to 4),
        'ō' to ('o' to 1), 'ó' to ('o' to 2), 'ǒ' to ('o' to 3), 'ò' to ('o' to 4),
        'ū' to ('u' to 1), 'ú' to ('u' to 2), 'ǔ' to ('u' to 3), 'ù' to ('u' to 4),
        'ǖ' to ('v' to 1), 'ǘ' to ('v' to 2), 'ǚ' to ('v' to 3), 'ǜ' to ('v' to 4),
    ).mapKeys { it.key.code }

    /** `Array.from(s)` — code points. */
    internal fun codePoints(s: String): List<Int> = s.codePoints().toArray().toList()

    private fun str(cp: Int): String = String(Character.toChars(cp))

    /** JS `/[㐀-鿿豈-﫿]/` on one code point (BMP only, like the non-`u` regex). */
    private fun isHan(cp: Int): Boolean = cp in 0x3400..0x9FFF || cp in 0xF900..0xFAFF

    /** hasHanzi — does the text contain a CJK character? */
    fun hasHanzi(text: String): Boolean {
        // Without the `u` flag JS tests UTF-16 code units; a surrogate is never in the BMP ranges.
        for (c in text) if (isHan(c.code)) return true
        return false
    }

    /** JS `\s` (WhiteSpace + LineTerminator), as the `u`-flag regex sees it. */
    private fun isJsSpace(cp: Int): Boolean = cp == 0x09 || cp == 0x0A || cp == 0x0B || cp == 0x0C || cp == 0x0D || cp == 0x20 ||
        cp == 0xA0 || cp == 0x1680 || cp in 0x2000..0x200A || cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F ||
        cp == 0x3000 || cp == 0xFEFF

    /** `\p{P}` / `\p{S}` — Unicode general categories. */
    private fun isPunctOrSymbol(cp: Int): Boolean = when (Character.getType(cp).toByte()) {
        Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION, Character.END_PUNCTUATION,
        Character.INITIAL_QUOTE_PUNCTUATION, Character.FINAL_QUOTE_PUNCTUATION, Character.OTHER_PUNCTUATION,
        Character.MATH_SYMBOL, Character.CURRENCY_SYMBOL, Character.MODIFIER_SYMBOL, Character.OTHER_SYMBOL,
        -> true
        else -> false
    }

    /** stripAnswer — NFKC, lower case, no whitespace or punctuation / symbols. */
    fun stripAnswer(text: String): String {
        val s = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase()
        val out = StringBuilder()
        s.codePoints().forEach { cp -> if (!isJsSpace(cp) && !isPunctOrSymbol(cp)) out.appendCodePoint(cp) }
        return out.toString()
    }

    /** toSimplified — traditional → simplified for the characters in the table; everything else unchanged. */
    fun toSimplified(text: String): String {
        val out = StringBuilder()
        text.codePoints().forEach { cp -> out.appendCodePoint(TRAD_TO_SIMP[cp] ?: cp) }
        return out.toString()
    }

    /** normalizeHanziAnswer — the comparable form of a typed or stored hanzi answer. */
    fun normalizeHanziAnswer(text: String): String {
        val s = toSimplified(stripAnswer(text))
        val stripped = LEADING_MEASURE.replaceFirst(s, "")
        return stripped.ifEmpty { s }
    }

    /** pinyinKey — "chá bēi" and "cha2bei1" both → letters "chabei", tones "21". */
    fun pinyinKey(text: String): PinyinKey {
        val s = Normalizer.normalize(text, Normalizer.Form.NFC).lowercase()
        val letters = StringBuilder()
        val tones = StringBuilder()
        var hasTones = false
        s.codePoints().forEach { cp ->
            val marked = TONE_MARKED[cp]
            when {
                marked != null -> { letters.append(marked.first); tones.append(marked.second); hasTones = true }
                cp in '1'.code..'4'.code -> { tones.appendCodePoint(cp); hasTones = true }
                cp == '5'.code || cp == '0'.code -> hasTones = true
                cp == 'ü'.code -> letters.append('v')
                cp in 'a'.code..'z'.code -> letters.appendCodePoint(cp)
            }
        }
        return PinyinKey(letters.toString(), tones.toString(), hasTones)
    }

    private data class Form(val form: String, val via: String)

    private fun formsOf(obj: HuntObject): List<Form> {
        val out = ArrayList<Form>()
        val primary = normalizeHanziAnswer(obj.hanzi)
        if (primary.isNotEmpty()) out += Form(primary, HuntMatch.VIA_HANZI)
        for (alt in obj.alternatives) {
            val form = normalizeHanziAnswer(alt)
            if (form.isNotEmpty() && out.none { it.form == form }) out += Form(form, HuntMatch.VIA_ALTERNATIVE)
        }
        return out
    }

    /**
     * matchHuntAnswer — which object does this answer name? Unfound objects win over found
     * ones, and within those the primary hanzi wins over an alternative, in object order.
     */
    fun match(input: String, objects: List<HuntObject>, foundIds: Collection<String>): HuntMatch {
        val found = foundIds.toSet()
        val typed = NoteSearch.jsTrim(input)
        if (stripAnswer(typed).isEmpty()) return HuntMatch.Empty

        val ordered = objects.filter { it.id !in found } + objects.filter { it.id in found }

        if (hasHanzi(typed)) {
            val answer = normalizeHanziAnswer(typed)
            for (via in listOf(HuntMatch.VIA_HANZI, HuntMatch.VIA_ALTERNATIVE)) {
                for (obj in ordered) {
                    if (formsOf(obj).any { it.via == via && it.form == answer }) {
                        return if (obj.id in found) HuntMatch.Already(obj.id) else HuntMatch.Found(obj.id, via, typed)
                    }
                }
            }
            // Near miss: shares a meaningful character with something not found yet.
            val typedChars = codePoints(answer).filter { isHan(it) && it !in STOP_CHARS }.toSet()
            var best: Pair<HuntObject, String>? = null
            for (obj in objects) {
                if (obj.id in found) continue
                for (f in formsOf(obj)) {
                    val shared = codePoints(f.form).filter { it in typedChars }.distinct().joinToString("") { str(it) }
                    if (shared.isNotEmpty() && (best == null || shared.length > best.second.length)) best = obj to shared
                }
            }
            best?.let { return HuntMatch.Close(it.first.id, HuntMatch.SHARES_CHARACTER, it.second) }
            return HuntMatch.None
        }

        val key = pinyinKey(typed)
        if (key.letters.isEmpty()) return HuntMatch.None
        for (obj in ordered) {
            val target = pinyinKey(obj.pinyin)
            if (target.letters != key.letters) continue
            if (!key.hasTones) {
                if (obj.id in found) return HuntMatch.Already(obj.id)
                return HuntMatch.Close(obj.id, HuntMatch.MISSING_TONES, "")
            }
            if (target.tones == key.tones) {
                return if (obj.id in found) HuntMatch.Already(obj.id) else HuntMatch.Found(obj.id, HuntMatch.VIA_PINYIN, typed)
            }
        }
        return HuntMatch.None
    }

    /** objectArea — total area of an object's boxes (normalised). */
    fun objectArea(obj: HuntObject): Double {
        var sum = 0.0
        for (r in obj.regions) sum += Math.max(0.0, r.box.w) * Math.max(0.0, r.box.h)
        return sum
    }

    /**
     * pickHintTarget — among the objects not found, the one hinted least so far, then the
     * biggest (easiest to spot), then object order. null when everything is found.
     */
    fun pickHintTarget(objects: List<HuntObject>, foundIds: Collection<String>, hintsGiven: Map<String, Int>): HuntObject? {
        val found = foundIds.toSet()
        var best: HuntObject? = null
        for (obj in objects) {
            if (obj.id in found) continue
            val b = best
            if (b == null) { best = obj; continue }
            val ha = hintsGiven[obj.id] ?: 0
            val hb = hintsGiven[b.id] ?: 0
            if (ha < hb || (ha == hb && objectArea(obj) > objectArea(b) + 1e-9)) best = obj
        }
        return best
    }

    /** hintText — level 1 "茶＿", level 2 + pinyin, level 3+ + English. */
    fun hintText(obj: HuntObject, level: Int): String {
        val chars = codePoints(obj.hanzi)
        val first = (chars.firstOrNull()?.let { str(it) } ?: "undefined") + "＿".repeat(Math.max(0, chars.size - 1))
        if (level <= 1) return first
        if (level == 2) return "$first · ${obj.pinyin}"
        return "$first · ${obj.pinyin} · ${obj.english}"
    }
}

data class LabelAnchor(val x: Double, val y: Double, val above: Boolean)

/** Port of shared/picture-hunt/geometry.ts — hit-testing and label placement. */
object PictureHuntGeometry {
    /** pointInPolygon — ray casting. */
    fun pointInPolygon(x: Double, y: Double, polygon: List<List<Double>>): Boolean {
        var inside = false
        var j = polygon.size - 1
        for (i in polygon.indices) {
            val xi = polygon[i][0]
            val yi = polygon[i][1]
            val xj = polygon[j][0]
            val yj = polygon[j][1]
            if ((yi > y) != (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
            j = i
        }
        return inside
    }

    fun regionContains(region: HuntRegion, x: Double, y: Double): Boolean {
        val box = region.box
        if (x < box.x || y < box.y || x > box.x + box.w || y > box.y + box.h) return false
        val poly = region.polygon
        return if (poly != null && poly.size >= 3) pointInPolygon(x, y, poly) else true
    }

    /**
     * objectAt — the smallest region containing the point wins (a cup on a table is the cup);
     * within [slop] of a box edge counts when no region contains the point exactly.
     */
    fun objectAt(objects: List<HuntObject>, x: Double, y: Double, slop: Double = 0.02): HuntObject? {
        var best: HuntObject? = null
        var bestArea = 0.0
        for (obj in objects) {
            for (region in obj.regions) {
                if (!regionContains(region, x, y)) continue
                val area = region.box.w * region.box.h
                if (best == null || area < bestArea) { best = obj; bestArea = area }
            }
        }
        if (best != null) return best
        var near: HuntObject? = null
        var nearD = 0.0
        for (obj in objects) {
            for (region in obj.regions) {
                val box = region.box
                val dx = jsMax3(box.x - x, 0.0, x - (box.x + box.w))
                val dy = jsMax3(box.y - y, 0.0, y - (box.y + box.h))
                val d = StrokeGeometry.hypot(dx, dy)
                if (d <= slop && (near == null || d < nearD)) { near = obj; nearD = d }
            }
        }
        return near
    }

    /** JS Math.max over three finite numbers (0 and -0: +0 wins, like V8). */
    private fun jsMax3(a: Double, b: Double, c: Double): Double = Math.max(Math.max(a, b), c)

    /** labelAnchor — top-centre of the box, kept inside the picture. */
    fun labelAnchor(region: HuntRegion): LabelAnchor {
        val box = region.box
        val x = Math.min(0.95, Math.max(0.05, box.x + box.w / 2))
        val above = box.y > 0.06
        return LabelAnchor(x, if (above) box.y else Math.min(0.97, box.y + box.h), above)
    }
}

/** HuntFeedback — the line under the answer box; tone is found / close / miss / info. */
data class HuntFeedback(val tone: String, val text: String)

/** Port of shared/picture-hunt/feedback.ts (a near miss never gives the answer away). */
object PictureHuntFeedback {
    fun of(match: HuntMatch, objects: List<HuntObject>): HuntFeedback? {
        val objectId = when (match) {
            is HuntMatch.Found -> match.objectId
            is HuntMatch.Already -> match.objectId
            is HuntMatch.Close -> match.objectId
            else -> null
        }
        val obj = objectId?.let { id -> objects.firstOrNull { it.id == id } }
        return when (match) {
            HuntMatch.Empty -> null
            is HuntMatch.Found -> when {
                obj == null -> null
                match.via == HuntMatch.VIA_ALTERNATIVE -> HuntFeedback("found", "✓ ${obj.hanzi} (also ${NoteSearch.jsTrim(match.typed)}) · ${obj.pinyin} · ${obj.english}")
                match.via == HuntMatch.VIA_PINYIN -> HuntFeedback("found", "✓ ${obj.hanzi} · ${obj.pinyin} · ${obj.english} — try typing the characters next time")
                else -> HuntFeedback("found", "✓ ${obj.hanzi} · ${obj.pinyin} · ${obj.english}")
            }
            is HuntMatch.Already -> HuntFeedback("info", "Already found ${obj?.hanzi ?: "that one"}")
            is HuntMatch.Close -> if (match.reason == HuntMatch.MISSING_TONES) HuntFeedback("close", "Right sound — add the tones, or type the characters")
            else HuntFeedback("close", "So close — something here has ${match.shared} in its name")
            HuntMatch.None -> HuntFeedback("miss", "Not one of the things I found — try another")
        }
    }
}
