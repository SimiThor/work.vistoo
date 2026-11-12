import Foundation
import Supabase

/// Supabase Realtime for one signed-in member — the same subscriptions as the web:
///
/// - workspace channel: tasks (row payloads, merged by version), projects,
///   members (→ reload), conversations (list/unread signal) and the
///   caller's own new conversation memberships,
/// - conversation channel: messages of the conversation that is on screen.
///
/// Access control is RLS on the Supabase side: every event is checked against
/// the SELECT policies with the user's JWT, so removed members get nothing.
/// Realtime is a "something changed" signal on top of the API, never the only
/// source: after reconnects and when the app returns to the foreground the
/// stores reload from the API (`resyncNeeded`). No background connection.
@MainActor
public final class RealtimeHub {
    public enum Event: Sendable {
        case taskUpserted(TaskItem)
        case taskDeleted(id: String)
        case projectsChanged
        case membersChanged
        case conversationsChanged
        case messageChanged(conversationId: String, messageId: String)
        /// The connection was interrupted: events may have been missed.
        case resyncNeeded
    }

    private let auth: AuthService
    private let onEvent: @MainActor (Event) -> Void
    private var workspace: (key: String, channel: RealtimeChannelV2)?
    private var conversation: (id: String, channel: RealtimeChannelV2)?
    private var listeners: [String: [Task<Void, Never>]] = [:]
    private var statusTask: Task<Void, Never>?

    public init(auth: AuthService, onEvent: @escaping @MainActor (Event) -> Void) {
        self.auth = auth
        self.onEvent = onEvent
    }

    /// Idempotent: a second call with the same workspace does not subscribe twice.
    public func start(workspaceId: String, userId: String) async {
        let key = "\(workspaceId):\(userId)"
        if workspace?.key == key { return }
        await stopWorkspace()
        watchConnection()

        let channel = auth.client.channel("ios-workspace-\(workspaceId)-\(UUID().uuidString.prefix(8))")
        let ws = RealtimePostgresFilter.eq("workspace_id", value: workspaceId)
        let taskChanges = channel.postgresChange(AnyAction.self, schema: "public", table: "tasks", filter: ws)
        // DELETE events cannot be filtered server-side; they only carry the id.
        let taskDeletes = channel.postgresChange(DeleteAction.self, schema: "public", table: "tasks")
        let projectChanges = channel.postgresChange(AnyAction.self, schema: "public", table: "projects", filter: ws)
        let memberChanges = channel.postgresChange(AnyAction.self, schema: "public", table: "workspace_members", filter: ws)
        let conversationChanges = channel.postgresChange(UpdateAction.self, schema: "public", table: "conversations", filter: ws)
        let newMemberships = channel.postgresChange(
            InsertAction.self, schema: "public", table: "conversation_members", filter: .eq("user_id", value: userId)
        )

        var tasks: [Task<Void, Never>] = []
        tasks.append(Task { [weak self] in
            for await action in taskChanges { self?.handleTask(action) }
        })
        tasks.append(Task { [weak self] in
            for await action in taskDeletes {
                if let id = action.oldRecord["id"]?.stringValue { self?.onEvent(.taskDeleted(id: id.lowercased())) }
            }
        })
        tasks.append(Task { [weak self] in
            for await _ in projectChanges { self?.onEvent(.projectsChanged) }
        })
        tasks.append(Task { [weak self] in
            for await _ in memberChanges { self?.onEvent(.membersChanged) }
        })
        tasks.append(Task { [weak self] in
            for await _ in conversationChanges { self?.onEvent(.conversationsChanged) }
        })
        tasks.append(Task { [weak self] in
            for await _ in newMemberships { self?.onEvent(.conversationsChanged) }
        })
        listeners["workspace"] = tasks
        workspace = (key, channel)
        try? await channel.subscribeWithError()
    }

