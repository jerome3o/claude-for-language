package dev.jeromeswannack.chineselearning.lab.ui.lessons

import dev.jeromeswannack.chineselearning.lab.core.ChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationLine
import dev.jeromeswannack.chineselearning.lab.core.ConversationQuestion
import dev.jeromeswannack.chineselearning.lab.core.ConversationSpeaker
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.DescribeImageExercise
import dev.jeromeswannack.chineselearning.lab.core.DictationExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.LessonWord
import dev.jeromeswannack.chineselearning.lab.core.ListenChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ListenTranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.MatchExercise
import dev.jeromeswannack.chineselearning.lab.core.MatchPair
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.OralExpressionExercise
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.core.SentenceMakingExercise
import dev.jeromeswannack.chineselearning.lab.core.SpeakExercise
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteHandwritingExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteTypedExercise

/** Realistic exercises of every type for the lesson screenshots (a 把 lesson + a hotel check-in). */
object LessonSamples {
    val note = NoteExercise(
        title = "Doing something TO something",
        body = "把 moves the object in front of the verb: Subject + 把 + object + verb + result.\n\nUse it when you do something to a specific thing and something happens to it — it gets finished, moved, closed.",
        sentences = listOf(
            LessonSentence("我把作业做完了。", "Wǒ bǎ zuòyè zuò wán le.", "I finished my homework."),
            LessonSentence("请把门关上。", "Qǐng bǎ mén guān shang.", "Please close the door."),
        ),
    )
    val scramble = ScrambleExercise("I closed the door.", listOf("我", "把", "门", "关上了"), listOf("我", "把", "门", "关上了"))
    val choice = ChoiceExercise(
        "Your friend left the window open and it's cold. What do you say?",
        listOf(
            LessonSentence("请把窗户关上。", "Qǐng bǎ chuānghu guān shang.", "Please close the window."),
            LessonSentence("请关窗户把。", "Qǐng guān chuānghu bǎ.", "(word order is wrong)"),
            LessonSentence("请把窗户。", "Qǐng bǎ chuānghu.", "(no verb)"),
        ),
        0,
        "把 + object + verb + result: 把窗户关上.",
    )
    val translate = TranslateExercise("Please put the book on the table.", "请把书放在桌子上。", "Qǐng bǎ shū fàng zài zhuōzi shang.")
    val match = MatchExercise(listOf(MatchPair("门", "mén", "door"), MatchPair("窗户", "chuānghu", "window"), MatchPair("桌子", "zhuōzi", "table"), MatchPair("作业", "zuòyè", "homework")))
    val describe = DescribeImageExercise(
        imagePrompt = "A cosy kitchen: a man is putting a cake into the fridge while a cat watches from the counter.",
        task = "Describe what the man is doing — use 把.",
        referenceHanzi = "他把蛋糕放进冰箱里。",
        referencePinyin = "Tā bǎ dàngāo fàng jìn bīngxiāng lǐ.",
        referenceEnglish = "He is putting the cake into the fridge.",
    )
    val speak = SpeakExercise("Ask your flatmate to turn off the lights.", LessonSentence("请把灯关了。", "Qǐng bǎ dēng guān le.", "Please turn off the lights."))
    val listenChoice = ListenChoiceExercise(
        LessonSentence("我又去了。", "Wǒ yòu qù le.", "I went again."),
        "Which word did you hear?",
        listOf(LessonSentence("又", "yòu", "again"), LessonSentence("有", "yǒu", "to have")),
        0,
        "又 (yòu, 4th tone) = again; 有 (yǒu, 3rd tone) = to have.",
    )
    val listenTranslate = ListenTranslateExercise(LessonSentence("你把钥匙放在哪儿了？", "Nǐ bǎ yàoshi fàng zài nǎr le?", "Where did you put the keys?"))
    val sentenceMaking = SentenceMakingExercise(
        listOf(LessonWord("把", "bǎ", "(object marker)"), LessonWord("洗干净", "xǐ gānjìng", "wash clean")),
        task = "Tell someone what you did after dinner.",
        example = LessonSentence("我把碗洗干净了。", "Wǒ bǎ wǎn xǐ gānjìng le.", "I washed the bowls clean."),
    )
    val writeTyped = WriteTypedExercise(LessonSentence("冰箱", "bīngxiāng", "fridge"), prompt = "Write the word in characters.")
    val writeHand = WriteHandwritingExercise(LessonSentence("关门", "guān mén", "close the door"))
    val dictation = DictationExercise(LessonSentence("请把门关上。", "Qǐng bǎ mén guān shang.", "Please close the door."))
    val oral = OralExpressionExercise(
        "Tell a friend what you did last weekend.",
        questionAudio = LessonSentence("你周末做了什么？", "Nǐ zhōumò zuòle shénme?", "What did you do at the weekend?"),
        hints = listOf(LessonWord("打扫", "dǎsǎo", "to clean"), LessonWord("朋友", "péngyou", "friend")),
        example = LessonSentence("我周末把房间打扫了，然后跟朋友吃饭。", "Wǒ zhōumò bǎ fángjiān dǎsǎo le, ránhòu gēn péngyou chīfàn.", "At the weekend I cleaned my room, then ate with friends."),
        targetSeconds = 30,
    )
    val conversation = ConversationExercise(
        "Checking in at a hotel",
        listOf(ConversationSpeaker("前台 Receptionist", "female"), ConversationSpeaker("客人 Guest", "male")),
        listOf(
            ConversationLine(0, "您好，请问有预订吗？", "Nín hǎo, qǐngwèn yǒu yùdìng ma?", "Hello, do you have a reservation?"),
            ConversationLine(1, "有，我姓王，订了两个晚上。", "Yǒu, wǒ xìng Wáng, dìngle liǎng ge wǎnshang.", "Yes, my surname is Wang, I booked two nights."),
            ConversationLine(0, "好的，请把护照给我。", "Hǎo de, qǐng bǎ hùzhào gěi wǒ.", "OK, please give me your passport."),
            ConversationLine(1, "给您。早饭几点开始？", "Gěi nín. Zǎofàn jǐ diǎn kāishǐ?", "Here you are. What time does breakfast start?"),
        ),
        listOf(
            ConversationQuestion("How many nights did the guest book?", listOf("One", "Two", "Three"), 1),
            ConversationQuestion("What does the receptionist ask for?", answer = "His passport (护照).", explanation = "请把护照给我 — please give me your passport."),
        ),
    )

    val all: List<Pair<String, LessonExercise>> = listOf(
        "note" to note, "scramble" to scramble, "choice" to choice, "translate" to translate, "match" to match,
        "describe" to describe, "speak" to speak, "listen-choice" to listenChoice, "listen-translate" to listenTranslate,
        "sentence-making" to sentenceMaking, "write-typed" to writeTyped, "write-handwriting" to writeHand,
        "dictation" to dictation, "oral" to oral, "conversation" to conversation,
    )

    fun lesson(vararg exercises: LessonExercise, section: String? = null) =
        CustomLessonSpec("The 把 sentence", "🧱", "Doing something to something", listOf(LessonSection(section, exercises.toList())))

    val full = CustomLessonSpec(
        "The 把 sentence", "🧱", "Doing something to something",
        listOf(LessonSection("Learn", listOf(note, choice)), LessonSection("Practise", listOf(scramble, translate, dictation, oral))),
    )
}
