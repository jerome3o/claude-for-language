package dev.jeromeswannack.chineselearning.lab.ui.kit

import dev.jeromeswannack.chineselearning.lab.ui.kit.MdInline.Code
import dev.jeromeswannack.chineselearning.lab.ui.kit.MdInline.Emphasis
import dev.jeromeswannack.chineselearning.lab.ui.kit.MdInline.LineBreak
import dev.jeromeswannack.chineselearning.lab.ui.kit.MdInline.Link
import dev.jeromeswannack.chineselearning.lab.ui.kit.MdInline.Strike
import dev.jeromeswannack.chineselearning.lab.ui.kit.MdInline.Strong
import dev.jeromeswannack.chineselearning.lab.ui.kit.MdInline.Text
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shared Markdown parser (react-markdown + remark-gfm subset) — plain JVM, no Robolectric. */
class MarkdownParserTest {
    private fun inline(s: String) = MarkdownParser.parseInline(s)
    private fun parse(s: String) = MarkdownParser.parse(s)
    private fun plain(inlines: List<MdInline>) = MarkdownParser.plainText(inlines)

    // ------------------------------------------------------------ inlines

    @Test fun boldItalicStrikeCode() {
        assertEquals(listOf(Strong(listOf(Text("打算"))), Text(" is "), Emphasis(listOf(Text("casual")))), inline("**打算** is *casual*"))
        assertEquals(listOf(Strike(listOf(Text("我计划"))), Text(" → 我打算")), inline("~~我计划~~ → 我打算"))
        assertEquals(listOf(Strike(listOf(Text("one")))), inline("~one~"))
        assertEquals(listOf(Text("say "), Code("了"), Text(" here")), inline("say `了` here"))
        assertEquals(listOf(Code("a ` b")), inline("`` a ` b ``"))
        assertEquals(listOf(Emphasis(listOf(Strong(listOf(Text("both")))))), inline("***both***"))
        assertEquals(listOf(Strong(listOf(Text("bold")))), inline("__bold__"))
    }

    @Test fun cjkNextToFullWidthPunctuationStillBold() {
        // CommonMark would leave these literal; Claude writes them all the time.
        assertEquals(listOf(Strong(listOf(Text("注意："))), Text("这个很重要")), inline("**注意：**这个很重要"))
        assertEquals(listOf(Text("用"), Strong(listOf(Text("“打算”"))), Text("比较自然")), inline("用**“打算”**比较自然"))
    }

    @Test fun intrawordUnderscoresAndLoneStarsStayLiteral() {
        assertEquals(listOf(Text("snake_case_name")), inline("snake_case_name"))
        assertEquals(listOf(Text("2 * 3 * 4")), inline("2 * 3 * 4"))
        assertEquals(listOf(Text("a ~~~ b")), inline("a ~~~ b"))
        assertEquals(listOf(Text("*literal*")), inline("\\*literal\\*"))
    }

    @Test fun linksAndAutolinks() {
        assertEquals(listOf(Text("see "), Link("https://mdbg.net", listOf(Text("MDBG")))), inline("see [MDBG](https://mdbg.net)"))
        assertEquals(listOf(Link("https://a.b/c", listOf(Text("https://a.b/c"))), Text(".")), inline("https://a.b/c."))
        assertEquals(listOf(Link("https://x.y", listOf(Text("https://x.y")))), inline("<https://x.y>"))
        assertEquals(listOf(Text("[not a link]")), inline("[not a link]"))
        assertEquals(listOf(Link("u", listOf(Strong(listOf(Text("b")))))), inline("[**b**](u)"))
    }

    @Test fun lineBreaksEntitiesAndBr() {
        assertEquals(listOf(Text("一"), LineBreak, Text("二")), inline("一  \n  二"))
        assertEquals(listOf(Text("a"), LineBreak, Text("b")), inline("a<br>b"))
        assertEquals(listOf(Text("A & B <C>")), inline("A &amp; B &lt;C&gt;"))
    }

    // ------------------------------------------------------------ blocks

    @Test fun headingsParagraphsRules() {
        val blocks = parse("# One\n## Two ##\ntext\nmore\n\n---\n\nSetext\n===\n#hashtag")
        assertEquals(MdBlock.Heading(1, listOf(Text("One"))), blocks[0])
        assertEquals(MdBlock.Heading(2, listOf(Text("Two"))), blocks[1])
        assertEquals(MdBlock.Paragraph(listOf(Text("text"), LineBreak, Text("more"))), blocks[2])
        assertEquals(MdBlock.Rule, blocks[3])
        assertEquals(MdBlock.Heading(1, listOf(Text("Setext"))), blocks[4])
        assertEquals(MdBlock.Paragraph(listOf(Text("#hashtag"))), blocks[5])
        assertEquals(listOf(MdBlock.Rule, MdBlock.Rule), parse("***\n\n_ _ _"))
    }

