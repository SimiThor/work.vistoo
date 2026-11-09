package de.vistoo.work.core.realtime

import android.util.Log
import de.vistoo.work.core.api.Http
import de.vistoo.work.core.api.Iso8601
import de.vistoo.work.core.auth.AuthService
import de.vistoo.work.core.generated.TaskItem
import de.vistoo.work.core.generated.TaskStatus
import de.vistoo.work.core.support.CalendarDate
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * Supabase Realtime for one signed-in member — the same subscriptions as the web and iOS:
 *
 * - workspace channel: tasks (row payloads, merged by version), projects,
 *   members (→ reload), conversations (list/unread signal) and the caller's
 *   own new conversation memberships,
 * - conversation channel: messages of the conversation that is on screen.
 *
 * Access control is RLS on the Supabase side: every event is checked against the
 * SELECT policies with the user's JWT, so removed members get nothing. Realtime is a
 * "something changed" signal on top of the API, never the only source: after
 * reconnects and when the app returns to the foreground the stores reload from the
 * API ([Event.ResyncNeeded]). Foreground only, no background connection.
 *
 * Protocol: Phoenix channels (vsn 1.0.0) over one WebSocket. All callbacks are
 * marshalled onto [scope] (main thread).
 */
class RealtimeHub(
    private val auth: AuthService,
    private val scope: CoroutineScope,
    private val onEvent: (Event) -> Unit,
) {
    sealed interface Event {
        data class TaskUpserted(val task: TaskItem) : Event
        data class TaskDeleted(val id: String) : Event
        data object ProjectsChanged : Event
        data object MembersChanged : Event
        data object ConversationsChanged : Event
        data class MessageChanged(val conversationId: String, val messageId: String) : Event

        /** The connection was interrupted: events may have been missed. */
        data object ResyncNeeded : Event
    }

    private data class Channel(val topic: String, val config: JsonArray, val kind: Kind, val conversationId: String? = null) {
        enum class Kind { Workspace, Conversation }
    }

    private var socket: WebSocket? = null
    private var connected = false
    private var wasDisconnected = false
    private var wanted = false
    private var workspaceKey: String? = null
    private var workspace: Channel? = null
    private var conversation: Channel? = null
    private var ref = 0
    private var pendingHeartbeat: String? = null
    private var heartbeatJob: Job? = null
    private var reconnectJob: Job? = null
    private var tokenJob: Job? = null
    private var reconnectAttempt = 0
    private var lastToken: String? = null

    /** Idempotent: a second call with the same workspace does not subscribe twice. */
    fun start(workspaceId: String, userId: String) {
        val key = "$workspaceId:$userId"
        wanted = true
        if (workspaceKey == key && socket != null) return
        workspaceKey = key
        val ws = "workspace_id=eq.$workspaceId"
        workspace?.let { leave(it) }
        workspace = Channel(
            topic = "realtime:android-workspace-$workspaceId-${shortId()}",
            config = buildJsonArray {
                add(change("*", "tasks", ws))
                // DELETE events cannot be filtered server-side; they only carry the id.
                add(change("DELETE", "tasks", null))
                add(change("*", "projects", ws))
                add(change("*", "workspace_members", ws))
                add(change("UPDATE", "conversations", ws))
                add(change("INSERT", "conversation_members", "user_id=eq.$userId"))
            },
            kind = Channel.Kind.Workspace,
        )
        if (socket == null) connect() else if (connected) workspace?.let { join(it) }
    }

    /** Subscribes to the messages of the conversation on screen (null = none). */
    fun watchConversation(conversationId: String?) {
        if (conversation?.conversationId == conversationId) return
        conversation?.let { leave(it) }
        conversation = null
        if (conversationId == null) return
        val filter = "conversation_id=eq.$conversationId"
        val channel = Channel(
            topic = "realtime:android-conversation-$conversationId-${shortId()}",
            config = buildJsonArray {
                add(change("INSERT", "messages", filter))
                add(change("UPDATE", "messages", filter))
            },
            kind = Channel.Kind.Conversation,
            conversationId = conversationId,
        )
        conversation = channel
        if (connected) join(channel)
    }

    /** Ends all subscriptions (background, sign-out, account switch). */
    fun stop() {
        wanted = false
        workspaceKey = null
        workspace = null
        conversation = null
        heartbeatJob?.cancel()
        reconnectJob?.cancel()
        tokenJob?.cancel()
        socket?.close(1000, "stop")
        socket = null
        connected = false
        wasDisconnected = false
    }

    // MARK: Connection

    private fun connect() {
        val base = auth.supabaseUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
        val url = "$base/realtime/v1/websocket?apikey=${auth.publishableKey}&vsn=1.0.0"
        val request = runCatching { Request.Builder().url(url).build() }.getOrNull() ?: return
        socket = client.newWebSocket(request, Listener())
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            scope.launch {
                if (webSocket !== socket) return@launch
                connected = true
                reconnectAttempt = 0
                if (wasDisconnected) onEvent(Event.ResyncNeeded)
                wasDisconnected = false
                startHeartbeat()
                startTokenRefresh()
                workspace?.let { join(it) }
                conversation?.let { join(it) }
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            scope.launch { if (webSocket === socket) handle(text) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            scope.launch { if (webSocket === socket) disconnected() }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            scope.launch { if (webSocket === socket) disconnected() }
        }
    }

    private fun disconnected() {
        connected = false
        wasDisconnected = true
        socket = null
        heartbeatJob?.cancel()
        tokenJob?.cancel()
        if (!wanted) return
        reconnectJob?.cancel()
        val wait = listOf(1_000L, 2_000L, 5_000L, 10_000L)[reconnectAttempt.coerceAtMost(3)]
        reconnectAttempt++
        reconnectJob = scope.launch {
            delay(wait)
            if (wanted && socket == null) connect()
        }
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        pendingHeartbeat = null
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(25_000)
                if (pendingHeartbeat != null) {
                    // No answer to the last heartbeat: the connection is dead.
                    socket?.cancel()
                    disconnected()
                    return@launch
                }
                val r = nextRef()
                pendingHeartbeat = r
                send("phoenix", "heartbeat", JsonObject(emptyMap()), r)
            }
        }
    }

    /** Keeps the channel token fresh for long foreground sessions. */
    private fun startTokenRefresh() {
        tokenJob?.cancel()
        tokenJob = scope.launch {
            while (isActive) {
                delay(5 * 60_000)
                val token = runCatching { auth.accessToken() }.getOrNull() ?: continue
                if (token != lastToken) {
                    lastToken = token
                    for (c in listOfNotNull(workspace, conversation)) {
                        send(c.topic, "access_token", buildJsonObject { put("access_token", token) }, nextRef())
                    }
                }
            }
        }
    }

    private fun join(channel: Channel) {
        scope.launch {
            val token = runCatching { auth.accessToken() }.getOrNull()
            lastToken = token
            val payload = buildJsonObject {
                put(
                    "config",
                    buildJsonObject {
                        put("broadcast", buildJsonObject { put("ack", false); put("self", false) })
                        put("presence", buildJsonObject { put("key", "") })
                        put("postgres_changes", channel.config)
                        put("private", false)
                    },
                )
                if (token != null) put("access_token", token)
            }
            val r = nextRef()
            send(channel.topic, "phx_join", payload, r, joinRef = r)
        }
    }

    private fun leave(channel: Channel) {
        if (connected) send(channel.topic, "phx_leave", JsonObject(emptyMap()), nextRef())
    }

    private fun send(topic: String, event: String, payload: JsonObject, ref: String, joinRef: String? = null) {
        val message = buildJsonObject {
            put("topic", topic)
            put("event", event)
            put("payload", payload)
            put("ref", ref)
            if (joinRef != null) put("join_ref", joinRef)
        }
        socket?.send(message.toString())
    }

    // MARK: Messages

    private fun handle(text: String) {
        val message = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        val topic = message["topic"]?.str() ?: return
        val event = message["event"]?.str() ?: return
        val payload = message["payload"] as? JsonObject ?: return
        when (event) {
            "phx_reply" -> {
                if (topic == "phoenix" && message["ref"]?.str() == pendingHeartbeat) pendingHeartbeat = null
                val status = payload["status"]?.str()
                if (status == "error") Log.w(TAG, "join refused on $topic: ${payload["response"]}")
            }
            "phx_error", "phx_close" -> rejoinLater(topic)
            "postgres_changes" -> {
                val channel = listOfNotNull(workspace, conversation).firstOrNull { it.topic == topic } ?: return
                val data = payload["data"] as? JsonObject ?: return
                handleChange(channel, data)
            }
        }
    }

    private fun rejoinLater(topic: String) {
        val channel = listOfNotNull(workspace, conversation).firstOrNull { it.topic == topic } ?: return
        scope.launch {
            delay(2_000)
            if (connected && (workspace?.topic == topic || conversation?.topic == topic)) {
                join(channel)
                onEvent(Event.ResyncNeeded)
            }
        }
    }

    private fun handleChange(channel: Channel, data: JsonObject) {
        val table = data["table"]?.str()
        val type = data["type"]?.str()
        val record = data["record"] as? JsonObject
        val old = data["old_record"] as? JsonObject
        when (channel.kind) {
            Channel.Kind.Conversation -> {
                val id = record?.get("id")?.str() ?: return
                val conversationId = channel.conversationId ?: return
                onEvent(Event.MessageChanged(conversationId, id.lowercase()))
            }
            Channel.Kind.Workspace -> when (table) {
                "tasks" -> when (type) {
                    "DELETE" -> old?.get("id")?.str()?.let { onEvent(Event.TaskDeleted(it.lowercase())) }
                    else -> {
                        val task = record?.let { TaskRow.decode(it) }
                        // Unknown payload shape: fall back to a reload instead of guessing.
                        onEvent(if (task != null) Event.TaskUpserted(task) else Event.ResyncNeeded)
                    }
                }
                "projects" -> onEvent(Event.ProjectsChanged)
                "workspace_members" -> onEvent(Event.MembersChanged)
                "conversations", "conversation_members" -> onEvent(Event.ConversationsChanged)
            }
        }
    }

    private fun nextRef(): String = (++ref).toString()

    private fun change(event: String, table: String, filter: String?) = buildJsonObject {
        put("event", event)
        put("schema", "public")
        put("table", table)
        if (filter != null) put("filter", filter)
    }

    private fun shortId() = UUID.randomUUID().toString().take(8)

    private companion object {
        const val TAG = "realtime"
        val Json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
        val client by lazy { Http.client.newBuilder().pingInterval(0, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).build() }
    }
}

