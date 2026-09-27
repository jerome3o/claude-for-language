/**
 * The lesson spec documentation every Claude that authors lessons reads —
 * the worker's generator / co-editor / in-app chat tools (via
 * LESSON_SPEC_INPUT_SCHEMA) and the MCP server's lesson tools. One text, so
 * a new exercise type is documented once.
 */

/** One line per exercise type: its fields and what the learner does. */
export const LESSON_EXERCISE_DOC = `- {type:"note", title?, body?, sentences?:[{hanzi,pinyin?,english?}]} — teaching text with example sentences (sentences get TTS). Not scored.
- {type:"scramble", english, tiles:[...], correct_order:[...], alt_orders?} — arrange tiles into the sentence; tiles must be exactly a permutation of correct_order.
- {type:"choice", question, options:[{hanzi,pinyin?,english?}], correct:<index>, explanation?} — multiple choice (2-5 options).
- {type:"translate", english, reference_hanzi, reference_pinyin?, note?} — translate EN→ZH, self-assessed against the reference.
- {type:"match", pairs:[{hanzi,pinyin?,english}]} — connect hanzi with meanings (2-8 pairs, no duplicate hanzi/english).
- {type:"describe_image", image_prompt, task?, reference_hanzi, reference_pinyin?, reference_english?} — an illustration is generated in the background from image_prompt (English, detailed, no text in the image); the learner describes it aloud and self-assesses.
- {type:"speak", prompt, example?:{hanzi,pinyin?,english?}} — say your own sentence out loud, self-assessed (not recorded).
- {type:"listen_choice", audio:{hanzi,pinyin?,english?}, question?, options:[{hanzi,pinyin?,english?}], correct:<index>, explanation?} — LISTENING: the audio hanzi is played via TTS (never shown until answered); pick the option matching what was heard. Ideal for tone/minimal-pair discrimination (有 yǒu vs 又 yòu).
- {type:"listen_translate", audio:{hanzi,pinyin?,english}, note?} — LISTENING: the audio hanzi is played (hidden); translate what you heard, self-assessed against audio.english (required).
- {type:"sentence_making", words:[{hanzi,pinyin?,english?}] (1-4), task?, input?:"type"|"handwrite", example?:{hanzi,pinyin?,english?}} — WRITING: the learner makes their OWN sentence using every target word (in the situation given by task); Claude checks it when online, self-assessed against the example offline. input picks typing (default) or handwriting.
- {type:"write_typed", answer:{hanzi,pinyin?,english?}, prompt?, cues?:["english"|"pinyin"|"audio"], alternatives?:[hanzi,...]} — WRITING (keyboard): the cues are shown (default english + pinyin) and the learner types answer.hanzi; checked automatically, punctuation ignored.
- {type:"write_handwriting", answer:{hanzi,pinyin?,english?}, prompt?, cues?} — WRITING (by hand): same cues, the learner writes answer.hanzi from memory on the stroke-order writing pad (every stroke checked). Max 12 characters — a word or short phrase.
- {type:"dictation", audio:{hanzi,pinyin?,english?}, input?:"type"|"handwrite", alternatives?, note?} — LISTENING: the sentence is played hidden and the learner writes down exactly what they heard (typed = checked character by character; handwrite = max 16 characters, stroke-checked on the writing pad).
- {type:"oral_expression", prompt, question_audio?:{hanzi,pinyin?,english?}, hints?:[{hanzi,pinyin?,english?}], example?:{hanzi,pinyin?,english?}, target_seconds?} — SPEAKING: the learner answers the prompt out loud and it is RECORDED (the tutor can listen); question_audio is played in Chinese; hints are useful words; example is a model answer shown afterwards.
- {type:"conversation", situation, speakers:[{name, voice?:"female"|"male"}] (2-3), lines:[{speaker:<index>, hanzi, pinyin?, english?}] (2-24), questions:[{question, options?:[string] (2-5), correct?:<index>, answer?:string, explanation?}] (1-6)} — LISTENING: a dialogue played with a different voice per speaker, text hidden; the learner listens to the whole conversation, then answers comprehension questions about what happened (options+correct = multiple choice; answer only = free answer, self-assessed). The transcript is revealed at the end. Write 6-12 natural lines at the learner's level, name speakers by role in Chinese + English (e.g. "前台 Receptionist"), give lines pinyin + english, and ask 2-4 questions in English about facts in the dialogue (who / what / when / how many / why) — not about vocabulary.`;

export const LESSON_AUTHORING_RULES = `Keep lessons short and focused (1-3 sections, ~4-10 exercises). Always tone-marked pinyin (nǐ hǎo), never tone numbers. A lesson that asks for written Chinese says HOW: typing and handwriting are separate skills (write_typed vs write_handwriting; input "type" vs "handwrite" on sentence_making and dictation). A "conversation lesson" about a situation (hotel, restaurant, doctor…) = a short note with key phrases, one conversation exercise, then a production exercise (oral_expression or sentence_making) in the same situation.`;

/** The whole spec, for a tool description. */
export const LESSON_SPEC_DOC = `CustomLessonSpec shape (JSON): { "title": string, "icon"?: string (one emoji), "description"?: string, "sections": [{ "title"?: string, "exercises": [Exercise, ...] }] }.
Exercise objects (each needs a "type"):
${LESSON_EXERCISE_DOC}
${LESSON_AUTHORING_RULES}`;
