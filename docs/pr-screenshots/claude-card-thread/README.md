# Ask Claude on a card = the card's Claude thread

Web (412×915 @2×, from `e2e/tests/ask-claude-card-thread.spec.ts` with `ASK_CARD_SHOTS`, the worker's E2E stand-in model):

![Sheet, empty](web-01-sheet-empty.png)
The study card's Ask Claude: the thread view as a sheet — "📇 Asked on card · 银行", 🎧 · 中文 | EN, the card's chips, Ask only (no Check / Explain).

![Streaming](web-02-streaming.png)
The reply streams in.

![Reply + check](web-03-reply-check.png)
Word chips, ▶ · 拼 · EN · 🎤 Read it back; my Chinese question checked in the background: ✎ + 🎓 Open in Coach.

![Claude edited the card](web-04-edited-undo.png)
Claude's card tool (the stand-in adds a fun fact): "✓ Claude edited this card · notes  [Undo]" — replaces Approve / Reject; the card back shows the new notes, Undo puts them back.

![Chats tab](web-05-chats-tab.png)
The thread in the Chats tab with "📇 Asked on card · 银行" (the chip opens the card hub).

![Card hub](web-06-card-hub.png)
The card hub lists the card's conversations → "Open conversation".

![Offline](web-07-offline-queued.png)
Offline: the question is queued — "🕓 Will send when you're online" — and sent when the connection is back.

![Listen first](web-08-listening-hidden.png)
🎧 Listen first: the answer arrives hidden and plays by itself.

Lab app (Roborazzi, `CardClaudeSheetTest`):

![Lab empty](lab-card-claude-01-empty.png)
The sheet over the card: chips, Ask only.

![Lab reply + edit](lab-card-claude-02-reply-edit.png)
"🕘 Earlier about 银行 · 2 chats" / ＋ New chat, the ✎ on my question, "✓ Claude edited this card · notes · Undo".

![Lab reply + edit, dark](lab-card-claude-03-reply-edit-dark.png)
Dark.

![Lab empty, dark](lab-card-claude-04-empty-dark.png)
Dark, empty.

![Lab offline](lab-card-claude-05-offline-queued.png)
Offline: "🕓 Will send when you're online".
