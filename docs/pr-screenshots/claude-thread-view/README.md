# Claude thread view — screenshots

Phone shots at 412×915 @2× (the Pixel Fold folded), one desktop shot at 1280 px. Data from the E2E
stand-in (the worker streams its answer in three chunks).

![New chat: Send = Ask, plus ✏️ Check / 🔍 Explain for Chinese](01-new-chat-composer.png)
A new chat from the Coach's 💬 Ask Claude: suggestion chips above the box; for Chinese, ✏️ Check and 🔍 Explain sit beside Send (= Ask) with the hint line.

![A general thread mid-stream](02-general-streaming.png)
The reply streaming in (live `claude_turn` frames): its text so far with a caret.

![The finished reply](03-general-done.png)
The whole reply: word chips, ▶ · 拼 · EN · 🎤 Read it back, three suggestion chips after a reply.

![A card thread, empty](04-card-thread-empty.png)
Ask Claude about a card: "📇 Asked on card · 银行" under the header (→ the card hub) and the card's chips; Ask only.

![A card thread, answered](05-card-thread-answered.png)
After the "Use in sentence" chip: the streamed answer; the used chip is gone, at most three left.

![A Check result in a thread](06-check-result.png)
`/coach?text=…&action=check` opens a thread started with ✏️ Check: the Coach's result card (correction, ▶ / 🎤 Practise saying it, 🎯 Mini lesson) inside the thread.

![Offline: queued](07-offline-queued.png)
Offline: my message shows at once, "🕓 Waiting for a connection — it sends by itself"; it is sent when the connection comes back.

![Desktop](08-desktop-card-thread.png)
The same card thread at 1280 px: one centred column.
