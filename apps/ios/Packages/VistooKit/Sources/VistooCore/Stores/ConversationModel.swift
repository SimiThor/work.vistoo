import Foundation
import Observation

/// A message that is not confirmed by the server yet. It keeps its client id,
/// so "Erneut senden" can never create a duplicate (the server deduplicates).
public struct PendingMessage: Identifiable, Equatable, Sendable {
    public let id: String
    public let body: String
    public let attachments: [Attachment]
    public let createdAt: Date
    public var failure: String?
    public var isSending: Bool { failure == nil }
}

/// An attachment in the composer.
public struct ComposerAttachment: Identifiable, Equatable, Sendable {
    public enum State: Equatable, Sendable {
        case uploading
        case ready(attachmentId: String)
        case failed(String)
    }
    public let id: String
    public let fileName: String
    public let sizeBytes: Int
    public let mimeType: String
    public var state: State
}

/// One conversation on screen: details, paged history, composer, read state, files.
@MainActor
@Observable
public final class ConversationModel: Identifiable {
    public let id: String
    public private(set) var detail: ConversationDetail?
    /// Confirmed messages, ascending by seq.
    public private(set) var messages: [Message] = []
    public private(set) var pending: [PendingMessage] = []
    public private(set) var authors: [String: ChatPerson] = [:]
    public private(set) var hasOlder = false
    public private(set) var isLoadingOlder = false
    public private(set) var state: LoadState = .idle

    /// Composer state survives navigation (cleared on sign-out).
    public var draft = ""
    public private(set) var attachments: [ComposerAttachment] = []

    /// Set by the view: read state is only written while visible and at the end.
    public var isVisible = false
    public var isAtBottom = false {
        didSet { if isAtBottom { scheduleMarkRead() } }
    }

    private let backend: Backend
    private let viewer: Viewer
    private weak var store: ChatStore?
    private var lastReadSent = 0
    private var markReadTask: Task<Void, Never>?

    init(id: String, backend: Backend, viewer: Viewer, store: ChatStore) {
        self.id = id
        self.backend = backend
        self.viewer = viewer
        self.store = store
    }

    public var viewerId: String { viewer.userId }
    public var lastSeq: Int { messages.last?.seq ?? 0 }
    public var canPost: Bool { detail?.canPost ?? false }

    // MARK: Loading

    public func load() async {
        if state != .loaded { state = .loading }
        do {
            async let detailCall = backend.send(API.getConversation(id: id))
            async let pageCall = backend.send(API.listMessages(id: id))
            let (d, page) = try await (detailCall, pageCall)
            detail = d
            lastReadSent = max(lastReadSent, d.lastReadSeq)
            messages = page.messages
            hasOlder = page.hasMore
            remember(page.authors)
            state = .loaded
            scheduleMarkRead()
        } catch {
            state = .failed((error as? APIError)?.message ?? "Die Unterhaltung konnte nicht geladen werden.")
        }
    }

    public func reloadDetail() async {
        if let d = try? await backend.send(API.getConversation(id: id)) { detail = d }
    }

    /// Older page (scrolling up). The view keeps its scroll anchor, so nothing jumps.
    public func loadOlder() async {
        guard hasOlder, !isLoadingOlder, let first = messages.first else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        guard let page = try? await backend.send(API.listMessages(id: id, beforeSeq: first.seq)) else { return }
        remember(page.authors)
        let known = Set(messages.map(\.id))
        messages.insert(contentsOf: page.messages.filter { !known.contains($0.id) }, at: 0)
        hasOlder = page.hasMore
    }

    /// Fetches everything newer than the last known message (after reconnect / foreground).
    public func catchUp() async {
        guard state == .loaded else { return await load() }
        var after = lastSeq
        while true {
            guard let page = try? await backend.send(API.listMessages(id: id, afterSeq: after)) else { return }
            remember(page.authors)
            for m in page.messages { upsert(m) }
            guard page.hasMore, let last = page.messages.last else { break }
            after = last.seq
        }
        await reloadDetail()
        scheduleMarkRead()
    }

    /// Realtime signal: fetch the message with attachments and author.
    func received(messageId: String) async {
        guard let result = try? await backend.send(API.getMessage(id: messageId)) else { return }
        if let author = result.author { authors[author.userId] = author }
        upsert(result.message)
        scheduleMarkRead()
    }

