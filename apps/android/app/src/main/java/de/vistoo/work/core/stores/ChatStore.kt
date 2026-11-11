package de.vistoo.work.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.api.Patchable
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.generated.AddChannelMembersRequest
import de.vistoo.work.core.generated.Attachment
import de.vistoo.work.core.generated.ChatPerson
import de.vistoo.work.core.generated.ChatStorageUsage
import de.vistoo.work.core.generated.ConversationDetail
import de.vistoo.work.core.generated.ConversationSummary
import de.vistoo.work.core.generated.CreateChannelRequest
import de.vistoo.work.core.generated.EditMessageRequest
import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.Limits
import de.vistoo.work.core.generated.MarkReadRequest
import de.vistoo.work.core.generated.MemberRole
import de.vistoo.work.core.generated.Message
import de.vistoo.work.core.generated.OpenDirectMessageRequest
import de.vistoo.work.core.generated.RemoveChannelMemberRequest
import de.vistoo.work.core.generated.ReserveUploadRequest
import de.vistoo.work.core.generated.SendMessageRequest
import de.vistoo.work.core.generated.SetArchivedRequest
import de.vistoo.work.core.generated.UpdateChannelRequest
import de.vistoo.work.core.generated.UploadTicket
import de.vistoo.work.core.generated.Viewer
import de.vistoo.work.core.support.ByteFormatting
import de.vistoo.work.core.support.TemporaryFiles
import de.vistoo.work.core.support.Uploader
import de.vistoo.work.core.support.newClientId
import java.io.File
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Conversation list, unread state and the per-conversation models. */
class ChatStore(private val backend: Backend, private val viewer: Viewer, private val scope: CoroutineScope) {
    var conversations by mutableStateOf<List<ConversationSummary>>(emptyList())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set
    var storageUsage by mutableStateOf<ChatStorageUsage?>(null)
        private set

    /** Same signal as the web navigation dot. */
    val hasUnread: Boolean get() = conversations.any { it.unread && !it.archived }
    val unreadCount: Int get() = conversations.count { it.unread && !it.archived }

    private val models = mutableMapOf<String, ConversationModel>()
    private var reloadJob: Job? = null

    val isAdmin: Boolean get() = viewer.role == MemberRole.Admin

    suspend fun reload() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        try {
            conversations = backend.send(API.listConversations()).conversations
            state = LoadState.Loaded
        } catch (e: ApiError) {
            if (conversations.isEmpty()) state = LoadState.Failed(e.message)
        }
        if (isAdmin) runCatching { backend.send(API.getChatStorageUsage()) }.getOrNull()?.let { storageUsage = it }
    }

    /** Coalesces bursts of realtime signals into one request. */
    fun reloadSoon() {
        reloadJob?.cancel()
        reloadJob = scope.launch {
            delay(300)
            reload()
        }
    }

    fun summary(id: String): ConversationSummary? = conversations.firstOrNull { it.id == id }

    /** One model per conversation, kept for the session (drafts survive navigation). */
    fun model(id: String): ConversationModel = models.getOrPut(id) { ConversationModel(id, backend, viewer, this, scope) }

    internal fun updateLocalRead(conversationId: String, seq: Long) {
        val i = conversations.indexOfFirst { it.id == conversationId }
        if (i < 0) return
        val c = conversations[i]
        if (seq <= c.lastReadSeq) return
        conversations = conversations.toMutableList().also { it[i] = c.copy(lastReadSeq = seq, unread = c.lastMessageSeq > seq) }
    }

    internal fun noteSent(message: Message) {
        val i = conversations.indexOfFirst { it.id == message.conversationId }
        if (i < 0) return
        val c = conversations[i]
        val last = maxOf(c.lastMessageSeq, message.seq)
        val read = maxOf(c.lastReadSeq, message.seq)
        conversations = conversations.toMutableList().also {
            it[i] = c.copy(lastMessageSeq = last, lastReadSeq = read, lastMessageAt = message.createdAt, unread = last > read)
        }
    }

    // MARK: Creating conversations

    suspend fun createChannel(name: String, description: String, isPrivate: Boolean, memberIds: List<String>): String {
        val body = CreateChannelRequest(
            id = newClientId(),
            name = name,
            description = description,
            visibility = if (isPrivate) CreateChannelRequest.Visibility.Private else CreateChannelRequest.Visibility.Open,
            memberIds = memberIds,
        )
        val ref = backend.send(API.createChannel(body = body))
        reload()
        return ref.id
    }

    suspend fun openDirectMessage(userId: String): String {
        val ref = backend.send(API.openDirectMessage(body = OpenDirectMessageRequest(userId = userId)))
        reload()
        return ref.id
    }

    /** Realtime: a message of a conversation changed. */
    suspend fun messageChanged(conversationId: String, messageId: String) {
        models[conversationId]?.received(messageId)
    }

    /** Fills the gap of one open conversation (its realtime subscription just became active). */
    suspend fun catchUp(conversationId: String) {
        models[conversationId]?.takeIf { it.state == LoadState.Loaded }?.catchUp()
    }

    /** After reconnect / foreground: reload list and fill gaps of open conversations. */
    suspend fun resync() {
        reload()
        for (model in models.values.toList()) if (model.isVisible) model.catchUp()
    }

    /** Clears everything user-specific (sign-out, account switch). */
    fun reset() {
        reloadJob?.cancel()
        models.clear()
        conversations = emptyList()
    }
}

