# Practice exercise types, conversation lessons, catalogue, attempt review

Phone viewport 412×915 @2×, local worker + frontend with seeded tutor (王老师) and student (Jerome).
TTS and Claude's sentence check are stubbed in the browser (no API keys locally) — the UI is the real one.

## Sentence making (typed; Claude checks it)
![Question](02-sentence-making-question.png) — own sentence with the target words
![Claude feedback](03-sentence-making-feedback.png) — words used ✓, "almost" verdict, corrected sentence, comment, example

## Writing — typed
![Question](04-write-typed-question.png) — English + pinyin cue, type the characters
![Answered](05-write-typed-answered.png) — wrong character struck through, missed one highlighted

## Writing — handwriting (stroke-order pad, from memory)
![Question](06-write-handwriting-question.png) — characters hidden, one square per character
![Wrong order](07-write-handwriting-wrong-order.png) — the pad names the mistake
![Answered](08-write-handwriting-answered.png) — per-character grade and stroke dots → Continue

## Dictation
![Typed question](09-dictation-typed-question.png) — hear it, type it
![Typed answered](10-dictation-typed-answered.png) — character-by-character result
![Handwritten question](11-dictation-handwrite-question.png) — stroke pad, characters hidden
![Handwritten answered](12-dictation-handwrite-answered.png) — written from memory, then the sentence

## Oral expression (recorded)
![Question](13-oral-question.png) — prompt, spoken question, useful words
![Recording](14-oral-recording.png) — timer + level meter
![Answered](16-oral-answered.png) — listen back, model answer, "your tutor can listen"

## Conversation (two voices)
![Listening](17-conversation-listening.png) — speakers in different voices, text hidden, current line pulses
![Answered](19-conversation-answered.png) — comprehension questions with explanations
![Transcript](20-conversation-transcript.png) — score + transcript with pinyin and English

## Tutor: attempt review
![Attempts](22-tutor-attempts-list.png) — the student's lesson runs
![Review top](42-review-top.png) — score, total time, time per section, sentence + Claude feedback
![Handwriting](43-review-handwriting.png) — typed diff; each handwritten stroke re-drawn over the model, coloured by how it went
![Oral + conversation](44-review-oral-conversation.png) — playable recording; conversation answers
![Student page](24-tutor-student-page-lessons.png) — 📝 Answers from the student's Mini Lessons

## Catalogue
![Library link](25-library-catalogue-link.png) — entry from the lesson library
![Catalogue](26-catalogue.png) — each type: what it does, how it's checked, sample lesson
![Writing filter](45-catalogue-writing.png) — typed vs handwriting as separate types
![Trial](40-trial-key-phrases.png) — a sample taken as a trial (nothing recorded)
![Trial conversation](41-trial-conversation-questions.png) — the conversation sample
![Conversation from a situation](29-new-lesson-conversation-quick.png) — New lesson → situation + level

## Editor
![Conversation form (phone)](46-editor-conversation-form.png) — speakers with voices, lines, questions
![Conversation form (desktop)](48-editor-conversation-desktop.png)
