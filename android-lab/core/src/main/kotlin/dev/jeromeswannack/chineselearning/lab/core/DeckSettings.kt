package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/decks/defaults.ts: what a new deck gets and how deck settings are
 * validated (`pickDeckSettings`, parity-tested). The Lab app validates a settings form
 * with it before the PUT, so the same problems show without a round trip (offline too).
 */
object DeckSettings {
    /** `DEFAULT_DECK_SETTINGS` (numbers as the TS writes them). */
    val DEFAULTS: Map<String, Any> = linkedMapOf(
        "new_cards_per_day" to 3,
        "secondary_cards_per_day" to 6,
        "request_retention" to 0.9,
        "maximum_interval" to 36500,
        "learning_steps" to "1 10",
        "graduating_interval" to 1,
        "easy_interval" to 4,
        "relearning_steps" to "10",
        "starting_ease" to 250,
        "minimum_ease" to 130,
        "maximum_ease" to 300,
        "interval_modifier" to 100,
        "hard_multiplier" to 120,
        "easy_bonus" to 130,
    )
    val KEYS: List<String> = DEFAULTS.keys.toList()
    val DEFAULT_NEW_PER_DAY = 3
    val DEFAULT_SECONDARY_PER_DAY = 6

    private val RANGES: Map<String, Pair<Double, Double>> = mapOf(
        "new_cards_per_day" to (0.0 to 1000.0),
        "secondary_cards_per_day" to (0.0 to 1000.0),
        "request_retention" to (0.7 to 0.97),
        "maximum_interval" to (1.0 to 36500.0),
        "graduating_interval" to (1.0 to 365.0),
        "easy_interval" to (1.0 to 365.0),
        "starting_ease" to (130.0 to 500.0),
        "minimum_ease" to (100.0 to 300.0),
        "maximum_ease" to (130.0 to 500.0),
        "interval_modifier" to (10.0 to 500.0),
        "hard_multiplier" to (100.0 to 200.0),
        "easy_bonus" to (100.0 to 300.0),
    )
    private val STEPS = Regex("^[0-9]+(\\.[0-9]+)?([ \\t\\n\\r\\f\\u000B\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+[0-9]+(\\.[0-9]+)?)*$")

    data class Problem(val field: String, val message: String)

    /** Settings values: Double for numbers (request_retention keeps its fraction), String for steps. */
    data class Picked(val settings: Map<String, Any>, val problems: List<Problem>)

    /**
     * `pickDeckSettings(input)`. Values may be Number, String, Boolean or null (a form or
     * decoded JSON); unknown keys are ignored, null skipped, invalid ones reported.
     */
    fun pick(input: Map<String, Any?>?): Picked {
        val settings = LinkedHashMap<String, Any>()
        val problems = ArrayList<Problem>()
        if (input == null) return Picked(settings, problems)
        for (key in KEYS) {
            if (!input.containsKey(key)) continue
            val value = input[key] ?: continue
            if (key == "learning_steps" || key == "relearning_steps") {
                val text = if (value is String) NoteSearch.jsTrim(value) else ""
                if (!STEPS.matches(text)) problems += Problem(key, "$key must be space-separated minutes, e.g. \"1 10\"")
                else settings[key] = text
                continue
            }
            val n = when (value) {
                is Number -> value.toDouble()
                is String -> if (NoteSearch.jsTrim(value).isNotEmpty()) jsNumber(value) else Double.NaN
                else -> Double.NaN
            }
            val (min, max) = RANGES.getValue(key)
            if (!n.isFinite() || n < min || n > max) {
                problems += Problem(key, "$key must be a number between ${Js.numberToString(min)} and ${Js.numberToString(max)}")
                continue
            }
            settings[key] = if (key == "request_retention") n else Js.round(n)
        }
        return Picked(settings, problems)
    }

    /** JS `Number(string)`: trims, then decimal (with exponent / Infinity) or 0x / 0o / 0b integers; else NaN. */
    fun jsNumber(raw: String): Double {
        val s = NoteSearch.jsTrim(raw)
        if (s.isEmpty()) return 0.0
        val radix = when {
            s.startsWith("0x") || s.startsWith("0X") -> 16
            s.startsWith("0o") || s.startsWith("0O") -> 8
            s.startsWith("0b") || s.startsWith("0B") -> 2
            else -> 0
        }
        if (radix != 0) {
            val digits = s.substring(2)
            if (digits.isEmpty() || !digits.all { Character.digit(it, radix) >= 0 }) return Double.NaN
            return java.math.BigInteger(digits, radix).toDouble()
        }
        val body = s.removePrefix("+").removePrefix("-")
        val sign = if (s.startsWith("-")) -1.0 else 1.0
        if (body == "Infinity") return sign * Double.POSITIVE_INFINITY
        if (!DECIMAL.matches(s)) return Double.NaN
        return s.toDouble()
    }

    private val DECIMAL = Regex("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$")
}