    @Test fun nestedListsAndTasks() {
        val blocks = parse("- a\n- b\n  - b1\n    - b1x\n  - b2\n- c\n\n1. one\n2. two\n   1. inner\n\n- [x] done\n- [ ] todo")
        val bullets = blocks[0] as MdBlock.ListBlock
        assertEquals(false, bullets.ordered)
        assertEquals(3, bullets.items.size)
        val nested = bullets.items[1].blocks[1] as MdBlock.ListBlock
        assertEquals(2, nested.items.size)
        assertEquals("b1x", plain((((nested.items[0].blocks[1] as MdBlock.ListBlock).items[0].blocks[0]) as MdBlock.Paragraph).content))
        val numbered = blocks[1] as MdBlock.ListBlock
        assertEquals(true, numbered.ordered)
        assertEquals(1, numbered.start)
        assertEquals(2, numbered.items.size)
        assertTrue(numbered.items[1].blocks[1] is MdBlock.ListBlock)
        val tasks = blocks[2] as MdBlock.ListBlock
        assertEquals(listOf(true, false), tasks.items.map { it.checked })
        assertEquals("done", plain((tasks.items[0].blocks[0] as MdBlock.Paragraph).content))
    }

    @Test fun looseListsStayOneListAndOrderedStartIsKept() {
        val blocks = parse("3. three\n\n4. four\n\nafter")
        assertEquals(2, blocks.size)
        val list = blocks[0] as MdBlock.ListBlock
        assertEquals(3, list.start)
        assertEquals(2, list.items.size)
        // "2020. was" mid-paragraph is not a list (only 1. may interrupt a paragraph)
        assertEquals(1, parse("It was\n2020. A year").size)
    }

    @Test fun quotesAndCode() {
        val blocks = parse("> **Tip:** one\nlazy line\n> - item\n\n```kotlin\nval x = \"**not bold**\"\n```")
        val quote = blocks[0] as MdBlock.Quote
        assertEquals("Tip: one\nlazy line", plain((quote.blocks[0] as MdBlock.Paragraph).content))
        assertTrue(quote.blocks[1] is MdBlock.ListBlock)
        assertEquals(MdBlock.CodeBlock("kotlin", "val x = \"**not bold**\""), blocks[1])
    }

    @Test fun gfmTable() {
        val blocks = parse("Compare:\n| 汉字 | Pinyin | Meaning |\n|:---|:---:|---:|\n| 打算 | dǎsuàn | to *intend* |\n| 计划 | jìhuà |\n| a \\| b | x | y | extra |\n\nafter")
        assertEquals(MdBlock.Paragraph(listOf(Text("Compare:"))), blocks[0])
        val table = blocks[1] as MdBlock.Table
        assertEquals(listOf("汉字", "Pinyin", "Meaning"), table.header.map(::plain))
        assertEquals(listOf(MdAlign.Start, MdAlign.Center, MdAlign.End), table.align)
        assertEquals(3, table.rows.size)
        assertEquals(listOf(Text("to "), Emphasis(listOf(Text("intend")))), table.rows[0][2])
        assertEquals(listOf("计划", "jìhuà", ""), table.rows[1].map(::plain)) // short row padded
        assertEquals(listOf("a | b", "x", "y"), table.rows[2].map(::plain)) // escaped pipe, extra cell dropped
        assertEquals(MdBlock.Paragraph(listOf(Text("after"))), blocks[2])
    }

    @Test fun pipesWithoutADelimiterRowAreText() {
        val blocks = parse("a | b\nc | d")
        assertEquals(1, blocks.size)
        assertTrue(blocks[0] is MdBlock.Paragraph)
    }

