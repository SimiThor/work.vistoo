package de.vistoo.work.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.vistoo.work.core.auth.AuthService
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.generated.Bootstrap
import de.vistoo.work.core.generated.Limits
import de.vistoo.work.core.generated.MemberRole
import de.vistoo.work.core.generated.Viewer
import de.vistoo.work.core.realtime.RealtimeHub
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Everything that belongs to ONE signed-in member. Created after sign-in,
 * discarded completely on sign-out or account switch — no data of a previous
 * user can survive in memory, subscriptions or downloaded files.
 */
class SessionModel(bootstrap: Bootstrap, val backend: Backend, auth: AuthService) {
    /** Lives as long as this session; cancelled on sign-out. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val userId: String = bootstrap.viewer.userId
    var viewer by mutableStateOf(bootstrap.viewer)
        private set
    var limits by mutableStateOf(bootstrap.limits)
        private set
    val work = WorkStore(backend, bootstrap)
    val chat = ChatStore(backend, bootstrap.viewer, scope)
    val team = TeamStore(backend, bootstrap.viewer)
    val notifications = NotificationSettingsModel(backend)
    val todos = TodoStore(backend)
    val ideas = IdeaStore(backend)
    val crm = CRMStore(backend)
    val decisions = DecisionStore(backend)
    val milestones = MilestoneStore(backend)

    private var realtime: RealtimeHub? = RealtimeHub(auth, scope) { handle(it) }
    private var lastResync = 0L

    val isAdmin: Boolean get() = viewer.role == MemberRole.Admin

    /** Initial load + realtime. */
    suspend fun start() {
        connectRealtime()
        coroutineScope {
            launch { work.reload() }
            launch { chat.reload() }
            launch { notifications.load() }
            launch { todos.reload() }
        }
        lastResync = System.currentTimeMillis()
    }

    fun connectRealtime() {
        realtime?.start(viewer.workspaceId, userId)
    }

    /** App went to the background: no permanent connection is assumed. */
    fun suspend() {
        realtime?.stop()
    }

    /** Back in the foreground or online again: reconnect and reload what may have been missed. */
    suspend fun resume() {
        connectRealtime()
        resync()
    }

    suspend fun resync() {
        lastResync = System.currentTimeMillis()
        coroutineScope {
            launch { work.reload() }
            launch { chat.resync() }
            launch { refreshViewer() }
            launch { todos.reload() }
            launch { reloadOpenedAreas() }
        }
    }

    /** Areas without realtime: reload the ones already opened in this session. */
    private suspend fun reloadOpenedAreas() {
        if (ideas.state != LoadState.Idle) ideas.reload()
        if (crm.state != LoadState.Idle) crm.reload()
        if (decisions.state != LoadState.Idle) decisions.reload()
        if (milestones.state != LoadState.Idle) milestones.reload()
    }

    private suspend fun refreshViewer() {
        val bootstrap = runCatching { backend.send(API.getBootstrap()) }.getOrNull() ?: return
        viewer = bootstrap.viewer
        limits = bootstrap.limits
        work.apply(bootstrap)
    }

    /** The conversation on screen gets its own message subscription. */
    fun watchConversation(id: String?) {
        realtime?.watchConversation(id)
    }

    fun stop() {
        realtime?.stop()
        realtime = null
        chat.reset()
        todos.reset()
        ideas.reset()
        crm.reset()
        decisions.reset()
        milestones.reset()
        scope.cancel()
    }

    private fun handle(event: RealtimeHub.Event) {
        when (event) {
            is RealtimeHub.Event.TaskUpserted -> work.merge(event.task)
            is RealtimeHub.Event.TaskDeleted -> work.removeTask(event.id)
            RealtimeHub.Event.ProjectsChanged -> scope.launch { work.reloadProjects() }
            RealtimeHub.Event.MembersChanged -> scope.launch {
                refreshViewer()
                team.reload()
            }
            RealtimeHub.Event.ConversationsChanged -> chat.reloadSoon()
            is RealtimeHub.Event.MessageChanged -> {
                scope.launch { chat.messageChanged(event.conversationId, event.messageId) }
                chat.reloadSoon()
            }
            RealtimeHub.Event.ResyncNeeded -> {
                // Avoid storms when the socket flaps.
                if (System.currentTimeMillis() - lastResync <= 2_000) return
                scope.launch { resync() }
            }
        }
    }
}

