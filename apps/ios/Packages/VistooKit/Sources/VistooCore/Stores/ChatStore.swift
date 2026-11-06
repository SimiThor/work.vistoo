import Foundation
import Observation

/// Conversation list, unread state and the per-conversation models.
@MainActor
@Observable
public final class ChatStore {
    public private(set) var conversations: [ConversationSummary] = []
    public private(set) var state: LoadState = .idle
    public private(set) var storageUsage: ChatStorageUsage?

    /// Same signal as the web navigation dot.
    public var hasUnread: Bool { conversations.contains { $0.unread && !$0.archived } }
    public var unreadCount: Int { conversations.filter { $0.unread && !$0.archived }.count }

    private let backend: Backend
    private let viewer: Viewer
    private var models: [String: ConversationModel] = [:]
    private var reloadTask: Task<Void, Never>?

    public init(backend: Backend, viewer: Viewer) {
        self.backend = backend
        self.viewer = viewer
    }

    public var isAdmin: Bool { viewer.role == .admin }

    public func reload() async {
        if state != .loaded { state = .loading }
        do {
            conversations = try await backend.send(API.listConversations()).conversations
            state = .loaded
        } catch {
            if conversations.isEmpty { state = .failed(error.message) }
        }
        if isAdmin { storageUsage = try? await backend.send(API.getChatStorageUsage()) }
    }

    /// Coalesces bursts of realtime signals into one request.
    public func reloadSoon() {
        reloadTask?.cancel()
        reloadTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await self?.reload()
        }
    }

    public func summary(_ id: String) -> ConversationSummary? { conversations.first { $0.id == id } }

    /// One model per conversation, kept for the session (drafts survive navigation).
    public func model(for id: String) -> ConversationModel {
        if let m = models[id] { return m }
        let m = ConversationModel(id: id, backend: backend, viewer: viewer, store: self)
        models[id] = m
        return m
    }

    func updateLocalRead(_ conversationId: String, seq: Int) {
        guard let i = conversations.firstIndex(where: { $0.id == conversationId }) else { return }
        var c = conversations[i]
        guard seq > c.lastReadSeq else { return }
        c.lastReadSeq = seq
        c.unread = c.lastMessageSeq > seq
        conversations[i] = c
    }

    func noteSent(_ message: Message) {
        guard let i = conversations.firstIndex(where: { $0.id == message.conversationId }) else { return }
        var c = conversations[i]
        c.lastMessageSeq = max(c.lastMessageSeq, message.seq)
        c.lastReadSeq = max(c.lastReadSeq, message.seq)
        c.lastMessageAt = message.createdAt
        c.unread = c.lastMessageSeq > c.lastReadSeq
        conversations[i] = c
    }

    // MARK: Creating conversations

    public func createChannel(name: String, description: String, isPrivate: Bool, memberIds: [String]) async throws(APIError) -> String {
        let body = CreateChannelRequest(
            id: newClientId(),
            name: name,
            description: description,
            visibility: isPrivate ? .privateValue : .open,
            memberIds: memberIds
        )
        let ref = try await backend.send(API.createChannel(body: body))
        await reload()
        return ref.id
    }

    public func openDirectMessage(with userId: String) async throws(APIError) -> String {
        let ref = try await backend.send(API.openDirectMessage(body: OpenDirectMessageRequest(userId: userId)))
        await reload()
        return ref.id
    }

    /// Realtime: a message of a conversation changed.
    func messageChanged(conversationId: String, messageId: String) async {
        await models[conversationId]?.received(messageId: messageId)
    }

    /// After reconnect / foreground: reload list and fill gaps of open conversations.
    func resync() async {
        await reload()
        for model in models.values where model.isVisible { await model.catchUp() }
    }

    /// Clears everything user-specific (sign-out, account switch).
    func reset() {
        reloadTask?.cancel()
        models.removeAll()
        conversations = []
    }
}
