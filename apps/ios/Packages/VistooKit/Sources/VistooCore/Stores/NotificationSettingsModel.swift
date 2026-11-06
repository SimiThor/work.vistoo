import Foundation
import Observation

/// Server-side notification preferences of the signed-in member.
@MainActor
@Observable
public final class NotificationSettingsModel {
    public private(set) var settings: NotificationSettings?
    public private(set) var isSaving = false
    private let backend: Backend

    init(backend: Backend) {
        self.backend = backend
    }

    public func load() async {
        if let s = try? await backend.send(API.getNotificationSettings()) { settings = s }
    }

    /// Optimistic toggle; reverts if the server refuses.
    public func update(_ patch: UpdateNotificationSettingsRequest) async throws(APIError) {
        let previous = settings
        if var s = settings {
            if let v = patch.directMessages { s.directMessages = v }
            if let v = patch.channelMessages { s.channelMessages = v }
            if let v = patch.taskAssignments { s.taskAssignments = v }
            settings = s
        }
        isSaving = true
        defer { isSaving = false }
        do {
            settings = try await backend.send(API.updateNotificationSettings(body: patch))
        } catch {
            settings = previous
            throw error
        }
    }
}
