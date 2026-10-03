package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.LabApp

/**
 * Wiring for chat delivery (docs/CHAT.md §5 Lab), called once from LabApp.onCreate:
 * the Messages channel (created early, before any permission prompt), Firebase when configured,
 * foreground tracking + the live socket, the 15-minute inbox check, and the sign-out hook.
 */
object ChatDelivery {
    fun install(app: LabApp) {
        runCatching { ChatNotifier.ensureChannel(app) }
        ChatPresence.track(app)
        PushRegistration.init(app)
        runCatching { ChatCheckWorker.schedule(app) }
        app.chatLive.start()
        if (app.repo.isSignedIn) PushRegistration.ensure(app)
        app.repo.beforeSignOut += { signingOut(app) }
        ChatClips.of(app) // listening mode's clip cache (background prefetch: ChatListeningStore.Sync)
    }

    /** MainActivity after a successful sign-in. */
    fun signedIn(app: LabApp) {
        app.chatLive.setSignedIn(true)
        PushRegistration.ensure(app, force = true)
    }

    private suspend fun signingOut(app: LabApp) {
        app.chatLive.setSignedIn(false)
        runCatching { PushRegistration.unregister(app) }
        ChatNotifier.cancelAll(app)
    }
}
