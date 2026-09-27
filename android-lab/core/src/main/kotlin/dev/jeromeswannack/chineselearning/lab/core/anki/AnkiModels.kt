package dev.jeromeswannack.chineselearning.lab.core.anki

/**
 * Port of frontend/src/services/anki/models.ts — the two Anki note types both apps export.
 *
 * Field and template NAMES are part of the schema Anki compares on import; they must stay
 * byte-identical to the web's (AnkiParityTest compares the whole model, CSS included), or an
 * export from one app would create a second note type instead of updating the other's notes.
 */
data class AnkiTemplate(val name: String, val qfmt: String, val afmt: String, val requires: List<String>)

data class AnkiModel(
    val key: String,
    val id: Long,
    val name: String,
    val fields: List<String>,
    val templates: List<AnkiTemplate>,
    val css: String,
)

object AnkiModels {
    const val VOCABULARY_KEY = "vocabulary"
    const val SENTENCE_KEY = "sentence"

    private const val ID_NAMESPACE = "chinese-learning-app:model"

    private val SHARED_CSS = """
.card {
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif;
  font-size: 20px;
  line-height: 1.45;
  text-align: center;
  padding: 16px 12px;
}
.hanzi { font-size: 56px; line-height: 1.25; margin: 0.2em 0; }
.pinyin { color: #888; font-size: 22px; margin: 0.15em 0; }
.english { font-size: 22px; margin: 0.15em 0; }
.prompt { font-size: 30px; margin: 0.3em 0; }
.prompt-hint { color: #888; font-size: 16px; margin-top: 0.5em; }
.sentence { margin-top: 1.1em; padding-top: 0.8em; border-top: 1px solid rgba(128,128,128,0.35); }
.sentence .zh { font-size: 26px; line-height: 1.4; }
.sentence .py { color: #888; font-size: 16px; }
.sentence .en { font-size: 17px; margin-top: 0.15em; }
.notes { color: #888; font-size: 15px; text-align: left; margin-top: 1.1em; white-space: pre-wrap; }
.sentence-zh { font-size: 30px; line-height: 1.5; margin: 0.2em 0; }
.sentence-py { color: #888; font-size: 18px; }
.sentence-en { font-size: 20px; margin-top: 0.3em; }
hr#answer { border: none; border-top: 1px solid rgba(128,128,128,0.35); margin: 0.9em 0; }
""".trim()

    private const val SENTENCE_BLOCK = "{{#Sentence}}<div class=\"sentence\"><div class=\"zh\">{{Sentence}}</div>{{#SentencePinyin}}<div class=\"py\">{{SentencePinyin}}</div>{{/SentencePinyin}}{{#SentenceEnglish}}<div class=\"en\">{{SentenceEnglish}}</div>{{/SentenceEnglish}}{{SentenceAudio}}</div>{{/Sentence}}"
    private const val NOTES_BLOCK = "{{#Notes}}<div class=\"notes\">{{Notes}}</div>{{/Notes}}"

    val VOCABULARY = AnkiModel(
        key = VOCABULARY_KEY,
        id = AnkiHash.stableId(ID_NAMESPACE, "汉语学习 Vocabulary"),
        name = "汉语学习 Vocabulary",
        fields = listOf("Hanzi", "Pinyin", "English", "Audio", "Sentence", "SentencePinyin", "SentenceEnglish", "SentenceAudio", "Notes", "SourceId"),
        templates = listOf(
            AnkiTemplate(
                name = "Hanzi → Meaning",
                requires = listOf("Hanzi"),
                qfmt = "<div class=\"hanzi\">{{Hanzi}}</div>",
                afmt = "{{FrontSide}}<hr id=answer><div class=\"pinyin\">{{Pinyin}}</div><div class=\"english\">{{English}}</div>{{Audio}}$SENTENCE_BLOCK$NOTES_BLOCK",
            ),
            AnkiTemplate(
                name = "Meaning → Hanzi",
                requires = listOf("English"),
                qfmt = "<div class=\"english prompt\">{{English}}</div><div class=\"prompt-hint\">Write the characters</div>",
                afmt = "{{FrontSide}}<hr id=answer><div class=\"hanzi\">{{Hanzi}}</div><div class=\"pinyin\">{{Pinyin}}</div>{{Audio}}$SENTENCE_BLOCK$NOTES_BLOCK",
            ),
            AnkiTemplate(
                name = "Audio → Hanzi",
                requires = listOf("Audio"),
                qfmt = "{{#Audio}}<div class=\"prompt\">🔊</div>{{Audio}}<div class=\"prompt-hint\">What did you hear? Write the characters</div>{{/Audio}}",
                afmt = "{{FrontSide}}<hr id=answer><div class=\"hanzi\">{{Hanzi}}</div><div class=\"pinyin\">{{Pinyin}}</div><div class=\"english\">{{English}}</div>$SENTENCE_BLOCK$NOTES_BLOCK",
            ),
        ),
        css = SHARED_CSS,
    )

    val SENTENCE = AnkiModel(
        key = SENTENCE_KEY,
        id = AnkiHash.stableId(ID_NAMESPACE, "汉语学习 Sentence"),
        name = "汉语学习 Sentence",
        fields = listOf("Chinese", "Pinyin", "English", "Audio", "SourceId"),
        templates = listOf(
            AnkiTemplate(
                name = "Chinese → English",
                requires = listOf("Chinese"),
                qfmt = "<div class=\"sentence-zh\">{{Chinese}}</div>{{Audio}}",
                afmt = "{{FrontSide}}<hr id=answer><div class=\"sentence-py\">{{Pinyin}}</div><div class=\"sentence-en\">{{English}}</div>",
            ),
        ),
        css = SHARED_CSS,
    )

    val MODELS: Map<String, AnkiModel> = linkedMapOf(VOCABULARY_KEY to VOCABULARY, SENTENCE_KEY to SENTENCE)

    fun model(key: String): AnkiModel = MODELS[key] ?: error("Unknown Anki model $key")

    /** `CARD_TYPE_ORD`: the Vocabulary template ordinal for each of the app's card types. */
    val CARD_TYPE_ORD: Map<String, Int> = linkedMapOf("hanzi_to_meaning" to 0, "meaning_to_hanzi" to 1, "audio_to_hanzi" to 2)
}