/**
 * A message that is not confirmed by the server yet. It keeps its client id, so
 * "Erneut senden" can never create a duplicate (the server deduplicates).
 */
data class PendingMessage(
    val id: String,
    val body: String,
    val attachments: List<Attachment>,
    val createdAt: Instant,
    val failure: String? = null,
) {
    val isSending: Boolean get() = failure == null
}

/** An attachment in the composer. */
data class ComposerAttachment(
    val id: String,
    val fileName: String,
    val sizeBytes: Long,
    val mimeType: String,
    val state: State,
) {
    sealed interface State {
        data object Uploading : State
        data class Ready(val attachmentId: String) : State
        data class Failed(val message: String) : State
    }
}

/** One conversation on screen: details, paged history, composer, read state, files. */
class ConversationModel internal constructor(
    val id: String,
    private val backend: Backend,
    private val viewer: Viewer,
    private val store: ChatStore,
    private val scope: CoroutineScope,
) {
    var detail by mutableStateOf<ConversationDetail?>(null)
        private set

    /** Confirmed messages, ascending by seq. */
    var messages by mutableStateOf<List<Message>>(emptyList())
        private set
    var pending by mutableStateOf<List<PendingMessage>>(emptyList())
        private set
    var authors by mutableStateOf<Map<String, ChatPerson>>(emptyMap())
        private set
    var hasOlder by mutableStateOf(false)
        private set
    var isLoadingOlder by mutableStateOf(false)
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set

    /** Composer state survives navigation (cleared on sign-out). */
    var draft by mutableStateOf("")
    var attachments by mutableStateOf<List<ComposerAttachment>>(emptyList())
        private set

    /** Read state is only written while visible (on screen and in the foreground) and at the end. */
    val isVisible: Boolean get() = screens > 0 && foreground

    /**
     * Screens showing this conversation. Counted, because when one screen replaces another
     * (link/notification to the same conversation) the new one appears before the old one leaves.
     */
    private var screens = 0
    private var foreground = true

    fun screenAppeared() {
        screens++
        scheduleMarkRead()
    }

    fun screenDisappeared() {
        screens = maxOf(0, screens - 1)
    }

    fun foregroundChanged(active: Boolean) {
        foreground = active
        if (active) scheduleMarkRead()
    }
    var isAtBottom = false
        set(value) {
            field = value
            if (value) scheduleMarkRead()
        }

    private var lastReadSent = 0L
    private var markReadJob: Job? = null

    val viewerId: String get() = viewer.userId
    val lastSeq: Long get() = messages.lastOrNull()?.seq ?: 0
    val canPost: Boolean get() = detail?.canPost ?: false

    // MARK: Loading

    suspend fun load() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        try {
            val (d, page) = coroutineScope {
                val detailCall = async { backend.send(API.getConversation(id = id)) }
                val pageCall = async { backend.send(API.listMessages(id = id)) }
                detailCall.await() to pageCall.await()
            }
            detail = d
            lastReadSent = maxOf(lastReadSent, d.lastReadSeq)
            messages = page.messages
            hasOlder = page.hasMore
            remember(page.authors)
            state = LoadState.Loaded
            scheduleMarkRead()
        } catch (e: ApiError) {
            state = LoadState.Failed(e.message)
        }
    }

    suspend fun reloadDetail() {
        runCatching { backend.send(API.getConversation(id = id)) }.getOrNull()?.let { detail = it }
    }

    /** Older page (scrolling up). */
    suspend fun loadOlder() {
        val first = messages.firstOrNull() ?: return
        if (!hasOlder || isLoadingOlder) return
        isLoadingOlder = true
        try {
            val page = runCatching { backend.send(API.listMessages(id = id, beforeSeq = first.seq)) }.getOrNull() ?: return
            remember(page.authors)
            val known = messages.map { it.id }.toSet()
            messages = page.messages.filter { it.id !in known } + messages
            hasOlder = page.hasMore
        } finally {
            isLoadingOlder = false
        }
    }

    /** Fetches everything newer than the last known message (after reconnect / foreground). */
    suspend fun catchUp() {
        if (state != LoadState.Loaded) return load()
        var after = lastSeq
        while (true) {
            val page = runCatching { backend.send(API.listMessages(id = id, afterSeq = after)) }.getOrNull() ?: return
            remember(page.authors)
            for (m in page.messages) upsert(m)
            val last = page.messages.lastOrNull()
            if (!page.hasMore || last == null) break
            after = last.seq
        }
        reloadDetail()
        scheduleMarkRead()
    }

    /** Realtime signal: fetch the message with attachments and author. */
    suspend fun received(messageId: String) {
        val result = runCatching { backend.send(API.getMessage(id = messageId)) }.getOrNull() ?: return
        result.author?.let { authors = authors + (it.userId to it) }
        upsert(result.message)
        scheduleMarkRead()
    }

    private fun upsert(message: Message) {
        pending = pending.filter { it.id != message.id }
        val list = messages.toMutableList()
        val i = list.indexOfFirst { it.id == message.id }
        if (i >= 0) {
            list[i] = message
        } else {
            val at = list.indexOfFirst { it.seq > message.seq }
            if (at >= 0) list.add(at, message) else list.add(message)
        }
        messages = list
    }

    private fun remember(people: List<ChatPerson>) {
        if (people.isNotEmpty()) authors = authors + people.associateBy { it.userId }
    }

    fun author(id: String): ChatPerson? = authors[id] ?: detail?.members?.firstOrNull { it.userId == id }

    // MARK: Sending

    val canSend: Boolean
        get() {
            val hasText = draft.isNotBlank()
            val ready = attachments.all { it.state is ComposerAttachment.State.Ready }
            return canPost && ready && (hasText || attachments.isNotEmpty())
        }

    suspend fun send() {
        if (!canSend) return
        val ready = attachments.mapNotNull { a ->
            (a.state as? ComposerAttachment.State.Ready)?.let { Attachment(id = it.attachmentId, fileName = a.fileName, mimeType = a.mimeType, sizeBytes = a.sizeBytes) }
        }
        val message = PendingMessage(id = newClientId(), body = draft.trimEnd(), attachments = ready, createdAt = Instant.now())
        pending = pending + message
        draft = ""
        attachments = emptyList()
        deliver(message.id)
    }

    /** Same client id → the server returns the stored message instead of a duplicate. */
    suspend fun retry(pendingId: String) {
        if (pending.none { it.id == pendingId }) return
        pending = pending.map { if (it.id == pendingId) it.copy(failure = null) else it }
        deliver(pendingId)
    }

    /** Gives up on a failed message; its text goes back into the composer. */
    fun discard(pendingId: String) {
        val p = pending.firstOrNull { it.id == pendingId } ?: return
        pending = pending.filter { it.id != pendingId }
        if (draft.isEmpty()) draft = p.body
    }

    private suspend fun deliver(pendingId: String) {
        val p = pending.firstOrNull { it.id == pendingId } ?: return
        try {
            val body = SendMessageRequest(body = p.body, attachmentIds = p.attachments.map { it.id })
            val message = backend.send(API.sendMessage(id = id, messageId = p.id, body = body))
            upsert(message)
            lastReadSent = maxOf(lastReadSent, message.seq)
            store.noteSent(message)
        } catch (e: ApiError) {
            pending = pending.map { if (it.id == pendingId) it.copy(failure = e.message) else it }
        }
    }

    suspend fun edit(messageId: String, body: String) {
        upsert(backend.send(API.editMessage(id = messageId, body = EditMessageRequest(body = body))))
    }

    suspend fun delete(messageId: String) {
        try {
            upsert(backend.send(API.deleteMessage(id = messageId)))
        } catch (e: ApiError) {
            if (e.code == ErrorCode.NotFound) received(messageId) else throw e
        }
    }

    // MARK: Read state

    private fun scheduleMarkRead() {
        if (!isVisible || !isAtBottom || state != LoadState.Loaded) return
        val seq = lastSeq
        if (seq <= lastReadSent) return
        markReadJob?.cancel()
        markReadJob = scope.launch {
            delay(500)
            val result = runCatching { backend.send(API.markRead(id = id, body = MarkReadRequest(seq = seq))) }.getOrNull() ?: return@launch
            lastReadSent = maxOf(lastReadSent, result.lastReadSeq)
            store.updateLocalRead(id, result.lastReadSeq)
        }
    }

    // MARK: Attachments

    /** Client-side pre-check for quick feedback; the server checks everything again (incl. file bytes). */
    fun precheck(fileName: String, sizeBytes: Long, limits: Limits): String? {
        if (attachments.size >= limits.maxFilesPerMessage) return "Höchstens ${limits.maxFilesPerMessage} Dateien pro Nachricht."
        if (FileTypes.type(fileName, limits) == null) {
            return "„$fileName“: Dieser Dateityp ist nicht erlaubt (erlaubt: Bilder, PDF, Text, CSV, Word, Excel, PowerPoint)."
        }
        if (sizeBytes == 0L) return "„$fileName“ ist leer."
        if (sizeBytes > limits.maxFileBytes) return "„$fileName“ ist größer als ${ByteFormatting.string(limits.maxFileBytes)}."
        return null
    }

    /** reserve (server: access, type, budget) → PUT to storage → finalize (server: size, signature). */
    suspend fun addAttachment(data: ByteArray, fileName: String, limits: Limits): String? {
        precheck(fileName, data.size.toLong(), limits)?.let { return it }
        val type = FileTypes.type(fileName, limits)!!
        val localId = newClientId()
        attachments = attachments + ComposerAttachment(localId, fileName, data.size.toLong(), type.mimeType, ComposerAttachment.State.Uploading)
        fun fail(message: String) {
            attachments = attachments.map { if (it.id == localId) it.copy(state = ComposerAttachment.State.Failed(message)) else it }
        }
        val ticket: UploadTicket = try {
            backend.send(API.reserveUpload(id = id, body = ReserveUploadRequest(fileName = fileName, sizeBytes = data.size.toLong())))
        } catch (e: ApiError) {
            fail(e.message)
            return null
        }
        try {
            Uploader.put(data, ticket.signedUrl, ticket.contentType)
            backend.send(API.finalizeUpload(id = ticket.attachmentId))
            if (attachments.any { it.id == localId }) {
                attachments = attachments.map { if (it.id == localId) it.copy(state = ComposerAttachment.State.Ready(ticket.attachmentId)) else it }
            } else {
                // Removed while uploading.
                runCatching { backend.send(API.discardUpload(id = ticket.attachmentId)) }
            }
        } catch (e: ApiError) {
            runCatching { backend.send(API.discardUpload(id = ticket.attachmentId)) }
            fail(e.message)
        }
        return null
    }

    suspend fun removeAttachment(localId: String) {
        val a = attachments.firstOrNull { it.id == localId } ?: return
        attachments = attachments.filter { it.id != localId }
        (a.state as? ComposerAttachment.State.Ready)?.let { runCatching { backend.send(API.discardUpload(id = it.attachmentId)) } }
    }

    /** Downloads on explicit request only; cached in the app's cache directory. */
    suspend fun download(attachment: Attachment): File {
        TemporaryFiles.cachedFile(attachment.id, attachment.fileName)?.let { return it }
        val link = backend.send(API.getDownloadUrl(id = attachment.id))
        return TemporaryFiles.download(link.url, attachment.id, attachment.fileName)
    }

    // MARK: Channel management (rules enforced by the server)

    suspend fun updateChannel(name: String, description: String) {
        backend.send(API.updateChannel(id = id, body = UpdateChannelRequest(name = name, description = description)))
        refreshAfterManagement()
    }

    suspend fun setArchived(archived: Boolean) {
        backend.send(API.setChannelArchived(id = id, body = SetArchivedRequest(archived = archived)))
        refreshAfterManagement()
    }

    suspend fun addMembers(userIds: List<String>) {
        backend.send(API.addChannelMembers(id = id, body = AddChannelMembersRequest(userIds = userIds)))
        refreshAfterManagement()
    }

    /** Remove someone (managers) or leave (self). The responsible person hands over or archives. */
    suspend fun removeMember(userId: String, newOwnerId: String? = null, archive: Boolean = false) {
        backend.send(API.removeChannelMember(id = id, body = RemoveChannelMemberRequest(userId = userId, newOwnerId = Patchable.of(newOwnerId), archive = archive)))
        if (userId == viewer.userId) store.reload() else refreshAfterManagement()
    }

    private suspend fun refreshAfterManagement() {
        reloadDetail()
        store.reload()
    }
}

/** Allowlist lookup by file extension (the server decides by extension too, never by a reported MIME type). */
object FileTypes {
    fun type(fileName: String, limits: Limits): Limits.AllowedFileType? {
        val dot = fileName.lastIndexOf('.')
        if (dot <= 0) return null
        val ext = fileName.substring(dot + 1).lowercase()
        return limits.allowedFileTypes.firstOrNull { ext in it.extensions }
    }
}