    private func upsert(_ message: Message) {
        pending.removeAll { $0.id == message.id }
        if let i = messages.firstIndex(where: { $0.id == message.id }) {
            messages[i] = message
        } else if let i = messages.firstIndex(where: { $0.seq > message.seq }) {
            messages.insert(message, at: i)
        } else {
            messages.append(message)
        }
    }

    private func remember(_ people: [ChatPerson]) {
        for p in people { authors[p.userId] = p }
    }

    public func author(_ id: String) -> ChatPerson? {
        authors[id] ?? detail?.members.first { $0.userId == id }
    }

    // MARK: Sending

    public var canSend: Bool {
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let ready = attachments.allSatisfy { if case .ready = $0.state { true } else { false } }
        return canPost && ready && (hasText || !attachments.isEmpty)
    }

    public func send() async {
        guard canSend else { return }
        let readyIds = attachments.compactMap { a -> Attachment? in
            if case .ready(let id) = a.state { return Attachment(id: id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes) }
            return nil
        }
        let message = PendingMessage(
            id: newClientId(),
            body: String(draft.reversed().drop(while: \.isWhitespace).reversed()),
            attachments: readyIds,
            createdAt: .now,
            failure: nil
        )
        pending.append(message)
        draft = ""
        attachments = []
        await deliver(message.id)
    }

    /// Same client id → the server returns the stored message instead of a duplicate.
    public func retry(_ pendingId: String) async {
        guard let i = pending.firstIndex(where: { $0.id == pendingId }) else { return }
        pending[i].failure = nil
        await deliver(pendingId)
    }

    /// Gives up on a failed message; its text goes back into the composer.
    public func discard(_ pendingId: String) {
        guard let p = pending.first(where: { $0.id == pendingId }) else { return }
        pending.removeAll { $0.id == pendingId }
        if draft.isEmpty { draft = p.body }
    }

    private func deliver(_ pendingId: String) async {
        guard let p = pending.first(where: { $0.id == pendingId }) else { return }
        do {
            let body = SendMessageRequest(body: p.body, attachmentIds: p.attachments.map(\.id))
            let message = try await backend.send(API.sendMessage(id: id, messageId: p.id, body: body))
            upsert(message)
            lastReadSent = max(lastReadSent, message.seq)
            store?.noteSent(message)
        } catch {
            if let i = pending.firstIndex(where: { $0.id == pendingId }) { pending[i].failure = error.message }
        }
    }

    public func edit(_ messageId: String, body: String) async throws(APIError) {
        upsert(try await backend.send(API.editMessage(id: messageId, body: EditMessageRequest(body: body))))
    }

    public func delete(_ messageId: String) async throws(APIError) {
        do {
            upsert(try await backend.send(API.deleteMessage(id: messageId)))
        } catch where error.code == .notFound {
            await received(messageId: messageId)
        }
    }

    // MARK: Read state