    /// Subscribes to the messages of the conversation on screen (nil = none).
    public func watchConversation(_ conversationId: String?) async {
        if conversation?.id == conversationId { return }
        if let current = conversation {
            listeners["conversation"]?.forEach { $0.cancel() }
            listeners["conversation"] = nil
            await auth.client.removeChannel(current.channel)
            conversation = nil
        }
        guard let conversationId else { return }
        let channel = auth.client.channel("ios-conversation-\(conversationId)-\(UUID().uuidString.prefix(8))")
        let filter = RealtimePostgresFilter.eq("conversation_id", value: conversationId)
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "messages", filter: filter)
        let updates = channel.postgresChange(UpdateAction.self, schema: "public", table: "messages", filter: filter)
        listeners["conversation"] = [
            Task { [weak self] in
                for await action in inserts {
                    if let id = action.record["id"]?.stringValue {
                        self?.onEvent(.messageChanged(conversationId: conversationId, messageId: id.lowercased()))
                    }
                }
            },
            Task { [weak self] in
                for await action in updates {
                    if let id = action.record["id"]?.stringValue {
                        self?.onEvent(.messageChanged(conversationId: conversationId, messageId: id.lowercased()))
                    }
                }
            },
        ]
        conversation = (conversationId, channel)
        try? await channel.subscribeWithError()
    }

    /// Ends all subscriptions (background, sign-out, account switch).
    public func stop() async {
        statusTask?.cancel()
        statusTask = nil
        await watchConversation(nil)
        await stopWorkspace()
        await auth.client.removeAllChannels()
    }

    private func stopWorkspace() async {
        listeners["workspace"]?.forEach { $0.cancel() }
        listeners["workspace"] = nil
        if let current = workspace {
            await auth.client.removeChannel(current.channel)
            workspace = nil
        }
    }

    private func watchConnection() {
        guard statusTask == nil else { return }
        let realtime = auth.client.realtimeV2
        statusTask = Task { [weak self] in
            var wasDisconnected = false
            for await status in realtime.statusChange {
                switch status {
                case .connected:
                    if wasDisconnected { self?.onEvent(.resyncNeeded) }
                    wasDisconnected = false
                case .disconnected:
                    wasDisconnected = true
                default:
                    break
                }
            }
        }
    }

    private func handleTask(_ action: AnyAction) {
        switch action {
        case .insert(let insert):
            emitTask(insert.record)
        case .update(let update):
            emitTask(update.record)
        case .delete(let delete):
            if let id = delete.oldRecord["id"]?.stringValue { onEvent(.taskDeleted(id: id.lowercased())) }
        }
    }

    private func emitTask(_ record: [String: AnyJSON]) {
        if let task = TaskRow.decode(record) {
            onEvent(.taskUpserted(task))
        } else {
            // Unknown payload shape: fall back to a reload instead of guessing.
            onEvent(.resyncNeeded)
        }
    }
}

/// Postgres row of `tasks` as delivered by Realtime (snake_case).
enum TaskRow {
    static func decode(_ record: [String: AnyJSON]) -> TaskItem? {
        func string(_ key: String) -> String? { record[key]?.stringValue }
        /// uuid[] arrives as a JSON array (or, defensively, as a Postgres array literal `{a,b}`).
        func ids(_ key: String) -> [String]? {
            switch record[key] {
            case .array(let items): return items.compactMap { $0.stringValue?.lowercased() }
            case .string(let s) where s.hasPrefix("{") && s.hasSuffix("}"):
                return s.dropFirst().dropLast().split(separator: ",").map { String($0).lowercased() }
            default: return nil
            }
        }
        func number(_ key: String) -> Double? {
            switch record[key] {
            case .double(let d): d
            case .integer(let i): Double(i)
            case .string(let s): Double(s)
            default: nil
            }
        }
        guard let id = string("id"), let projectId = string("project_id"), let title = string("title"),
              let status = string("status"), let position = number("position"), let createdBy = string("created_by"),
              let createdAtRaw = string("created_at"), let createdAt = ISO8601.parse(createdAtRaw),
              let updatedAtRaw = string("updated_at"), let updatedAt = ISO8601.parse(updatedAtRaw),
              let version = number("version"), let issueNumber = number("number")
        else { return nil }
        return TaskItem(
            id: id.lowercased(),
            projectId: projectId.lowercased(),
            groupId: nil, // groups were removed
            milestoneId: string("milestone_id")?.lowercased(),
            number: Int(issueNumber),
            title: title,
            description: string("description") ?? "",
            status: TaskStatus(rawValue: status),
            assigneeId: (ids("assignee_ids")?.first ?? string("assignee_id"))?.lowercased(),
            assigneeIds: ids("assignee_ids") ?? string("assignee_id").map { [$0.lowercased()] } ?? [],
            startDate: string("start_date").flatMap(CalendarDate.init),
            endDate: string("end_date").flatMap(CalendarDate.init),
            position: position,
            createdBy: createdBy.lowercased(),
            createdAt: createdAt,
            updatedAt: updatedAt,
            version: Int(version)
        )
    }
}
