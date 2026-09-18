# Chat page clean-up — PR screenshots

Captured on the dev server with Playwright at the phone viewport (412×915, 2×) with a seeded
tutor (王老师) ↔ student (Xiao Ming) conversation and the student's Claude practice chat. The
container has no AI/TTS keys, so every AI tool fails — which is exactly what the inline error
states show. The red bubble at the bottom-right is the shared feedback FAB (unchanged).

## Before

![Student view before](01-before-student-chat.png)

Student view before: five 20–34px tool icons under every message.

![Claude practice chat before](02-before-claude-chat.png)

Claude practice chat before: same tool row, ❓ button by the composer.

![❓ dialog before](03-before-help-dialog.png)

The ❓ dialog before, titled "I don't know what to say".

![Tutor view before](04-before-tutor-chat.png)

Tutor view before: the tutor's own messages get "Check my Chinese" (✓?), the student's get Translate.

## After — student view of the tutor chat

![Student view after](11-after-student-chat.png)

Inline per message: Reply, Play and ⋯ at 44px. Header: + Card, ⋯ (conversation menu); the conversation title sits under the tutor's name. "Help me say it" above the composer.

![Action sheet on the tutor's message](12-after-sheet-other-message.png)

⋯ / long-press on the tutor's message: reactions row, Translate & make flashcard, Word by word, Discuss with Claude, Copy text.

![Action sheet on the learner's own message](13-after-sheet-own-message.png)

On the learner's own message: Check my Chinese instead of Translate.

![Checking spinner](14-after-check-spinner.png)

"Checking…" spinner on the message while Check my Chinese runs.

![Inline error after a failed check](15-after-check-inline-error.png)

Failed check: Coach-style inline error above the input row instead of an `alert()`.

![+ Card spinner](16-after-card-spinner.png)

+ Card shows a spinner inside the button (label no longer turns into "…").

![+ Card inline error](17-after-card-inline-error.png)

Failed card generation: inline error.

![Help me say it dialog](18-after-help-me-say-it.png)

The dialog is now titled "Help me say it".

![Help me say it error](19-after-help-error.png)

Failed suggestion call: inline error under the "Help me say it" button.

![Header menu](20-after-header-menu.png)

Header ⋯: New conversation, Add a title / Rename, Voice settings (AI chats), All conversations.

![Offline](21-after-offline.png)

Offline: + Card, Play and Help me say it disabled with "needs internet" hints; sending blocked with an explicit message.

![Offline action sheet](22-after-offline-sheet.png)

Offline action sheet: network tools disabled with a "Needs internet" hint; Copy and Reply still work.

## After — Claude practice chat

![Claude chat after](23-after-claude-chat.png)

Claude practice chat with the lighter tool row.

![Sheet on own message in the Claude chat](24-after-claude-sheet-own.png)

The learner's own message in the Claude chat keeps Check my Chinese.

![New conversation via ?new=1](25-after-new-conversation.png)

`?new=1` opened a fresh, untitled conversation directly (no title modal); a title can be added later from the header ⋯.

## After — tutor view

![Tutor view after](31-after-tutor-chat.png)

Tutor view after.

![Tutor sheet on the student's message](32-after-tutor-sheet-student-message.png)

Tutor's sheet on the student's message: "Make a card from this" (no Translate wording, no word-by-word).

![Tutor sheet on own message](33-after-tutor-sheet-own-message.png)

Tutor's sheet on their own message: React, Discuss, Copy — no Check my Chinese.

## Desktop (≥640px)

![Desktop popover](41-after-desktop-popover.png)

At 1024px the sheet becomes a popover anchored to the message's ⋯ button.
