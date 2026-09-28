package dev.jeromeswannack.chineselearning.lab.ui.library

import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.data.api.LastScoreDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryAssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummary
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate

/** Realistic library data for the library / catalogue tests (real hanzi). */
object LibrarySamples {
    val items = listOf(
        LibraryItemSummary(
            "lib1", "把 sentences in the kitchen", "Word order with 把 and kitchen verbs: 切、洗、放、打开", "🍳",
            listOf("grammar", "HSK 3"), 3, "2026-09-01 10:00:00", "2026-09-27 09:30:00", 2, 8,
        ),
        LibraryItemSummary(
            "lib2", "Checking in at a hotel", "A conversation lesson: 我预订了一个双人间。", "🏨",
            listOf("conversation"), 1, "2026-09-20 18:00:00", "2026-09-24T08:15:00Z", 0, 3,
        ),
        LibraryItemSummary(
            "lib3", "Tones: 买 or 卖?", null, "👂",
            emptyList(), 2, "2026-08-02 10:00:00", "2026-08-30 12:00:00", 1, 1,
        ),
    )

    val spec: JsonObject = Json.parseToJsonElement(
        """
        {"title":"把 sentences in the kitchen","icon":"🍳","description":"Word order with 把 and kitchen verbs: 切、洗、放、打开",
         "sections":[
          {"title":"Warm-up","exercises":[
            {"type":"note","title":"What 把 does","body":"把 moves the object before the verb: 我把菜洗了。"},
            {"type":"match","pairs":[{"hanzi":"切","english":"to cut"},{"hanzi":"洗","english":"to wash"},{"hanzi":"放","english":"to put"}]}
          ]},
          {"title":"Practice","exercises":[
            {"type":"scramble","tiles":["我","把","苹果","切","了"],"english":"I cut the apple."},
            {"type":"choice","question":"你把门打开了吗？ — which answer is right?","options":[{"hanzi":"我把门打开了。"},{"hanzi":"我打开把门了。"}],"answer":0},
            {"type":"translate","english":"Put the bowl on the table.","answer":"把碗放在桌子上。"},
            {"type":"listen_choice","audio":{"hanzi":"我们走吧。"},"options":[{"hanzi":"把"},{"hanzi":"吧"}],"answer":0},
            {"type":"speak","prompt":"Say what you did in the kitchen this morning, using 把."},
            {"type":"sentence_making","words":["把","洗"],"task":"Tell your flatmate what to do with the vegetables."}
          ]}
         ]}
        """.trimIndent(),
    ) as JsonObject

    val item = LibraryItemDto(
        "lib1", "把 sentences in the kitchen", "Word order with 把 and kitchen verbs: 切、洗、放、打开", "🍳",
        listOf("grammar", "HSK 3"), 3, "2026-09-01 10:00:00", "2026-09-27 09:30:00", null, spec, 2,
    )

    private val jerome = UserSummaryDto("u-jerome", "jerome@example.com", "Jerome")
    private val mei = UserSummaryDto("u-mei", "mei@example.com", "王美丽 Mei")
    private val tom = UserSummaryDto("u-tom", "tom@example.com", "Tom Baker")
    private val me = UserSummaryDto("u-tutor", "laoshi@example.com", "李老师")

    val assignments = listOf(
        LibraryAssignmentDto("cl1", "rel-jerome", "2026-09-20 10:00:00", jerome, 3, "2026-09-26 21:14:00", 2, LastScoreDto(7, 8), "att1", true),
        LibraryAssignmentDto("cl2", "rel-mei", "2026-09-22 10:00:00", mei, 0, null, null, null, null, false),
    )

    val relationships = MyRelationshipsDto(
        students = listOf(
            RelationshipDto("rel-jerome", "u-tutor", "u-jerome", "tutor", "active", requester = me, recipient = jerome),
            RelationshipDto("rel-mei", "u-mei", "u-tutor", "student", "active", requester = mei, recipient = me),
            RelationshipDto("rel-tom", "u-tutor", "u-tom", "tutor", "active", requester = me, recipient = tom),
        ),
    )

    val today: LocalDate = LocalDate.of(2026, 9, 27)

    fun assign(mode: HomeworkMode = HomeworkMode.BOTH, selected: Set<String> = setOf("rel-tom"), due: LocalDate = today.plusDays(2)) = AssignUi(
        itemId = "lib1",
        title = "把 sentences in the kitchen",
        students = studentOptions(relationships, assignments),
        selected = selected,
        mode = mode,
        today = today,
        due = due,
    )

    fun listUi(vararg extra: (LibraryUi) -> LibraryUi): LibraryUi =
        extra.fold(LibraryUi(list = Loadable(items, updatedAt = System.currentTimeMillis()))) { ui, f -> f(ui) }

    val itemUi = LibraryItemUi(
        item = Loadable(item, updatedAt = System.currentTimeMillis()),
        assignments = Loadable(assignments, updatedAt = System.currentTimeMillis()),
    )

    val conversationSample get() = LessonCatalogue.sample("conversation")!!
}