    private func scheduleMarkRead() {
        guard isVisible, isAtBottom, state == .loaded else { return }
        let seq = lastSeq
        guard seq > lastReadSent else { return }
        markReadTask?.cancel()
        markReadTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard let self, !Task.isCancelled else { return }
            guard let result = try? await self.backend.send(API.markRead(id: self.id, body: MarkReadRequest(seq: seq))) else { return }
            self.lastReadSent = max(self.lastReadSent, result.lastReadSeq)
            self.store?.updateLocalRead(self.id, seq: result.lastReadSeq)
        }
    }

    // MARK: Attachments

    /// Client-side pre-check for quick feedback; the server checks everything again (incl. file bytes).
    public func precheck(fileName: String, sizeBytes: Int, limits: Limits) -> String? {
        if attachments.count >= limits.maxFilesPerMessage { return "Höchstens \(limits.maxFilesPerMessage) Dateien pro Nachricht." }
        guard FileTypes.type(for: fileName, in: limits) != nil else {
            return "„\(fileName)“: Dieser Dateityp ist nicht erlaubt (erlaubt: Bilder, PDF, Text, CSV, Word, Excel, PowerPoint)."
        }
        if sizeBytes == 0 { return "„\(fileName)“ ist leer." }
        if sizeBytes > limits.maxFileBytes { return "„\(fileName)“ ist größer als \(ByteFormatting.string(limits.maxFileBytes))." }
        return nil
    }

    /// reserve (server: access, type, budget) → PUT to storage → finalize (server: size, signature).
    public func addAttachment(data: Data, fileName: String, limits: Limits) async -> String? {
        if let problem = precheck(fileName: fileName, sizeBytes: data.count, limits: limits) { return problem }
        let type = FileTypes.type(for: fileName, in: limits)!
        let localId = newClientId()
        attachments.append(ComposerAttachment(id: localId, fileName: fileName, sizeBytes: data.count, mimeType: type.mimeType, state: .uploading))
        func fail(_ message: String) {
            if let i = attachments.firstIndex(where: { $0.id == localId }) { attachments[i].state = .failed(message) }
        }
        let ticket: UploadTicket
        do {
            ticket = try await backend.send(API.reserveUpload(id: id, body: ReserveUploadRequest(fileName: fileName, sizeBytes: data.count)))
        } catch {
            fail(error.message)
            return nil
        }
        do {
            try await Uploader.put(data, to: ticket.signedUrl, contentType: ticket.contentType)
            _ = try await backend.send(API.finalizeUpload(id: ticket.attachmentId))
            if let i = attachments.firstIndex(where: { $0.id == localId }) {
                attachments[i].state = .ready(attachmentId: ticket.attachmentId)
            } else {
                // Removed while uploading.
                _ = try? await backend.send(API.discardUpload(id: ticket.attachmentId))
            }
        } catch {
            _ = try? await backend.send(API.discardUpload(id: ticket.attachmentId))
            fail((error as? APIError)?.message ?? "Der Upload ist fehlgeschlagen. Bitte versuche es erneut.")
        }
        return nil
    }

    public func removeAttachment(_ localId: String) async {
        guard let a = attachments.first(where: { $0.id == localId }) else { return }
        attachments.removeAll { $0.id == localId }
        if case .ready(let attachmentId) = a.state { _ = try? await backend.send(API.discardUpload(id: attachmentId)) }
    }

    /// Downloads on explicit request only; cached in the temporary directory.
    public func download(_ attachment: Attachment) async throws(APIError) -> URL {
        if let cached = TemporaryFiles.cachedFile(attachmentId: attachment.id, fileName: attachment.fileName) { return cached }
        let link = try await backend.send(API.getDownloadUrl(id: attachment.id))
        return try await TemporaryFiles.download(link.url, attachmentId: attachment.id, fileName: attachment.fileName)
    }

    // MARK: Channel management (rules enforced by the server)

    public func updateChannel(name: String, description: String) async throws(APIError) {
        _ = try await backend.send(API.updateChannel(id: id, body: UpdateChannelRequest(name: name, description: description)))
        await refreshAfterManagement()
    }

    public func setArchived(_ archived: Bool) async throws(APIError) {
        _ = try await backend.send(API.setChannelArchived(id: id, body: SetArchivedRequest(archived: archived)))
        await refreshAfterManagement()
    }

    public func addMembers(_ userIds: [String]) async throws(APIError) {
        _ = try await backend.send(API.addChannelMembers(id: id, body: AddChannelMembersRequest(userIds: userIds)))
        await refreshAfterManagement()
    }

    /// Remove someone (managers) or leave (self). The responsible person hands over or archives.
    public func removeMember(_ userId: String, newOwnerId: String? = nil, archive: Bool = false) async throws(APIError) {
        let body = RemoveChannelMemberRequest(userId: userId, newOwnerId: Patchable(newOwnerId), archive: archive)
        _ = try await backend.send(API.removeChannelMember(id: id, body: body))
        if userId == viewer.userId {
            await store?.reload()
        } else {
            await refreshAfterManagement()
        }
    }

    private func refreshAfterManagement() async {
        await reloadDetail()
        await store?.reload()
    }
}

/// Allowlist lookup by file extension (the server decides by extension too, never by a reported MIME type).
public enum FileTypes {
    public static func type(for fileName: String, in limits: Limits) -> Limits.AllowedFileType? {
        guard let dot = fileName.lastIndex(of: "."), dot != fileName.startIndex else { return nil }
        let ext = fileName[fileName.index(after: dot)...].lowercased()
        return limits.allowedFileTypes.first { $0.extensions.contains(ext) }
    }
}

public enum ByteFormatting {
    /// "512 KB", "2,4 MB" (German formatting like the web).
    public static func string(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded())) KB" }
        let mb = Double(bytes) / (1024 * 1024)
        let digits = bytes < 10 * 1024 * 1024 ? 1 : 0
        return mb.formatted(.number.precision(.fractionLength(digits)).locale(Locale(identifier: "de_DE"))) + " MB"
    }
}