private fun JsonElement.str(): String? = if (this is JsonPrimitive && this !is JsonNull) content else null

/** Postgres row of `tasks` as delivered by Realtime (snake_case). */
object TaskRow {
    fun decode(record: JsonObject): TaskItem? {
        fun string(key: String): String? = record[key]?.let { if (it is JsonNull) null else (it as? JsonPrimitive)?.content }
        fun number(key: String): Double? = record[key]?.let { (it as? JsonPrimitive)?.let { p -> if (p is JsonNull) null else p.doubleOrNull ?: p.content.toDoubleOrNull() } }
        val id = string("id") ?: return null
        val projectId = string("project_id") ?: return null
        val title = string("title") ?: return null
        val status = string("status") ?: return null
        val position = number("position") ?: return null
        val createdBy = string("created_by") ?: return null
        val createdAt = string("created_at")?.let(Iso8601::parse) ?: return null
        val updatedAt = string("updated_at")?.let(Iso8601::parse) ?: return null
        val version = number("version") ?: return null
        val issueNumber = number("number") ?: return null
        return TaskItem(
            id = id.lowercase(),
            projectId = projectId.lowercase(),
            groupId = null, // groups were removed
            milestoneId = string("milestone_id")?.lowercase(),
            number = issueNumber.toLong(),
            title = title,
            description = string("description") ?: "",
            status = TaskStatus.from(status),
            assigneeId = string("assignee_id")?.lowercase(),
            startDate = string("start_date")?.let(CalendarDate::parse),
            endDate = string("end_date")?.let(CalendarDate::parse),
            position = position,
            createdBy = createdBy.lowercase(),
            createdAt = createdAt,
            updatedAt = updatedAt,
            version = version.toLong(),
        )
    }
}
