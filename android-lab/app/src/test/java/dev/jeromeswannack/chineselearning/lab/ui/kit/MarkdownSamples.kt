package dev.jeromeswannack.chineselearning.lab.ui.kit

/** Real Claude-shaped Markdown for the renderer's tests and screenshots. */
object MarkdownSamples {
    /**
     * The Ask Claude answer from Jerome's screenshot (raw pipes, `*italics*`, `~~strike~~`,
     * `>` quotes, `---` rules, bullets and bold) — what the Lab showed as plain text.
     */
    val askClaudeAnswer = """
        **打算** and **计划** both translate as "plan", but they don't feel the same.

        | 汉字 | Pinyin | Meaning |
        |---|---|---|
        | 打算 | dǎsuàn | to intend; a plan (casual) |
        | 计划 | jìhuà | a plan; to plan (formal, worked out) |
        | 准备 | zhǔnbèi | to get ready to; to prepare |

        - Use **打算** for what you *intend* to do: 我打算明天去。
        - Use **计划** for a plan with steps or dates: 公司的五年计划
          - As a verb it sounds written: *我们计划下个月开业。*

        > 你周末打算做什么？
        > *What are you planning to do this weekend?*

        ---

        ~~我计划周末看电影~~ sounds stiff in conversation — say 我打算周末看电影。
    """.trimIndent()

    /** Every element the renderer supports, for the kit gallery shot. */
    val gallery = """
        # Heading one
        ## Heading two
        ### Heading three

        A paragraph with **bold**, *italic*, ***both***, ~~struck~~, `inline code` and a [link](https://example.com).
        A second line in the same paragraph keeps its line break.

        1. First step
        2. Second step
           1. Nested numbered
           2. Another one
        3. Third step

        - [x] Learned 打算
        - [ ] Review 计划

        > **Tip:** a quote can hold *inline* styles too.

        ```
        我 打算 明天 去
        wǒ dǎsuàn míngtiān qù
        ```

        | Character | Pinyin | Meaning | Example |
        |:---|:---:|---|---|
        | 打 | dǎ | to hit; to do | 打电话 (dǎ diànhuà) to make a phone call |
        | 算 | suàn | to calculate; to count | 算了 (suàn le) forget it |
    """.trimIndent()
}