    /** The exact Ask Claude answer Jerome saw as raw text. */
    @Test fun jeromesScreenshot() {
        val blocks = parse(MarkdownSamples.askClaudeAnswer)
        assertEquals(
            listOf(
                MdBlock.Paragraph::class, MdBlock.Table::class, MdBlock.ListBlock::class,
                MdBlock.Quote::class, MdBlock.Rule::class, MdBlock.Paragraph::class,
            ),
            blocks.map { it::class },
        )
        val intro = (blocks[0] as MdBlock.Paragraph).content
        assertEquals(Strong(listOf(Text("打算"))), intro[0])
        val table = blocks[1] as MdBlock.Table
        assertEquals(listOf("汉字", "Pinyin", "Meaning"), table.header.map(::plain))
        assertEquals(listOf("打算", "dǎsuàn", "to intend; a plan (casual)"), table.rows[0].map(::plain))
        assertEquals(3, table.rows.size)
        val list = blocks[2] as MdBlock.ListBlock
        assertEquals(2, list.items.size)
        val first = (list.items[0].blocks[0] as MdBlock.Paragraph).content
        assertTrue(first.contains(Emphasis(listOf(Text("intend")))))
        val sub = list.items[1].blocks[1] as MdBlock.ListBlock
        assertTrue((sub.items[0].blocks[0] as MdBlock.Paragraph).content.contains(Emphasis(listOf(Text("我们计划下个月开业。")))))
        val quote = blocks[3] as MdBlock.Quote
        assertEquals("你周末打算做什么？\nWhat are you planning to do this weekend?", plain((quote.blocks[0] as MdBlock.Paragraph).content))
        val last = (blocks[5] as MdBlock.Paragraph).content
        assertEquals(Strike(listOf(Text("我计划周末看电影"))), last[0])
        // Nothing of the raw syntax is left in the visible text.
        val visible = blocks.joinToString("\n") { visibleText(it) }
        for (raw in listOf("|", "**", "~~", "---", "> ", "*")) assertTrue("raw '$raw' left in: $visible", !visible.contains(raw))
    }

    /** Every prefix of a streamed reply parses, and the finished blocks never turn back into text. */
    @Test fun streamingPrefixesAreSafe() {
        for (sample in listOf(MarkdownSamples.askClaudeAnswer, MarkdownSamples.gallery, "**unclosed\n| a |\n|--", "```\nopen fence", "- [", "> ", "1.", "[x](", "`", "~~", "<https://")) {
            for (end in 0..sample.length) {
                val blocks = parse(sample.substring(0, end))
                blocks.forEach { visibleText(it) }
            }
        }
        // Once the delimiter row starts arriving the table is already a table (no raw pipes flash).
        val partial = parse("| 汉字 | Pinyin | Meaning |\n|---|--")
        assertTrue(partial.single() is MdBlock.Table)
        assertEquals(listOf("汉字", "Pinyin", "Meaning"), (partial.single() as MdBlock.Table).header.map(::plain))
        // An open fence runs to the end; an unclosed ** stays literal.
        assertEquals(MdBlock.CodeBlock(null, "code so far"), parse("```\ncode so far").single())
        assertEquals(listOf(Text("**bold so far")), (parse("**bold so far").single() as MdBlock.Paragraph).content)
        // A list item being typed after a paragraph doesn't become a heading.
        assertTrue(parse("Two ways:\n-").single() is MdBlock.Paragraph)
    }

    @Test fun columnWidthsKeepCjkWholeAndScrollWhenTooWide() {
        // Fits: spare room is shared out, total = available.
        assertEquals(listOf(100, 200), tableColumnWidths(listOf(50, 100), 300, 140, 220))
        // Squeeze long columns only down to keep-whole; short ones never wrap.
        val squeezed = tableColumnWidths(listOf(60, 80, 250), 348, 140, 220)
        assertEquals(348, squeezed.sum())
        assertEquals(60, squeezed[0]); assertEquals(80, squeezed[1])
        assertTrue(squeezed[2] in 140..250)
        // Too wide even at keep-whole: long columns capped, table scrolls.
        assertEquals(listOf(85, 65, 160, 220), tableColumnWidths(listOf(85, 65, 160, 300), 352, 140, 220))
    }

    private fun visibleText(b: MdBlock): String = when (b) {
        is MdBlock.Heading -> plain(b.content)
        is MdBlock.Paragraph -> plain(b.content)
        is MdBlock.ListBlock -> b.items.joinToString("\n") { it.blocks.joinToString("\n", transform = ::visibleText) }
        is MdBlock.Quote -> b.blocks.joinToString("\n", transform = ::visibleText)
        MdBlock.Rule -> ""
        is MdBlock.CodeBlock -> b.code
        is MdBlock.Table -> (listOf(b.header) + b.rows).joinToString("\n") { r -> r.joinToString(" ", transform = ::plain) }
    }
}
